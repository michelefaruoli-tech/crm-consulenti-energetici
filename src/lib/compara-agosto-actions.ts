"use server";

/**
 * Import Compara Agosto: anteprima obbligatoria con checkbox, regole importo
 * Fagiano/altri, create mancanti, fill POD Fagiano senza overwrite automatico.
 *
 * Neon HTTP: nessun $transaction / updateMany / createMany.
 */

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { decimalToNumber } from "@/lib/commission";
import {
  friendlyNeonHttpError,
  logPrismaError,
} from "@/lib/neon-http-errors";
import { isRecurringMonthly, periodLabel } from "@/lib/recurring";
import { normalizePodKey } from "@/lib/storno-status";
import { applyPayoutRowMark } from "@/lib/payout/apply";
import {
  loadPayoutContractIndex,
  matchPayoutRow,
  PAYOUT_MATCH_REASON_LABEL,
  type PayoutCandidate,
} from "@/lib/payout/match";
import { parsePayoutWorkbook } from "@/lib/payout/parse";
import type { RawCell } from "@/lib/payout/normalize";
import type { ParsedPayoutRow } from "@/lib/payout/types";
import {
  comparaRuleAmount,
  isFagianoCollaborator,
} from "@/lib/compara-agosto/amounts";
import { decidePodFill } from "@/lib/compara-agosto/pod-fill";
import { deduceComparaPeriods } from "@/lib/compara-agosto/periods";
import {
  COMPARA_AGOSTO_TEMPLATE_KEY,
  COMPARA_AGOSTO_TEMPLATE_LABEL,
  comparaAgostoTemplateConfig,
} from "@/lib/compara-agosto/template";
import { readComparaUnits } from "@/lib/compara-agosto/units";
import {
  comparaAgostoRowKey,
  type ComparaAgostoAction,
  type ComparaAgostoActionError,
  type ComparaAgostoPreviewResult,
  type ComparaAgostoPreviewRow,
} from "@/lib/compara-agosto/view-types";

const PREVIEW_ROW_LIMIT = 400;
const APPLY_BATCH_SIZE = 40;
const INSERT_CONCURRENCY = 20;
const PERIOD_RE = /^\d{4}-\d{2}$/;

function fail(error: string, details?: string[]): ComparaAgostoActionError {
  return { ok: false, error, details };
}

function errorMessage(e: unknown, fallback: string): string {
  return friendlyNeonHttpError(e, fallback);
}

function canManage(role: Parameters<typeof hasPermission>[0]): boolean {
  return hasPermission(role, "commissions.edit_gettone");
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function readPeriod(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  return PERIOD_RE.test(value) ? value : currentPeriod();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function readUpload(
  formData: FormData,
): Promise<
  { ok: true; buffer: Buffer; fileName: string } | ComparaAgostoActionError
> {
  const fileName =
    String(formData.get("fileName") ?? "").trim() || "COMPARA_AGOSTO.xlsx";
  const base64 = String(formData.get("fileBase64") ?? "").trim();
  let buffer: Buffer | null = null;
  if (base64) {
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return fail("File non valido");
    }
  } else {
    const file = formData.get("file");
    if (file instanceof Blob && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
    }
  }
  if (!buffer || buffer.length === 0) {
    return fail("Seleziona il file Compara (.xlsx)");
  }
  return { ok: true, buffer, fileName };
}

function readSelectedRowKeys(formData: FormData): Set<string> | null {
  const raw = String(formData.get("selectedRowKeys") ?? "").trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(
      parsed.filter((v): v is string => typeof v === "string" && v.length > 0),
    );
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1))
    .fill(null)
    .map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await task(items[index]!, index);
      }
    });
  await Promise.all(workers);
  return out;
}

type PlannedRow = ComparaAgostoPreviewRow & {
  parsed: ParsedPayoutRow;
  matchStatus: "MATCHED" | "AMBIGUOUS" | "UNMATCHED" | "IGNORED";
  candidateIds: string[];
  crmCollaboratorId: string | null;
};

function collaboratorForAmount(
  contractName: string | null,
  shopHint: string,
): string {
  // Shop file è spesso il master (Faruoli): la regola Fagiano usa il collaboratore CRM
  if (contractName && isFagianoCollaborator(contractName)) return contractName;
  if (isFagianoCollaborator(shopHint)) return shopHint;
  return contractName || shopHint;
}

