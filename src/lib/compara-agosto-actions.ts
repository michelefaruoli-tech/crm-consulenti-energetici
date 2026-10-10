"use server";

/**
 * Import Compara Agosto: anteprima obbligatoria con checkbox, regole importo
 * (Faruoli/Lucio 80/80, Fagiano 70/65, altri 70/60), celle editabili in UI,
 * create da unmatched (stub), fill POD senza overwrite automatico.
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
  effectiveCrmPod,
  isPlaceholderPod,
  podsEquivalent,
  shouldWritePodFromFile,
} from "@/lib/payout/normalize";
import { provvigioneStatoActionKind } from "@/lib/provvigioni-stato";
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
import { classifyComparaAgostoAction } from "@/lib/compara-agosto/classify";
import { createComparaStubContract } from "@/lib/compara-agosto/create-stub";
import { decidePodFill } from "@/lib/compara-agosto/pod-fill";
import { deduceComparaPeriods } from "@/lib/compara-agosto/periods";
import {
  comparaSupplierDisplayLabel,
  resolveComparaSupplierMatch,
} from "@/lib/compara-agosto/supplier-match";
import {
  COMPARA_AGOSTO_TEMPLATE_KEY,
  COMPARA_AGOSTO_TEMPLATE_LABEL,
  comparaAgostoTemplateConfig,
} from "@/lib/compara-agosto/template";
import { readComparaUnits } from "@/lib/compara-agosto/units";
import {
  comparaAgostoRowKey,
  comparaSuggestionForRow,
  parseComparaRowEditsJson,
  type ComparaAgostoActionError,
  type ComparaAgostoPreviewResult,
  type ComparaAgostoPreviewRow,
  type ComparaAgostoRowEdit,
} from "@/lib/compara-agosto/view-types";
import { loadVisibleCollaboratorOptions } from "@/lib/user-scope";

const STATO_INCASSATO = "Incassato da liquidare";
const STATO_LIQUIDATO = "Liquidato";
const STATO_DA_INCASSARE = "Da incassare";

/** Mostra tutti i nominativi del foglio (niente filtri che ne nascondono). */
const PREVIEW_ROW_LIMIT = 2500;
const APPLY_BATCH_SIZE = 8;
/** Neon HTTP: pochi write paralleli evitano statement/timeout. */
const INSERT_CONCURRENCY = 2;
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
  // Preferisci il collaboratore CRM (Fagiano/Laforgia/…); Shop file spesso è Faruoli master
  if (contractName?.trim()) return contractName.trim();
  return shopHint.trim();
}

function readRowEdits(
  formData: FormData,
): Map<string, ComparaAgostoRowEdit> {
  return parseComparaRowEditsJson(String(formData.get("rowEdits") ?? ""));
}