async function loadContractFinance(contractIds: string[]): Promise<
  Map<
    string,
    {
      recurrence: string | null;
      status: string;
      paymentStatus: string | null;
      podPdr: string | null;
      pod: string | null;
      pdr: string | null;
      commissionPaid: number;
      commissionReceived: number;
      recurringByPeriod: Map<
        string,
        { id: string; status: string; amount: number | null }
      >;
    }
  >
> {
  const map = new Map();
  if (contractIds.length === 0) return map;
  const unique = [...new Set(contractIds)];
  const contracts = await prisma.contract.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      recurrence: true,
      status: true,
      paymentStatus: true,
      podPdr: true,
      pod: true,
      pdr: true,
      commission: {
        select: { paid: true, received: true },
      },
      recurringMonths: {
        select: { id: true, period: true, status: true, amount: true },
      },
    },
  });
  for (const c of contracts) {
    const recurringByPeriod = new Map<
      string,
      { id: string; status: string; amount: number | null }
    >();
    for (const m of c.recurringMonths) {
      recurringByPeriod.set(m.period, {
        id: m.id,
        status: m.status,
        amount: m.amount == null ? null : decimalToNumber(m.amount),
      });
    }
    map.set(c.id, {
      recurrence: c.recurrence,
      status: c.status,
      paymentStatus: c.paymentStatus,
      podPdr: c.podPdr,
      pod: c.pod,
      pdr: c.pdr,
      commissionPaid: decimalToNumber(c.commission?.paid ?? 0),
      commissionReceived: decimalToNumber(c.commission?.received ?? 0),
      recurringByPeriod,
    });
  }
  return map;
}

function classifyAction(params: {
  contract: PayoutCandidate | null;
  finance:
    | {
        recurrence: string | null;
        status: string;
        paymentStatus: string | null;
        commissionPaid: number;
        recurringByPeriod: Map<
          string,
          { id: string; status: string; amount: number | null }
        >;
      }
    | undefined;
  competencePeriod: string;
  ambiguous: boolean;
  podNeedsConfirm: boolean;
  amount: number | null;
}): {
  action: ComparaAgostoAction;
  skipReason: string | null;
  existingLiquidatedAmount: number | null;
} {
  if (!params.contract) {
    return {
      action: "unmatched",
      skipReason: "Nessun contratto per nominativo/POD",
      existingLiquidatedAmount: null,
    };
  }
  if (params.amount == null) {
    return {
      action: "confirm",
      skipReason: "Importo non determinabile",
      existingLiquidatedAmount: null,
    };
  }
  if (params.ambiguous || params.podNeedsConfirm) {
    return {
      action: "confirm",
      skipReason: params.podNeedsConfirm
        ? "POD/nominativo da confermare (Michele)"
        : "Match da confermare (Michele)",
      existingLiquidatedAmount: null,
    };
  }

  const fin = params.finance;
  if (!fin) {
    return {
      action: "create",
      skipReason: null,
      existingLiquidatedAmount: null,
    };
  }

  if (isRecurringMonthly(fin.recurrence)) {
    const month = fin.recurringByPeriod.get(params.competencePeriod);
    if (month?.status === "LIQUIDATED") {
      return {
        action: "skip_liquidated",
        skipReason: "Rata già liquidata: importo non sovrascritto",
        existingLiquidatedAmount: month.amount,
      };
    }
    if (!month) {
      return {
        action: "create",
        skipReason: null,
        existingLiquidatedAmount: null,
      };
    }
    if (month.status === "PAID") {
      return {
        action: "update",
        skipReason: "Rata già Incassato da liquidare: aggiorna importo/note",
        existingLiquidatedAmount: null,
      };
    }
    return {
      action: "update",
      skipReason: null,
      existingLiquidatedAmount: null,
    };
  }

  // Una tantum
  if (
    fin.status === "PROVVIGIONE_LIQUIDATA" ||
    (fin.commissionPaid > 0 && fin.paymentStatus === "Pagato")
  ) {
    return {
      action: "skip_liquidated",
      skipReason: "Provvigione già liquidata: non sovrascrivere",
      existingLiquidatedAmount: fin.commissionPaid,
    };
  }
  if (
    fin.paymentStatus === "Incassato" ||
    fin.status === "PAGATO_DAL_FORNITORE"
  ) {
    return {
      action: "update",
      skipReason: null,
      existingLiquidatedAmount: null,
    };
  }
  return {
    action: "create",
    skipReason: null,
    existingLiquidatedAmount: null,
  };
}

async function planRows(
  buffer: Buffer,
  fallbackCompetence: string,
  fallbackSettled: string,
): Promise<
  | {
      ok: true;
      planned: PlannedRow[];
      competencePeriod: string;
      settledPeriod: string;
      periodSource: string;
      sheetsRead: string[];
      skipped: Array<{ sheetName: string; rowIndex: number; reason: string }>;
    }
  | ComparaAgostoActionError
> {
  const config = comparaAgostoTemplateConfig();
  const parsed = await parsePayoutWorkbook(buffer, config);
  if (!parsed.ok) return fail(parsed.error, parsed.missingColumns);

  const meseSamples: RawCell[] = [];
  const dataPeriods: Array<string | null> = [];
  for (const row of parsed.rows) {
    const meseRaw = row.raw["Mese Invito"] ?? row.raw["mese invito"];
    if (meseRaw) meseSamples.push(meseRaw);
    dataPeriods.push(row.period);
  }
  const periods = deduceComparaPeriods({
    meseInvitoSamples: meseSamples,
    dataPeriods,
    fallbackCompetence,
    fallbackSettled,
  });

  const index = await loadPayoutContractIndex();
  const draft: Array<{
    parsed: ParsedPayoutRow;
    contract: PayoutCandidate | null;
    ambiguous: boolean;
    matchReason: string | null;
    matchScore: number | null;
    candidateIds: string[];
  }> = [];

  for (const row of parsed.rows) {
    const withPeriod: ParsedPayoutRow = {
      ...row,
      period: row.period ?? periods.competencePeriod,
    };
    const outcome = matchPayoutRow(withPeriod, index);
    if (outcome.status === "unmatched") {
      draft.push({
        parsed: withPeriod,
        contract: null,
        ambiguous: false,
        matchReason: null,
        matchScore: null,
        candidateIds: [],
      });
      continue;
    }
    if (outcome.status === "ambiguous") {
      draft.push({
        parsed: withPeriod,
        contract: outcome.candidates[0] ?? null,
        ambiguous: true,
        matchReason: outcome.reason,
        matchScore: outcome.score,
        candidateIds: outcome.candidates.map((c) => c.id),
      });
      continue;
    }
    draft.push({
      parsed: withPeriod,
      contract: outcome.contract,
      ambiguous: false,
      matchReason: outcome.reason,
      matchScore: outcome.score,
      candidateIds: [outcome.contract.id],
    });
  }

  const finance = await loadContractFinance(
    draft.map((d) => d.contract?.id).filter((id): id is string => Boolean(id)),
  );

  const planned: PlannedRow[] = draft.map((d) => {
    const shopHint = d.parsed.collaboratorHint || "";
    const collabName = collaboratorForAmount(
      d.contract?.collaboratorName ?? null,
      shopHint,
    );
    const fagiano = isFagianoCollaborator(collabName);
    const units = readComparaUnits(d.parsed.raw);
    const rule = comparaRuleAmount({
      supplierHint: d.parsed.supplierHint || d.contract?.supplierName,
      collaboratorName: collabName,
      units,
      fileAmount: d.parsed.amount,
    });
    const fin = d.contract ? finance.get(d.contract.id) : undefined;
    const podDecision = decidePodFill({
      filePodRaw: d.parsed.podRaw,
      contract: d.contract
        ? {
            podPdr: fin?.podPdr ?? d.contract.podPdr,
            pod: fin?.pod ?? d.contract.pod,
            pdr: fin?.pdr ?? d.contract.pdr,
          }
        : null,
      isFagiano: fagiano,
      ambiguousMatch: d.ambiguous,
    });
    const classified = classifyAction({
      contract: d.contract,
      finance: fin,
      competencePeriod: periods.competencePeriod,
      ambiguous: d.ambiguous,
      podNeedsConfirm: podDecision.mode === "needs_confirm",
      amount: rule.amount,
    });

    const crmPod = d.contract
      ? (fin?.podPdr || fin?.pod || fin?.pdr || d.contract.podPdr || "").trim()
      : "";

    const preview: PlannedRow = {
      sheetName: d.parsed.sheetName,
      rowIndex: d.parsed.rowIndex,
      nominativo: d.parsed.clientNameRaw,
      supplierHint: d.parsed.supplierHint,
      shopHint,
      podRaw: d.parsed.podRaw,
      fileAmount: d.parsed.amount,
      ruleAmount: rule.amount,
      ruleApplied: rule.ruleApplied,
      units,
      period: periods.competencePeriod,
      action: classified.action,
      matchReason: d.matchReason
        ? (PAYOUT_MATCH_REASON_LABEL[
            d.matchReason as keyof typeof PAYOUT_MATCH_REASON_LABEL
          ] ?? d.matchReason)
        : undefined,
      matchScore: d.matchScore ?? undefined,
      contractId: d.contract?.id,
      contractNumber: d.contract?.contractNumber,
      crmClientName: d.contract?.clientName,
      crmPod: crmPod || undefined,
      supplierName: d.contract?.supplierName,
      collaboratorName: collabName || undefined,
      isFagiano: fagiano,
      fagianoMissingPodInFile: fagiano && !d.parsed.podRaw.trim(),
      podFillMode: podDecision.mode,
      proposedPodFill: podDecision.proposedPodFill ?? undefined,
      skipReason: classified.skipReason ?? podDecision.reason ?? undefined,
      existingLiquidatedAmount: classified.existingLiquidatedAmount,
      parsed: {
        ...d.parsed,
        amount: rule.amount,
        period: periods.competencePeriod,
        collaboratorHint: collabName,
      },
      matchStatus:
        classified.action === "unmatched"
          ? "UNMATCHED"
          : classified.action === "confirm"
            ? "AMBIGUOUS"
            : classified.action === "skip_liquidated"
              ? "IGNORED"
              : d.contract
                ? "MATCHED"
                : "UNMATCHED",
      candidateIds: d.candidateIds,
      crmCollaboratorId: d.contract?.collaboratorId ?? null,
    };
    return preview;
  });

  return {
    ok: true,
    planned,
    competencePeriod: periods.competencePeriod,
    settledPeriod: periods.settledPeriod,
    periodSource: periods.source,
    sheetsRead: parsed.sheetsRead,
    skipped: parsed.skipped,
  };
}