function crmStatoFromFinance(
  fin:
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
    | undefined,
  competencePeriod: string,
): string {
  if (!fin) return STATO_DA_INCASSARE;
  if (isRecurringMonthly(fin.recurrence)) {
    const month = fin.recurringByPeriod.get(competencePeriod);
    if (month?.status === "LIQUIDATED") return STATO_LIQUIDATO;
    if (month?.status === "PAID") return STATO_INCASSATO;
    return STATO_DA_INCASSARE;
  }
  if (
    fin.status === "PROVVIGIONE_LIQUIDATA" ||
    (fin.commissionPaid > 0 && fin.paymentStatus === "Pagato")
  ) {
    return STATO_LIQUIDATO;
  }
  if (
    fin.paymentStatus === "Incassato" ||
    fin.status === "PAGATO_DAL_FORNITORE"
  ) {
    return STATO_INCASSATO;
  }
  return STATO_DA_INCASSARE;
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
    mismatchedSupplierName: string | null;
  }> = [];

  for (const row of parsed.rows) {
    const withPeriod: ParsedPayoutRow = {
      ...row,
      period: row.period ?? periods.competencePeriod,
    };
    const outcome = matchPayoutRow(withPeriod, index);
    let matched: PayoutCandidate | null = null;
    let ambiguous = false;
    let matchReason: string | null = null;
    let matchScore: number | null = null;
    let candidateIds: string[] = [];

    if (outcome.status === "unmatched") {
      // resta unmatched
    } else if (outcome.status === "ambiguous") {
      matched = outcome.candidates[0] ?? null;
      ambiguous = true;
      matchReason = outcome.reason;
      matchScore = outcome.score;
      candidateIds = outcome.candidates.map((c) => c.id);
    } else {
      matched = outcome.contract;
      matchReason = outcome.reason;
      matchScore = outcome.score;
      candidateIds = [outcome.contract.id];
    }

    // Fornitore file ≠ contratto matchato (es. Iren vs Plenitude Liquidata):
    // alternativa compatibile, altrimenti da caricare (conferma + collab).
    const resolved = resolveComparaSupplierMatch({
      index,
      row: withPeriod,
      matched,
      ambiguous,
      matchReason,
      matchScore,
      candidateIds,
    });

    draft.push({
      parsed: withPeriod,
      contract: resolved.contract,
      ambiguous: resolved.ambiguous,
      matchReason: resolved.matchReason,
      matchScore: resolved.matchScore,
      candidateIds: resolved.candidateIds,
      mismatchedSupplierName: resolved.mismatchedSupplierName,
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
    const crmPod = d.contract
      ? (fin?.podPdr || fin?.pod || fin?.pdr || d.contract.podPdr || "").trim()
      : "";
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
    const filePodRaw = d.parsed.podRaw.trim();
    const fileUsable =
      Boolean(filePodRaw) && !isPlaceholderPod(filePodRaw);
    const filePodKey = fileUsable ? normalizePodKey(filePodRaw) : "";
    const crmEffective = effectiveCrmPod(crmPod);
    const crmPodKey = crmEffective ? normalizePodKey(crmEffective) : "";
    // Fill se file ha POD reale e CRM è vuoto/segnaposto (XXXX…).
    // Se manca solo lo 00, podsEquivalent → già ok, non «inserisci».
    const podNeedsFill = Boolean(filePodKey && !crmPodKey);
    const podAlreadyOk =
      Boolean(
        fileUsable && crmEffective && podsEquivalent(filePodRaw, crmEffective),
      ) || (!filePodKey && Boolean(crmPodKey));
    const classified = classifyComparaAgostoAction({
      hasContract: Boolean(d.contract),
      finance: fin,
      competencePeriod: periods.competencePeriod,
      ambiguous: d.ambiguous,
      podNeedsConfirm: podDecision.mode === "needs_confirm",
      podNeedsFill,
      podAlreadyOk,
      amount: rule.amount,
    });
    const crmStato = crmStatoFromFinance(fin, periods.competencePeriod);
    const suggestion = comparaSuggestionForRow({
      action: classified.action,
      podNeedsFill,
    });
    // Assente, o Liquidata di altro fornitore senza Incassato compatibile → da caricare
    const presence =
      d.contract == null
        ? ("needs_create" as const)
        : ("present" as const);
    const fileSupplierLabel = comparaSupplierDisplayLabel(
      d.parsed.supplierHint || d.contract?.supplierName,
    );
    const presenceNote =
      presence === "needs_create"
        ? d.mismatchedSupplierName
          ? `In CRM c’è ${d.mismatchedSupplierName} (altro fornitore): conferma per caricare ${fileSupplierLabel}`
          : "Non in Provvigioni: conferma caricamento e scegli il collaboratore"
        : undefined;
    const proposedStato =
      presence === "present" && crmStato
        ? crmStato
        : STATO_INCASSATO;
    const displayPod =
      podDecision.proposedPodFill ||
      d.parsed.podRaw.trim() ||
      crmPod ||
      "";

    const matchReasonLabel =
      d.matchReason === "supplier_mismatch_create"
        ? "Fornitore diverso → da caricare"
        : d.matchReason === "supplier_compatible"
          ? "Match fornitore file"
          : d.matchReason
            ? (PAYOUT_MATCH_REASON_LABEL[
                d.matchReason as keyof typeof PAYOUT_MATCH_REASON_LABEL
              ] ?? d.matchReason)
            : undefined;

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
      action:
        presence === "needs_create"
          ? "unmatched"
          : classified.action,
      presence,
      presenceNote,
      suggestion,
      suggestionLabel:
        presence === "needs_create"
          ? `Da caricare (${fileSupplierLabel})`
          : undefined,
      matchReason: matchReasonLabel,
      matchScore: d.matchScore ?? undefined,
      contractId: d.contract?.id,
      contractNumber: d.contract?.contractNumber,
      crmClientName: d.contract?.clientName,
      crmPod: crmPod || undefined,
      supplierName: d.contract?.supplierName,
      collaboratorName: collabName || undefined,
      collaboratorId: d.contract?.collaboratorId,
      crmStato,
      proposedStato,
      isFagiano: fagiano,
      fagianoMissingPodInFile: fagiano && !d.parsed.podRaw.trim(),
      podNeedsFill,
      podFillMode: podDecision.mode,
      proposedPodFill: displayPod || undefined,
      skipReason: classified.skipReason ?? podDecision.reason ?? undefined,
      existingLiquidatedAmount: classified.existingLiquidatedAmount,
      defaultRowLabel: `Compara ${periodLabel(periods.competencePeriod)}`,
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
            : classified.action === "skip_liquidated" ||
                classified.action === "already_ok"
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
    crmCollaboratorId,
    ...rest
  } = row;
  return {
    ...rest,
    collaboratorId: rest.collaboratorId ?? crmCollaboratorId ?? undefined,
  };
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
      present: 0,
      needsCreate: 0,
      update: 0,
      create: 0,
      confirm: 0,
      unmatched: 0,
      skipLiquidated: 0,
      alreadyOk: 0,
      fagianoRows: 0,
      fagianoMissingPod: 0,
      fagianoProbableMatch: 0,
      fagianoPodPrefill: 0,
      fagianoPodConfirm: 0,
      ruleAmountTotal: 0,
    };

    for (const row of plan.planned) {
      if (row.presence === "present") summary.present++;
      else summary.needsCreate++;
      if (row.action === "update") summary.update++;
      else if (row.action === "create") summary.create++;
      else if (row.action === "confirm") summary.confirm++;
      else if (row.action === "unmatched") summary.unmatched++;
      else if (row.action === "skip_liquidated") summary.skipLiquidated++;
      else if (row.action === "already_ok") summary.alreadyOk++;

      if (row.isFagiano) {
        fagianoRows++;
        if (row.fagianoMissingPodInFile) fagianoMissingPod++;
        if (row.contractId) fagianoProbableMatch++;
        if (row.podFillMode === "safe_prefill" || row.podFillMode === "display_from_crm") {
          fagianoPodPrefill++;
        }
        if (row.podFillMode === "needs_confirm") fagianoPodConfirm++;
      }
      if (row.ruleAmount != null) {
        ruleAmountTotal += row.ruleAmount;
      }
    }
    summary.fagianoRows = fagianoRows;
    summary.fagianoMissingPod = fagianoMissingPod;
    summary.fagianoProbableMatch = fagianoProbableMatch;
    summary.fagianoPodPrefill = fagianoPodPrefill;
    summary.fagianoPodConfirm = fagianoPodConfirm;
    summary.ruleAmountTotal = round2(ruleAmountTotal);

    const collaborators = await loadVisibleCollaboratorOptions(session);
    const defaultRunLabel = `Compara ${periodLabel(plan.competencePeriod)}`;

    return {
      ok: true,
      fileName: upload.fileName,
      competencePeriod: plan.competencePeriod,
      settledPeriod: plan.settledPeriod,
      defaultRunLabel,
      sheetsRead: plan.sheetsRead,
      rows: plan.planned.slice(0, PREVIEW_ROW_LIMIT).map(toPreviewRow),
      collaborators: collaborators.map((c) => ({ id: c.id, name: c.name })),
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

type ApplicableRow = PlannedRow & {
  effectiveAmount: number;
  effectiveCollaboratorId: string;
  effectiveCollaboratorName: string;
  effectiveRowLabel: string;
  effectivePodFill: string;
  effectiveNominativo: string;
  effectiveSupplier: string;
  effectiveStato: string;
  markMode: "INCASSATO" | "LIQUIDATO";
  isStubCreate: boolean;
  /** Solo fill POD: rata già nello stato target. */
  podOnly: boolean;
};

/**
 * Importa le righe selezionate (anche «senza match» con stub) usando i valori
 * editati in UI (importo, collaboratore, etichetta, POD). Solo checkbox spuntate.
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
      stubsCreated: number;
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

    const rowEdits = readRowEdits(formData);
    const fallbackCompetence = readPeriod(formData, "competencePeriod");
    const fallbackSettled = readPeriod(formData, "settledPeriod");
    const plan = await planRows(
      upload.buffer,
      fallbackCompetence,
      fallbackSettled,
    );
    if (!plan.ok) return plan;

    const defaultRunLabel =
      String(formData.get("runLabel") ?? "").trim() ||
      `Compara ${periodLabel(plan.competencePeriod)}`;

    const applicable: ApplicableRow[] = [];
    const missingCollab: string[] = [];
    const missingCreateConfirm: string[] = [];
    for (const row of plan.planned) {
      const key = comparaAgostoRowKey(row);
      if (!selectedKeys.has(key)) continue;

      const edit = rowEdits.get(key);
      const amount = edit?.amount ?? row.ruleAmount;
      if (amount == null || !Number.isFinite(amount)) continue;

      const collaboratorId = (
        edit?.collaboratorId ||
        row.collaboratorId ||
        row.crmCollaboratorId ||
        ""
      ).trim();
      const collaboratorName = (
        edit?.collaboratorName ||
        row.collaboratorName ||
        row.shopHint ||
        ""
      ).trim();
      const rowLabel = (
        edit?.rowLabel ||
        row.defaultRowLabel ||
        defaultRunLabel
      ).trim();
      const podFill = (
        edit?.pod ||
        row.proposedPodFill ||
        row.podRaw ||
        ""
      ).trim();
      const nominativo = (
        edit?.nominativo ||
        row.nominativo ||
        ""
      ).trim();
      // Preferisci fornitore del file (edit/hint), non quello della Liquidata altrui
      const supplier = (
        edit?.supplier ||
        row.supplierHint ||
        row.supplierName ||
        ""
      ).trim();
      const stato = (edit?.stato || row.proposedStato || STATO_INCASSATO).trim();
      const statoKind = provvigioneStatoActionKind(stato);
      const markMode: "INCASSATO" | "LIQUIDATO" =
        statoKind === "liquidato" ? "LIQUIDATO" : "INCASSATO";
      const alreadyTarget =
        (markMode === "INCASSATO" && row.crmStato === STATO_INCASSATO) ||
        (markMode === "LIQUIDATO" && row.crmStato === STATO_LIQUIDATO);
      const podOnly =
        alreadyTarget && shouldWritePodFromFile(podFill, row.crmPod || "");

      // Non presente / fornitore diverso → stub solo con conferma esplicita
      const needsStub =
        row.presence === "needs_create" ||
        row.action === "unmatched" ||
        (row.action === "create" && !row.contractId);
      if (needsStub) {
        if (!edit?.createConfirmed) {
          missingCreateConfirm.push(nominativo || key);
          continue;
        }
        if (!collaboratorId) {
          missingCollab.push(nominativo || key);
          continue;
        }
        applicable.push({
          ...row,
          effectiveAmount: amount,
          effectiveCollaboratorId: collaboratorId,
          effectiveCollaboratorName: collaboratorName,
          effectiveRowLabel: rowLabel || defaultRunLabel,
          effectivePodFill: podFill || row.podRaw.trim(),
          effectiveNominativo: nominativo,
          effectiveSupplier: supplier || row.supplierHint || "Compara",
          effectiveStato: stato,
          markMode,
          isStubCreate: true,
          podOnly: false,
        });
        continue;
      }

      // Presente: salva aggiorna la scheda (anche se era already_ok / liquidata stesso fornitore)
      if (!row.contractId) continue;

      applicable.push({
        ...row,
        effectiveAmount: amount,
        effectiveCollaboratorId: collaboratorId,
        effectiveCollaboratorName: collaboratorName,
        effectiveRowLabel: rowLabel || defaultRunLabel,
        effectivePodFill: podFill,
        effectiveNominativo: nominativo,
        effectiveSupplier: supplier,
        effectiveStato: stato,
        markMode,
        isStubCreate: false,
        podOnly,
      });
    }

    if (missingCreateConfirm.length > 0) {
      return fail(
        "Per i nominativi non in Provvigioni conferma il caricamento e scegli a nome di chi",
        missingCreateConfirm.slice(0, 8),
      );
    }

    if (missingCollab.length > 0) {
      return fail(
        "Senza corrispondenza: scegli un collaboratore sulle righe selezionate",
        missingCollab.slice(0, 8),
      );
    }
    if (applicable.length === 0) {
      return fail(
        "Nessuna riga applicabile tra le selezionate (già liquidate escluse; importo richiesto)",
      );
    }

    // Stub Client+Contract+Commission uno-a-uno (Neon HTTP: no nested/tx)
    let stubsCreated = 0;
    const stubFailures: string[] = [];
    for (const row of applicable) {
      if (!row.isStubCreate) continue;
      try {
        const stub = await createComparaStubContract({
          nominativo: row.effectiveNominativo || row.nominativo,
          supplierHint: row.effectiveSupplier || row.supplierHint || "Compara",
          collaboratorId: row.effectiveCollaboratorId,
          createdById: session.id,
          podRaw: row.effectivePodFill || row.podRaw,
          amount: row.effectiveAmount,
          competencePeriod: plan.competencePeriod,
          note: `${row.sheetName}:${row.rowIndex}`,
        });
        row.contractId = stub.contractId;
        row.contractNumber = stub.contractNumber;
        row.crmCollaboratorId = row.effectiveCollaboratorId;
        row.action = "create";
        stubsCreated++;
      } catch (e) {
        logPrismaError("createComparaStubContract", e);
        stubFailures.push(
          `${row.effectiveNominativo || row.nominativo}: ${errorMessage(e, "stub")}`,
        );
        row.contractId = undefined;
      }
    }
    // Escludi stub falliti dal resto dell'apply (le altre righe proseguono)
    const applicableOk = applicable.filter(
      (r) => !r.isStubCreate || Boolean(r.contractId),
    );
    if (applicableOk.length === 0 && stubFailures.length > 0) {
      return fail(
        "Creazione righe non riuscita (limite database o dati). Riprova.",
        stubFailures.slice(0, 8),
      );
    }

    // Patch collaboratore CRM se modificato in UI (contratti già esistenti)
    for (const row of applicableOk) {
      if (row.isStubCreate) continue;
      if (!row.contractId || !row.effectiveCollaboratorId) continue;
      if (row.effectiveCollaboratorId === row.crmCollaboratorId) continue;
      try {
        await prisma.contract.update({
          where: { id: row.contractId },
          data: { collaboratorId: row.effectiveCollaboratorId },
        });
        row.crmCollaboratorId = row.effectiveCollaboratorId;
      } catch (e) {
        logPrismaError("comparaCollabPatch", e);
      }
    }

    // Raggruppa per etichetta liquidazione (run)
    const byLabel = new Map<string, ApplicableRow[]>();
    for (const row of applicableOk) {
      const label = row.effectiveRowLabel || defaultRunLabel;
      const list = byLabel.get(label) ?? [];
      list.push(row);
      byLabel.set(label, list);
    }

    const { sourceId, templateId } = await ensureSource(session.id);
    let totalApplied = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalPodFilled = 0;
    let totalRemaining = 0;
    let primaryRunId = "";
    let primaryBatchId = "";

    for (const [runLabel, group] of byLabel) {
      // Hash unico per ogni salvataggio (stesso file può salvare a lotti/ripetuti)
      const rowFingerprint = group
        .map((r) => `${r.sheetName}:${r.rowIndex}`)
        .sort()
        .join(",");
      const sha256 = createHash("sha256")
        .update(upload.buffer)
        .update("\0")
        .update(runLabel)
        .update("\0")
        .update(rowFingerprint)
        .update("\0")
        .update(String(Date.now()))
        .update("\0")
        .update(String(Math.random()))
        .digest("hex");

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
        return fail(`La liquidazione «${runLabel}» è chiusa`);
      }

      const batch = await prisma.payoutBatch.create({
        data: {
          runId: run.id,
          sourceId,
          templateId,
          filename: upload.fileName.slice(0, 200),
          sha256,
          fileSize: upload.buffer.length,
          status: "PARSED",
          totalRows: group.length,
          matchedRows: group.filter((r) => r.action !== "confirm").length,
          ambiguousRows: group.filter((r) => r.action === "confirm").length,
          unmatchedRows: 0,
          computedTotal: round2(
            group.reduce((s, r) => s + r.effectiveAmount, 0),
          ),
          uploadedById: session.id,
        },
        select: { id: true },
      });

      if (!primaryRunId) {
        primaryRunId = run.id;
        primaryBatchId = batch.id;
      }

      // Insert sequenziali a bassa concorrenza; un fallimento non abortisce il lotto
      await mapWithConcurrency(group, INSERT_CONCURRENCY, async (row) => {
        try {
          await prisma.payoutRow.create({
            data: {
              batchId: batch.id,
              sheetName: row.sheetName,
              rowIndex: row.rowIndex,
              rawJson: JSON.stringify({
                ...row.parsed.raw,
                _comparaAction: row.action,
                _proposedPodFill: row.effectivePodFill || null,
                _podFillMode: row.podFillMode,
                _uiAmount: row.effectiveAmount,
                _uiCollaboratorId: row.effectiveCollaboratorId,
                _stubCreate: row.isStubCreate,
                _markMode: row.markMode,
                _podOnly: row.podOnly,
                _uiStato: row.effectiveStato,
              }),
              podRaw: row.effectivePodFill || row.podRaw || null,
              podKey: row.parsed.podKeys[0] ?? null,
              clientNameRaw: row.effectiveNominativo || row.nominativo || null,
              supplierHint: row.effectiveSupplier || row.supplierHint || null,
              collaboratorHint:
                row.effectiveCollaboratorName || row.collaboratorName || null,
              amount: row.effectiveAmount,
              period: plan.competencePeriod,
              matchStatus: "MATCHED",
              matchScore: row.matchScore ?? null,
              matchReason: row.matchReason ?? row.action,
              contractId: row.contractId!,
              collaboratorId:
                row.effectiveCollaboratorId || row.crmCollaboratorId,
              candidateIdsJson:
                row.candidateIds.length > 0
                  ? JSON.stringify(row.candidateIds)
                  : null,
              note: [
                `Compara ${row.action}`,
                row.isStubCreate ? "stub creato" : null,
                row.skipReason,
                row.effectivePodFill
                  ? `POD fill=${row.effectivePodFill}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
                .slice(0, 200),
            },
          });
        } catch (e) {
          logPrismaError("comparaPayoutRowCreate", e);
          totalErrors += 1;
        }
      });

      let applied = 0;
      let skipped = 0;
      let errors = 0;
      let podFilled = 0;
      let guard = 0;
      for (;;) {
        const pending = await prisma.payoutRow.findMany({
          where: {
            batchId: batch.id,
            matchStatus: "MATCHED",
            appliedAt: null,
          },
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

        for (const prow of pending) {
          if (!prow.contractId) {
            skipped++;
            continue;
          }
          try {
            let proposedPod: string | null = null;
            let podOnly = false;
            let markMode: "INCASSATO" | "LIQUIDATO" = "INCASSATO";
            try {
              const raw = JSON.parse(prow.rawJson) as {
                _proposedPodFill?: string | null;
                _podOnly?: boolean;
                _markMode?: string;
              };
              proposedPod = raw._proposedPodFill
                ? String(raw._proposedPodFill).trim()
                : null;
              podOnly = raw._podOnly === true;
              if (raw._markMode === "LIQUIDATO") markMode = "LIQUIDATO";
            } catch {
              proposedPod = null;
            }

            if (proposedPod) {
              // Storno / stato contratto non bloccano la scrittura se riga confermata
              const contract = await prisma.contract.findUnique({
                where: { id: prow.contractId },
                select: { podPdr: true, pod: true, pdr: true },
              });
              const crmRaw =
                contract?.podPdr || contract?.pod || contract?.pdr || "";
              if (shouldWritePodFromFile(proposedPod, crmRaw)) {
                const looksLikePod = /^IT/i.test(proposedPod);
                await prisma.contract.update({
                  where: { id: prow.contractId },
                  data: looksLikePod
                    ? { pod: proposedPod, podPdr: proposedPod }
                    : { pdr: proposedPod, podPdr: proposedPod },
                });
                podFilled++;
              }
            }

            if (podOnly) {
              // Rata già nello stato richiesto: solo fill POD, niente overwrite importo/stato
              await prisma.payoutRow.update({
                where: { id: prow.id },
                data: {
                  matchStatus: "APPLIED",
                  appliedAt: new Date(),
                  note: "Compara: solo POD (stato già ok)".slice(0, 200),
                },
              });
              applied++;
              continue;
            }

            const outcome = await applyPayoutRowMark({
              contractId: prow.contractId,
              period: prow.period ?? plan.competencePeriod,
              settledPeriod: plan.settledPeriod,
              amount:
                prow.amount == null ? null : decimalToNumber(prow.amount),
              markMode,
              note: `Import Compara Agosto · competenza ${plan.competencePeriod}`,
            });

            if (!outcome.ok) {
              // Se fallisce solo perché già nello stato, e abbiamo scritto POD → ok
              if (
                outcome.reason.includes("già nello stato") &&
                proposedPod
              ) {
                await prisma.payoutRow.update({
                  where: { id: prow.id },
                  data: {
                    matchStatus: "APPLIED",
                    appliedAt: new Date(),
                    note: "Compara: POD applicato, stato già ok".slice(0, 200),
                  },
                });
                applied++;
                continue;
              }
              await prisma.payoutRow.update({
                where: { id: prow.id },
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
              where: { id: prow.id },
              data: {
                matchStatus: "APPLIED",
                appliedAt: new Date(),
                recurringMonthId: outcome.recurringMonthId,
                previousStateJson: JSON.stringify(outcome.previousState),
              },
            });
            applied++;
          } catch (e) {
            console.error("[importAndApplyComparaAgostoAction]", prow.id, e);
            await prisma.payoutRow
              .update({
                where: { id: prow.id },
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
        where: {
          batchId: batch.id,
          matchStatus: "MATCHED",
          appliedAt: null,
        },
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
          runLabel,
          applied,
          skipped,
          errors,
          podFilled,
          stubsCreated,
          selected: selectedKeys.size,
        },
      });

      totalApplied += applied;
      totalSkipped += skipped;
      totalErrors += errors;
      totalPodFilled += podFilled;
      totalRemaining += remaining;
      revalidatePath(`/provvigioni/liquidazioni/${run.id}`);
    }

    revalidatePath("/provvigioni");
    revalidatePath("/provvigioni/liquidazioni");

    return {
      ok: true,
      runId: primaryRunId,
      batchId: primaryBatchId,
      applied: totalApplied,
      skipped: totalSkipped,
      errors: totalErrors,
      podFilled: totalPodFilled,
      stubsCreated,
      remaining: totalRemaining,
    };
  } catch (e) {
    logPrismaError("importAndApplyComparaAgostoAction", e);
    return fail(errorMessage(e, "Applicazione Compara non riuscita"));
  }
}