function toPreviewRow(row: PlannedRow): ComparaAgostoPreviewRow {
  const {
    parsed: _p,
    matchStatus: _m,
    candidateIds: _c,
    crmCollaboratorId: _id,
    ...rest
  } = row;
  return rest;
}

/** Anteprima obbligatoria: non scrive nulla. */
export async function previewComparaAgostoAction(
  formData: FormData,
): Promise<ComparaAgostoPreviewResult | ComparaAgostoActionError> {
  try {
    const session = await requireSession();
    if (!canManage(session.role)) {
      return fail("Non hai permesso di importare i rendiconti Compara");
    }
    const upload = await readUpload(formData);
    if (!upload.ok) return upload;

    const fallbackCompetence = readPeriod(formData, "competencePeriod");
    const fallbackSettled = readPeriod(formData, "settledPeriod");
    const plan = await planRows(
      upload.buffer,
      fallbackCompetence,
      fallbackSettled,
    );
    if (!plan.ok) return plan;

    let fagianoRows = 0;
    let fagianoMissingPod = 0;
    let fagianoProbableMatch = 0;
    let fagianoPodPrefill = 0;
    let fagianoPodConfirm = 0;
    let ruleAmountTotal = 0;
    const summary = {
      total: plan.planned.length,
      update: 0,
      create: 0,
      confirm: 0,
      unmatched: 0,
      skipLiquidated: 0,
      fagianoRows: 0,
      fagianoMissingPod: 0,
      fagianoProbableMatch: 0,
      fagianoPodPrefill: 0,
      fagianoPodConfirm: 0,
      ruleAmountTotal: 0,
    };

    for (const row of plan.planned) {
      if (row.action === "update") summary.update++;
      else if (row.action === "create") summary.create++;
      else if (row.action === "confirm") summary.confirm++;
      else if (row.action === "unmatched") summary.unmatched++;
      else if (row.action === "skip_liquidated") summary.skipLiquidated++;

      if (row.isFagiano) {
        fagianoRows++;
        if (row.fagianoMissingPodInFile) fagianoMissingPod++;
        if (row.contractId) fagianoProbableMatch++;
        if (row.podFillMode === "safe_prefill" || row.podFillMode === "display_from_crm") {
          fagianoPodPrefill++;
        }
        if (row.podFillMode === "needs_confirm") fagianoPodConfirm++;
      }
      if (row.ruleAmount != null && row.action !== "unmatched") {
        ruleAmountTotal += row.ruleAmount;
      }
    }
    summary.fagianoRows = fagianoRows;
    summary.fagianoMissingPod = fagianoMissingPod;
    summary.fagianoProbableMatch = fagianoProbableMatch;
    summary.fagianoPodPrefill = fagianoPodPrefill;
    summary.fagianoPodConfirm = fagianoPodConfirm;
    summary.ruleAmountTotal = round2(ruleAmountTotal);

    return {
      ok: true,
      fileName: upload.fileName,
      competencePeriod: plan.competencePeriod,
      settledPeriod: plan.settledPeriod,
      sheetsRead: plan.sheetsRead,
      rows: plan.planned.slice(0, PREVIEW_ROW_LIMIT).map(toPreviewRow),
      summary,
      truncated: plan.planned.length > PREVIEW_ROW_LIMIT,
    };
  } catch (e) {
    logPrismaError("previewComparaAgostoAction", e);
    return fail(errorMessage(e, "Anteprima Compara non riuscita"));
  }
}

async function ensureSource(userId: string): Promise<{
  sourceId: string;
  templateId: string;
}> {
  const name = COMPARA_AGOSTO_TEMPLATE_LABEL;
  let source = await prisma.payoutSource.findUnique({
    where: { name },
    select: { id: true },
  });
  if (!source) {
    source = await prisma.payoutSource.create({
      data: { name, kind: "MARKETPLACE" },
      select: { id: true },
    });
  }
  const config = comparaAgostoTemplateConfig();
  let template = await prisma.importTemplate.findFirst({
    where: { sourceId: source.id, builtinKey: COMPARA_AGOSTO_TEMPLATE_KEY },
    select: { id: true },
  });
  if (!template) {
    template = await prisma.importTemplate.create({
      data: {
        sourceId: source.id,
        name,
        builtinKey: COMPARA_AGOSTO_TEMPLATE_KEY,
        headerRow: config.headerRow,
        sheetMatchJson: JSON.stringify(config.sheetMatch),
        columnMapJson: JSON.stringify(config.columnMap),
        numberFormatJson: JSON.stringify(config.numberFormat),
        dateFormat: config.dateFormat,
        skipRowRulesJson: JSON.stringify(config.skipRules),
        createdById: userId,
      },
      select: { id: true },
    });
  }
  return { sourceId: source.id, templateId: template.id };
}

/**
 * Importa le righe selezionate (update/create/confirm approvate) in un ciclo
 * liquidazione e le applica a lotti come Incassato da liquidare.
 * Le create e le confirm richiedono selezione esplicita in UI.
 */
export async function importAndApplyComparaAgostoAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      runId: string;
      batchId: string;
      applied: number;
      skipped: number;
      errors: number;
      podFilled: number;
      remaining: number;
    }
  | ComparaAgostoActionError
> {
  try {
    const session = await requireSession();
    if (!canManage(session.role)) {
      return fail("Non hai permesso di applicare l'import Compara");
    }
    const upload = await readUpload(formData);
    if (!upload.ok) return upload;

    const selectedKeys = readSelectedRowKeys(formData);
    if (!selectedKeys || selectedKeys.size === 0) {
      return fail("Seleziona almeno una riga da applicare");
    }

    const fallbackCompetence = readPeriod(formData, "competencePeriod");
    const fallbackSettled = readPeriod(formData, "settledPeriod");
    const plan = await planRows(
      upload.buffer,
      fallbackCompetence,
      fallbackSettled,
    );
    if (!plan.ok) return plan;

    const applicable = plan.planned.filter((row) => {
      if (!selectedKeys.has(comparaAgostoRowKey(row))) return false;
      if (row.action === "unmatched") return false;
      if (row.action === "skip_liquidated") return false;
      if (!row.contractId || row.ruleAmount == null) return false;
      // create e confirm: solo se selezionate (già filtrato)
      return (
        row.action === "update" ||
        row.action === "create" ||
        row.action === "confirm"
      );
    });

    if (applicable.length === 0) {
      return fail(
        "Nessuna riga applicabile tra le selezionate (unmatched / già liquidate escluse)",
      );
    }

    const sha256 = createHash("sha256").update(upload.buffer).digest("hex");
    const duplicate = await prisma.payoutBatch.findUnique({
      where: { sha256 },
      select: { id: true, runId: true, filename: true },
    });
    if (duplicate) {
      return fail(
        `Questo file è già stato importato (${duplicate.filename}): apri la liquidazione collegata`,
      );
    }

    const runLabel =
      String(formData.get("runLabel") ?? "").trim() ||
      `Compara ${periodLabel(plan.competencePeriod)}`;

    let run = await prisma.payoutRun.findUnique({
      where: {
        period_label: { period: plan.settledPeriod, label: runLabel },
      },
      select: { id: true, status: true },
    });
    if (!run) {
      run = await prisma.payoutRun.create({
        data: {
          period: plan.settledPeriod,
          label: runLabel,
          createdById: session.id,
          markMode: "INCASSATO",
        },
        select: { id: true, status: true },
      });
    }
    if (run.status === "CLOSED") {
      return fail("La liquidazione è chiusa");
    }

    const { sourceId, templateId } = await ensureSource(session.id);
    const batch = await prisma.payoutBatch.create({
      data: {
        runId: run.id,
        sourceId,
        templateId,
        filename: upload.fileName.slice(0, 200),
        sha256,
        fileSize: upload.buffer.length,
        status: "PARSED",
        totalRows: applicable.length,
        matchedRows: applicable.filter((r) => r.action !== "confirm").length,
        ambiguousRows: applicable.filter((r) => r.action === "confirm").length,
        unmatchedRows: 0,
        computedTotal: round2(
          applicable.reduce((s, r) => s + (r.ruleAmount ?? 0), 0),
        ),
        uploadedById: session.id,
      },
      select: { id: true },
    });

    await mapWithConcurrency(applicable, INSERT_CONCURRENCY, async (row) => {
      await prisma.payoutRow.create({
        data: {
          batchId: batch.id,
          sheetName: row.sheetName,
          rowIndex: row.rowIndex,
          rawJson: JSON.stringify({
            ...row.parsed.raw,
            _comparaAction: row.action,
            _proposedPodFill: row.proposedPodFill ?? null,
            _podFillMode: row.podFillMode,
          }),
          podRaw: row.podRaw || null,
          podKey: row.parsed.podKeys[0] ?? null,
          clientNameRaw: row.nominativo || null,
          supplierHint: row.supplierHint || null,
          collaboratorHint: row.collaboratorName || null,
          amount: row.ruleAmount,
          period: plan.competencePeriod,
          // confirm selezionate da Michele → MATCHED per l'apply
          matchStatus: "MATCHED",
          matchScore: row.matchScore ?? null,
          matchReason: row.matchReason ?? row.action,
          contractId: row.contractId!,
          collaboratorId: row.crmCollaboratorId,
          candidateIdsJson:
            row.candidateIds.length > 0
              ? JSON.stringify(row.candidateIds)
              : null,
          note: [
            `Compara ${row.action}`,
            row.skipReason,
            row.proposedPodFill ? `POD fill=${row.proposedPodFill}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 200),
        },
      });
    });

    // Apply lotto (stesso pattern liquidazioni)
    let applied = 0;
    let skipped = 0;
    let errors = 0;
    let podFilled = 0;
    let guard = 0;
    for (;;) {
      const pending = await prisma.payoutRow.findMany({
        where: { batchId: batch.id, matchStatus: "MATCHED", appliedAt: null },
        select: {
          id: true,
          contractId: true,
          period: true,
          amount: true,
          rawJson: true,
          note: true,
        },
        take: APPLY_BATCH_SIZE,
        orderBy: { id: "asc" },
      });
      if (pending.length === 0) break;

      for (const row of pending) {
        if (!row.contractId) {
          skipped++;
          continue;
        }
        try {
          let proposedPod: string | null = null;
          try {
            const raw = JSON.parse(row.rawJson) as {
              _proposedPodFill?: string | null;
              _podFillMode?: string;
            };
            if (
              raw._proposedPodFill &&
              (raw._podFillMode === "safe_prefill" ||
                raw._podFillMode === "needs_confirm")
            ) {
              proposedPod = String(raw._proposedPodFill).trim();
            }
          } catch {
            proposedPod = null;
          }

          if (proposedPod) {
            const contract = await prisma.contract.findUnique({
              where: { id: row.contractId },
              select: { podPdr: true, pod: true, pdr: true },
            });
            const crmKey = normalizePodKey(
              contract?.podPdr || contract?.pod || contract?.pdr || "",
            );
            const fileKey = normalizePodKey(proposedPod);
            // Scrive solo se CRM vuoto; se diverso e needs_confirm, Michele ha
            // selezionato la riga → consente la sostituzione esplicita
            const canWrite = !crmKey || crmKey === fileKey || Boolean(proposedPod);
            if (canWrite && fileKey && crmKey !== fileKey) {
              const looksLikePod = /^IT/i.test(proposedPod);
              await prisma.contract.update({
                where: { id: row.contractId },
                data: looksLikePod
                  ? { pod: proposedPod, podPdr: proposedPod }
                  : { pdr: proposedPod, podPdr: proposedPod },
              });
              podFilled++;
            } else if (canWrite && fileKey && !crmKey) {
              const looksLikePod = /^IT/i.test(proposedPod);
              await prisma.contract.update({
                where: { id: row.contractId },
                data: looksLikePod
                  ? { pod: proposedPod, podPdr: proposedPod }
                  : { pdr: proposedPod, podPdr: proposedPod },
              });
              podFilled++;
            }
          }

          const outcome = await applyPayoutRowMark({
            contractId: row.contractId,
            period: row.period ?? plan.competencePeriod,
            settledPeriod: plan.settledPeriod,
            amount: row.amount == null ? null : decimalToNumber(row.amount),
            markMode: "INCASSATO",
            note: `Import Compara Agosto · competenza ${plan.competencePeriod}`,
          });

          if (!outcome.ok) {
            await prisma.payoutRow.update({
              where: { id: row.id },
              data: {
                matchStatus: "IGNORED",
                note: outcome.reason.slice(0, 200),
                appliedAt: new Date(),
              },
            });
            skipped++;
            continue;
          }

          await prisma.payoutRow.update({
            where: { id: row.id },
            data: {
              matchStatus: "APPLIED",
              appliedAt: new Date(),
              recurringMonthId: outcome.recurringMonthId,
              previousStateJson: JSON.stringify(outcome.previousState),
            },
          });
          applied++;
        } catch (e) {
          console.error("[importAndApplyComparaAgostoAction]", row.id, e);
          await prisma.payoutRow
            .update({
              where: { id: row.id },
              data: {
                matchStatus: "ERROR",
                note: errorMessage(e, "Errore").slice(0, 200),
              },
            })
            .catch(() => undefined);
          errors++;
        }
      }

      guard += 1;
      if (guard > 500) break;
    }

    const remaining = await prisma.payoutRow.count({
      where: { batchId: batch.id, matchStatus: "MATCHED", appliedAt: null },
    });

    await prisma.payoutBatch.update({
      where: { id: batch.id },
      data: {
        status: remaining > 0 ? "PARTIALLY_APPLIED" : "APPLIED",
        appliedAt: remaining > 0 ? undefined : new Date(),
      },
    });
    if (remaining === 0) {
      await prisma.payoutRun.update({
        where: { id: run.id },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
    }

    await writeAuditLog({
      userId: session.id,
      action: "IMPORT",
      entity: "PayoutBatch",
      entityId: batch.id,
      details: {
        template: COMPARA_AGOSTO_TEMPLATE_KEY,
        competencePeriod: plan.competencePeriod,
        settledPeriod: plan.settledPeriod,
        applied,
        skipped,
        errors,
        podFilled,
        selected: selectedKeys.size,
      },
    });

    revalidatePath("/provvigioni");
    revalidatePath("/provvigioni/liquidazioni");
    revalidatePath(`/provvigioni/liquidazioni/${run.id}`);

    return {
      ok: true,
      runId: run.id,
      batchId: batch.id,
      applied,
      skipped,
      errors,
      podFilled,
      remaining,
    };
  } catch (e) {
    logPrismaError("importAndApplyComparaAgostoAction", e);
    return fail(errorMessage(e, "Applicazione Compara non riuscita"));
  }
}
