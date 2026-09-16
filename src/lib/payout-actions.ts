"use server";

/**
 * Ciclo di liquidazione provvigioni: import da fonti eterogenee, anteprima
 * obbligatoria, applicazione idempotente, rettifiche manuali, report e invio.
 *
 * Vincoli di piattaforma rispettati qui:
 * - nessuna transazione (adapter Neon HTTP): ogni operazione di massa è
 *   ripetibile e procede a lotti, con lo stato a database;
 * - 60 secondi per invocazione: le azioni di massa elaborano un lotto e
 *   dichiarano quanto resta, l'interfaccia richiama finché non ha finito.
 */

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { getMasterEmail } from "@/lib/mail";
import { clientDisplayName } from "@/lib/utils";
import { decimalToNumber, formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import { contractVisibilityWhere } from "@/lib/user-scope";
import {
  applyPayoutRowMark,
  parsePreviousState,
  revertPayoutRowMark,
} from "@/lib/payout/apply";
import {
  loadPayoutContractIndex,
  matchPayoutRow,
  PAYOUT_MATCH_REASON_LABEL,
  type PayoutContractIndex,
} from "@/lib/payout/match";
import { parsePayoutWorkbook } from "@/lib/payout/parse";
import {
  buildPayoutReportPdf,
  buildPayoutReportXlsx,
  payoutReportFileBase,
} from "@/lib/payout/report-doc";
import { findBuiltinTemplate, listBuiltinTemplates } from "@/lib/payout/templates";
import {
  buildPayoutSnapshot,
  loadPayoutRunTotals,
  parsePayoutSnapshot,
  type PayoutCollaboratorTotal,
} from "@/lib/payout/totals";
import type {
  ParsedPayoutRow,
  PayoutTemplateConfig,
} from "@/lib/payout/types";
import {
  BULK_HISTORICAL_PERIOD_LIMIT,
  BULK_SKIP_REASON_LABEL,
  buildBulkHistoricalPlan,
  type BulkHistoricalExclusionMode,
} from "@/lib/payout/bulk-historical";
import type { PayoutMarkMode } from "@/lib/payout/apply";
import type {
  BulkHistoricalPreviewResult,
  PayoutActionError,
  PayoutBatchProgress,
  PayoutPreviewResult,
  PayoutPreviewRow,
  PayoutPreviewRowStatus,
} from "@/lib/payout/view-types";

export type {
  BulkHistoricalPreviewResult,
  PayoutActionError,
  PayoutBatchProgress,
  PayoutPreviewResult,
  PayoutPreviewRow,
  PayoutPreviewRowStatus,
} from "@/lib/payout/view-types";

/** Righe mostrate in anteprima: il conteggio resta sul totale. */
const PREVIEW_ROW_LIMIT = 300;

/** Righe applicate per invocazione, per stare sotto i 60 secondi. */
const APPLY_BATCH_SIZE = 40;

/** Report generati per invocazione. */
const REPORT_BATCH_SIZE = 8;

/** Email inviate per invocazione. */
const EMAIL_BATCH_SIZE = 5;

/** Inserimenti concorrenti verso Neon HTTP durante la creazione delle righe. */
const INSERT_CONCURRENCY = 20;

const PERIOD_RE = /^\d{4}-\d{2}$/;

function fail(error: string, details?: string[]): PayoutActionError {
  return { ok: false, error, details };
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message.slice(0, 200) : fallback;
}

/** L'import e la liquidazione sono operazioni di Master. */
function canManagePayout(role: Parameters<typeof hasPermission>[0]): boolean {
  return hasPermission(role, "commissions.edit_gettone");
}

/** Marcatura massiva storica: solo amministratore. */
function canBulkHistorical(role: Parameters<typeof hasPermission>[0]): boolean {
  return role === "ADMIN";
}

const BULK_HISTORICAL_PREVIEW_SAMPLE = 80;
const BULK_HISTORICAL_SKIPPED_SAMPLE = 40;

type BulkHistoricalParams = {
  periodLimit: string;
  markMode: PayoutMarkMode;
  exclusionMode: BulkHistoricalExclusionMode;
};

function readBulkHistoricalParams(
  formData: FormData,
): BulkHistoricalParams | PayoutActionError {
  const periodLimit =
    String(formData.get("periodLimit") ?? BULK_HISTORICAL_PERIOD_LIMIT).trim();
  if (!PERIOD_RE.test(periodLimit)) {
    return fail("Mese limite non valido (formato YYYY-MM)");
  }
  const markRaw = String(formData.get("markMode") ?? "LIQUIDATO").trim();
  const markMode: PayoutMarkMode =
    markRaw === "INCASSATO" ? "INCASSATO" : "LIQUIDATO";
  const exclRaw = String(formData.get("exclusionMode") ?? "ACTIVE_ONLY").trim();
  const exclusionMode: BulkHistoricalExclusionMode =
    exclRaw === "TOTAL" ? "TOTAL" : "ACTIVE_ONLY";
  return { periodLimit, markMode, exclusionMode };
}

function planToPreview(
  plan: import("@/lib/payout/bulk-historical").BulkHistoricalPlan,
): BulkHistoricalPreviewResult {
  return {
    ok: true,
    supplierName: plan.supplierName,
    periodLimit: plan.periodLimit,
    markMode: plan.markMode,
    exclusionMode: plan.exclusionMode,
    excludedCollaboratorPatterns: plan.excludedCollaboratorPatterns,
    runLabel: plan.runLabel,
    signature: plan.signature,
    summary: plan.summary,
    byCollaborator: plan.byCollaborator,
    byMonth: plan.byMonth,
    skippedByReason: plan.skippedByReason.map((s) => ({
      reason: s.reason,
      label: BULK_SKIP_REASON_LABEL[s.reason],
      count: s.count,
    })),
    sampleRows: plan.toApply.slice(0, BULK_HISTORICAL_PREVIEW_SAMPLE).map(
      (r) => ({
        contractNumber: r.contractNumber,
        clientName: r.clientName,
        collaboratorName: r.collaboratorName,
        period: r.period,
        amount: r.amount,
        outsideSupplyWindow: r.outsideSupplyWindow,
      }),
    ),
    sampleSkipped: plan.skipped
      .slice(0, BULK_HISTORICAL_SKIPPED_SAMPLE)
      .map((s) => ({
        contractNumber: s.contractNumber,
        collaboratorName: s.collaboratorName,
        period: s.period,
        reason: BULK_SKIP_REASON_LABEL[s.reason],
        detail: s.detail,
      })),
    truncated:
      plan.toApply.length > BULK_HISTORICAL_PREVIEW_SAMPLE ||
      plan.skipped.length > BULK_HISTORICAL_SKIPPED_SAMPLE,
  };
}

function canReadPayout(role: Parameters<typeof hasPermission>[0]): boolean {
  return (
    hasPermission(role, "commissions.edit_gettone") ||
    hasPermission(role, "commissions.view_all")
  );
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function readPeriod(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  return PERIOD_RE.test(value) ? value : currentPeriod();
}

async function readUpload(
  formData: FormData,
): Promise<
  { ok: true; buffer: Buffer; fileName: string } | PayoutActionError
> {
  const fileName =
    String(formData.get("fileName") ?? "").trim() || "rendiconto.xlsx";
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
    return fail("Seleziona un file Excel (.xlsx)");
  }
  return { ok: true, buffer, fileName };
}

function resolveTemplateConfig(
  templateKey: string,
): { config: PayoutTemplateConfig; label: string } | null {
  const builtin = findBuiltinTemplate(templateKey);
  if (!builtin) return null;
  return { config: builtin.config, label: builtin.label };
}

/** Esegue `task` su `items` con concorrenza limitata (Neon HTTP è stateless). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await task(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

type EvaluatedRow = {
  parsed: ParsedPayoutRow;
  status: PayoutPreviewRowStatus;
  matchStatus: "MATCHED" | "AMBIGUOUS" | "UNMATCHED";
  matchScore: number | null;
  matchReason: string | null;
  contractId: string | null;
  contractNumber: string | null;
  crmClientName: string | null;
  supplierName: string | null;
  collaboratorId: string | null;
  collaboratorName: string | null;
  candidateIds: string[];
  skipReason: string | null;
};

/**
 * Esito del matching per una riga, senza toccare il database. La stessa
 * funzione alimenta l'anteprima e la creazione delle righe: anteprima e
 * applicazione non possono divergere.
 */
function evaluateRow(
  parsed: ParsedPayoutRow,
  index: PayoutContractIndex,
  fallbackPeriod: string,
): EvaluatedRow {
  const base: EvaluatedRow = {
    parsed,
    status: "unmatched",
    matchStatus: "UNMATCHED",
    matchScore: null,
    matchReason: null,
    contractId: null,
    contractNumber: null,
    crmClientName: null,
    supplierName: null,
    collaboratorId: null,
    collaboratorName: null,
    candidateIds: [],
    skipReason: null,
  };

  if (parsed.amount == null) {
    return { ...base, status: "no_amount", skipReason: "Importo non leggibile" };
  }

  const withPeriod: ParsedPayoutRow = {
    ...parsed,
    period: parsed.period ?? fallbackPeriod,
  };
  const outcome = matchPayoutRow(withPeriod, index);

  if (outcome.status === "unmatched") return base;

  if (outcome.status === "ambiguous") {
    const first = outcome.candidates[0];
    return {
      ...base,
      status: "ambiguous",
      matchStatus: "AMBIGUOUS",
      matchScore: outcome.score,
      matchReason: outcome.reason,
      candidateIds: outcome.candidates.map((c) => c.id),
      contractNumber: first?.contractNumber ?? null,
      crmClientName: first?.clientName ?? null,
      supplierName: first?.supplierName ?? null,
      collaboratorName: first?.collaboratorName ?? null,
      skipReason:
        outcome.candidates.length > 1
          ? `${outcome.candidates.length} contratti possibili`
          : "Match da confermare",
    };
  }

  return {
    ...base,
    status: "will_apply",
    matchStatus: "MATCHED",
    matchScore: outcome.score,
    matchReason: outcome.reason,
    contractId: outcome.contract.id,
    contractNumber: outcome.contract.contractNumber,
    crmClientName: outcome.contract.clientName,
    supplierName: outcome.contract.supplierName,
    collaboratorId: outcome.contract.collaboratorId,
    collaboratorName: outcome.contract.collaboratorName,
  };
}

function toPreviewRow(row: EvaluatedRow): PayoutPreviewRow {
  return {
    sheetName: row.parsed.sheetName,
    rowIndex: row.parsed.rowIndex,
    podRaw: row.parsed.podRaw,
    clientNameRaw: row.parsed.clientNameRaw,
    amount: row.parsed.amount,
    period: row.parsed.period,
    status: row.status,
    matchReason: row.matchReason
      ? (PAYOUT_MATCH_REASON_LABEL[
          row.matchReason as keyof typeof PAYOUT_MATCH_REASON_LABEL
        ] ?? row.matchReason)
      : undefined,
    matchScore: row.matchScore ?? undefined,
    contractNumber: row.contractNumber ?? undefined,
    crmClientName: row.crmClientName ?? undefined,
    supplierName: row.supplierName ?? undefined,
    collaboratorName: row.collaboratorName ?? undefined,
    candidateCount: row.candidateIds.length || undefined,
    skipReason: row.skipReason ?? undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Elenco dei preset disponibili, per la scelta della mappatura. */
export async function listPayoutTemplatesAction(): Promise<
  | {
      ok: true;
      templates: Array<{ key: string; label: string; hint: string }>;
    }
  | PayoutActionError
> {
  const session = await requireSession();
  if (!canManagePayout(session.role)) {
    return fail("Non hai permesso di importare i rendiconti provvigioni");
  }
  return {
    ok: true,
    templates: listBuiltinTemplates().map((t) => ({
      key: t.key,
      label: t.label,
      hint: t.hint,
    })),
  };
}

/**
 * Anteprima obbligatoria: legge, abbina e conta, senza scrivere nulla.
 * È l'unico punto in cui un errore di mappatura costa zero.
 */
export async function previewPayoutFileAction(
  formData: FormData,
): Promise<PayoutPreviewResult | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di importare i rendiconti provvigioni");
    }

    const upload = await readUpload(formData);
    if (!upload.ok) return upload;

    const templateKey = String(formData.get("templateKey") ?? "").trim();
    const template = resolveTemplateConfig(templateKey);
    if (!template) return fail("Mappatura non riconosciuta");

    const settledPeriod = readPeriod(formData, "settledPeriod");
    const fallbackPeriod = readPeriod(formData, "fallbackPeriod");

    const parsed = await parsePayoutWorkbook(upload.buffer, template.config);
    if (!parsed.ok) {
      return fail(parsed.error, parsed.missingColumns);
    }

    const index = await loadPayoutContractIndex();
    const evaluated = parsed.rows.map((row) =>
      evaluateRow(row, index, fallbackPeriod),
    );

    // Righe già presenti in un batch applicato: lo stesso rendiconto può
    // arrivare corretto e reinviato
    const contractIds = evaluated
      .map((r) => r.contractId)
      .filter((id): id is string => Boolean(id));
    const alreadyApplied = new Set<string>();
    if (contractIds.length > 0) {
      const existing = await prisma.payoutRow.findMany({
        where: {
          contractId: { in: [...new Set(contractIds)] },
          appliedAt: { not: null },
          batch: { run: { period: settledPeriod }, status: { not: "REVERTED" } },
        },
        select: { contractId: true, period: true },
      });
      for (const row of existing) {
        alreadyApplied.add(`${row.contractId}|${row.period ?? ""}`);
      }
    }

    const finalRows = evaluated.map((row) => {
      if (row.status !== "will_apply" || !row.contractId) return row;
      const key = `${row.contractId}|${row.parsed.period ?? fallbackPeriod}`;
      if (alreadyApplied.has(key)) {
        return {
          ...row,
          status: "already_applied" as PayoutPreviewRowStatus,
          skipReason: "Già applicata in questo periodo",
        };
      }
      return row;
    });

    const byCollaborator = new Map<string, { rowCount: number; total: number }>();
    let applicableTotal = 0;
    for (const row of finalRows) {
      if (row.status !== "will_apply") continue;
      applicableTotal += row.parsed.amount ?? 0;
      const name = row.collaboratorName ?? "—";
      const entry = byCollaborator.get(name) ?? { rowCount: 0, total: 0 };
      entry.rowCount += 1;
      entry.total += row.parsed.amount ?? 0;
      byCollaborator.set(name, entry);
    }

    return {
      ok: true,
      fileName: upload.fileName,
      templateKey,
      templateLabel: template.label,
      sheetsRead: parsed.sheetsRead,
      settledPeriod,
      fallbackPeriod,
      rows: finalRows.slice(0, PREVIEW_ROW_LIMIT).map(toPreviewRow),
      truncated: finalRows.length > PREVIEW_ROW_LIMIT,
      summary: {
        total: finalRows.length,
        willApply: finalRows.filter((r) => r.status === "will_apply").length,
        alreadyApplied: finalRows.filter((r) => r.status === "already_applied")
          .length,
        ambiguous: finalRows.filter((r) => r.status === "ambiguous").length,
        unmatched: finalRows.filter((r) => r.status === "unmatched").length,
        noAmount: finalRows.filter((r) => r.status === "no_amount").length,
      },
      computedTotal: round2(parsed.computedTotal),
      declaredTotal:
        parsed.declaredTotal == null ? null : round2(parsed.declaredTotal),
      applicableTotal: round2(applicableTotal),
      byCollaborator: [...byCollaborator.entries()]
        .map(([collaboratorName, v]) => ({
          collaboratorName,
          rowCount: v.rowCount,
          total: round2(v.total),
        }))
        .sort((a, b) => b.total - a.total),
      skippedRows: parsed.skipped.slice(0, 50),
    };
  } catch (e) {
    console.error("[previewPayoutFileAction]", e);
    return fail(errorMessage(e, "Anteprima non riuscita"));
  }
}

async function ensureSource(params: {
  name: string;
  kind: "SUPPLIER_STATEMENT" | "MASTER_STATEMENT" | "MARKETPLACE" | "OTHER";
}): Promise<string> {
  const existing = await prisma.payoutSource.findUnique({
    where: { name: params.name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.payoutSource.create({
    data: { name: params.name, kind: params.kind },
    select: { id: true },
  });
  return created.id;
}

async function ensureTemplate(params: {
  sourceId: string;
  builtinKey: string;
  name: string;
  config: PayoutTemplateConfig;
  userId: string;
}): Promise<string> {
  const existing = await prisma.importTemplate.findFirst({
    where: { sourceId: params.sourceId, builtinKey: params.builtinKey },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.importTemplate.create({
    data: {
      sourceId: params.sourceId,
      name: params.name,
      builtinKey: params.builtinKey,
      headerRow: params.config.headerRow,
      sheetMatchJson: JSON.stringify(params.config.sheetMatch),
      columnMapJson: JSON.stringify(params.config.columnMap),
      numberFormatJson: JSON.stringify(params.config.numberFormat),
      dateFormat: params.config.dateFormat,
      skipRowRulesJson: JSON.stringify(params.config.skipRules),
      createdById: params.userId,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Registra il file nel ciclo di liquidazione: crea il ciclo se serve, il batch
 * e le righe con il loro esito. Non tocca ancora i contratti.
 */
export async function importPayoutFileAction(formData: FormData): Promise<
  | {
      ok: true;
      runId: string;
      batchId: string;
      totalRows: number;
      matchedRows: number;
      ambiguousRows: number;
      unmatchedRows: number;
    }
  | PayoutActionError
> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di importare i rendiconti provvigioni");
    }

    const upload = await readUpload(formData);
    if (!upload.ok) return upload;

    const templateKey = String(formData.get("templateKey") ?? "").trim();
    const builtin = findBuiltinTemplate(templateKey);
    if (!builtin) return fail("Mappatura non riconosciuta");

    const settledPeriod = readPeriod(formData, "settledPeriod");
    const fallbackPeriod = readPeriod(formData, "fallbackPeriod");
    const runId = String(formData.get("runId") ?? "").trim();
    const runLabel =
      String(formData.get("runLabel") ?? "").trim() ||
      `Liquidazione ${periodLabel(settledPeriod)}`;

    // Lo stesso file non entra due volte: prima difesa contro il doppio pagamento
    const sha256 = createHash("sha256").update(upload.buffer).digest("hex");
    const duplicate = await prisma.payoutBatch.findUnique({
      where: { sha256 },
      select: { id: true, runId: true, filename: true },
    });
    if (duplicate) {
      return fail(
        `Questo file è già stato importato (${duplicate.filename}): apri la liquidazione collegata invece di reimportarlo`,
      );
    }

    const parsed = await parsePayoutWorkbook(upload.buffer, builtin.config);
    if (!parsed.ok) return fail(parsed.error, parsed.missingColumns);

    const index = await loadPayoutContractIndex();
    const evaluated = parsed.rows.map((row) =>
      evaluateRow(row, index, fallbackPeriod),
    );

    const run = runId
      ? await prisma.payoutRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true },
        })
      : null;
    if (runId && !run) return fail("Liquidazione non trovata");
    if (run && run.status === "CLOSED") {
      return fail("La liquidazione è chiusa: riaprila prima di aggiungere file");
    }

    const targetRun =
      run ??
      (await prisma.payoutRun.upsert({
        where: { period_label: { period: settledPeriod, label: runLabel } },
        update: {},
        create: {
          period: settledPeriod,
          label: runLabel,
          createdById: session.id,
          markMode: "INCASSATO",
        },
        select: { id: true, status: true },
      }));

    const sourceId = await ensureSource({
      name: builtin.label,
      kind: builtin.sourceKind,
    });
    const templateId = await ensureTemplate({
      sourceId,
      builtinKey: builtin.key,
      name: builtin.label,
      config: builtin.config,
      userId: session.id,
    });

    const batch = await prisma.payoutBatch.create({
      data: {
        runId: targetRun.id,
        sourceId,
        templateId,
        filename: upload.fileName.slice(0, 200),
        sha256,
        fileSize: upload.buffer.length,
        status: "PARSED",
        totalRows: evaluated.length,
        matchedRows: evaluated.filter((r) => r.matchStatus === "MATCHED").length,
        ambiguousRows: evaluated.filter((r) => r.matchStatus === "AMBIGUOUS")
          .length,
        unmatchedRows: evaluated.filter((r) => r.matchStatus === "UNMATCHED")
          .length,
        computedTotal: round2(parsed.computedTotal),
        declaredTotal:
          parsed.declaredTotal == null ? null : round2(parsed.declaredTotal),
        uploadedById: session.id,
      },
      select: { id: true },
    });

    await mapWithConcurrency(evaluated, INSERT_CONCURRENCY, async (row) => {
      await prisma.payoutRow.create({
        data: {
          batchId: batch.id,
          sheetName: row.parsed.sheetName,
          rowIndex: row.parsed.rowIndex,
          rawJson: JSON.stringify(row.parsed.raw),
          podRaw: row.parsed.podRaw || null,
          podKey: row.parsed.podKeys[0] ?? null,
          clientNameRaw: row.parsed.clientNameRaw || null,
          fiscalCodeRaw: row.parsed.fiscalKey || null,
          supplierHint: row.parsed.supplierHint || null,
          collaboratorHint: row.parsed.collaboratorHint || null,
          amount: row.parsed.amount,
          period: row.parsed.period ?? fallbackPeriod,
          matchStatus: row.matchStatus,
          matchScore: row.matchScore,
          matchReason: row.matchReason,
          contractId: row.contractId,
          collaboratorId: row.collaboratorId,
          candidateIdsJson:
            row.candidateIds.length > 0
              ? JSON.stringify(row.candidateIds)
              : null,
          note: row.skipReason,
        },
      });
    });

    await writeAuditLog({
      userId: session.id,
      action: "IMPORT",
      entity: "PayoutBatch",
      entityId: batch.id,
      details: {
        template: builtin.key,
        settledPeriod,
        totalRows: evaluated.length,
        sheets: parsed.sheetsRead,
      },
    });

    revalidatePath("/provvigioni/liquidazioni");
    return {
      ok: true,
      runId: targetRun.id,
      batchId: batch.id,
      totalRows: evaluated.length,
      matchedRows: evaluated.filter((r) => r.matchStatus === "MATCHED").length,
      ambiguousRows: evaluated.filter((r) => r.matchStatus === "AMBIGUOUS")
        .length,
      unmatchedRows: evaluated.filter((r) => r.matchStatus === "UNMATCHED")
        .length,
    };
  } catch (e) {
    console.error("[importPayoutFileAction]", e);
    return fail(errorMessage(e, "Import non riuscito"));
  }
}

/**
 * Applica un lotto di righe ai contratti. Idempotente: una riga già applicata
 * viene saltata, non riscritta. Va richiamata finché `remaining` non è 0.
 */
export async function applyPayoutBatchAction(
  formData: FormData,
): Promise<PayoutBatchProgress | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di applicare una liquidazione");
    }

    const batchId = String(formData.get("batchId") ?? "").trim();
    if (!batchId) return fail("Batch non indicato");

    const batch = await prisma.payoutBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        runId: true,
        run: { select: { period: true, markMode: true, status: true } },
      },
    });
    if (!batch) return fail("Batch non trovato");
    if (batch.run.status === "CLOSED") {
      return fail("La liquidazione è chiusa");
    }

    const pending = await prisma.payoutRow.findMany({
      where: { batchId, matchStatus: "MATCHED", appliedAt: null },
      select: { id: true, contractId: true, period: true, amount: true },
      take: APPLY_BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    let applied = 0;
    let skipped = 0;
    let errors = 0;

    // Sequenziale: più righe possono riferirsi allo stesso contratto
    for (const row of pending) {
      if (!row.contractId) {
        skipped++;
        continue;
      }
      try {
        const outcome = await applyPayoutRowMark({
          contractId: row.contractId,
          period: row.period ?? batch.run.period,
          settledPeriod: batch.run.period,
          amount: row.amount == null ? null : decimalToNumber(row.amount),
          markMode: batch.run.markMode,
          note: `Import rendiconto · liquidazione ${batch.run.period}`,
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
        console.error("[applyPayoutBatchAction] riga", row.id, e);
        await prisma.payoutRow
          .update({
            where: { id: row.id },
            data: {
              matchStatus: "ERROR",
              note: errorMessage(e, "Errore in applicazione").slice(0, 200),
            },
          })
          .catch(() => undefined);
        errors++;
      }
    }

    const remaining = await prisma.payoutRow.count({
      where: { batchId, matchStatus: "MATCHED", appliedAt: null },
    });

    const [ambiguousLeft, appliedTotal] = await Promise.all([
      prisma.payoutRow.count({ where: { batchId, matchStatus: "AMBIGUOUS" } }),
      prisma.payoutRow.count({ where: { batchId, matchStatus: "APPLIED" } }),
    ]);

    if (remaining === 0) {
      await prisma.payoutBatch.update({
        where: { id: batchId },
        data: {
          status: ambiguousLeft > 0 ? "PARTIALLY_APPLIED" : "APPLIED",
          appliedRows: appliedTotal,
          appliedAt: new Date(),
        },
      });
      await prisma.payoutRun.update({
        where: { id: batch.runId },
        data: {
          status: "APPLIED",
          appliedById: session.id,
          appliedAt: new Date(),
        },
      });
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "PayoutBatch",
        entityId: batchId,
        details: { source: "apply_payout_batch", appliedRows: appliedTotal },
      });
    }

    revalidatePath("/provvigioni/liquidazioni");
    revalidatePath(`/provvigioni/liquidazioni/${batch.runId}`);
    revalidatePath("/provvigioni");
    revalidatePath("/contratti");

    return {
      ok: true,
      processed: pending.length,
      remaining,
      applied,
      skipped,
      errors,
    };
  } catch (e) {
    console.error("[applyPayoutBatchAction]", e);
    return fail(errorMessage(e, "Applicazione non riuscita"));
  }
}

/** Annulla l'applicazione di un batch, riportando i contratti allo stato precedente. */
export async function revertPayoutBatchAction(
  formData: FormData,
): Promise<PayoutBatchProgress | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di annullare una liquidazione");
    }

    const batchId = String(formData.get("batchId") ?? "").trim();
    if (!batchId) return fail("Batch non indicato");

    const batch = await prisma.payoutBatch.findUnique({
      where: { id: batchId },
      select: { id: true, runId: true },
    });
    if (!batch) return fail("Batch non trovato");

    const applied = await prisma.payoutRow.findMany({
      where: { batchId, appliedAt: { not: null }, matchStatus: "APPLIED" },
      select: {
        id: true,
        contractId: true,
        recurringMonthId: true,
        previousStateJson: true,
      },
      take: APPLY_BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    let reverted = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of applied) {
      const previous = parsePreviousState(row.previousStateJson);
      if (!row.contractId || !previous) {
        await prisma.payoutRow.update({
          where: { id: row.id },
          data: { matchStatus: "MATCHED", appliedAt: null },
        });
        skipped++;
        continue;
      }
      try {
        await revertPayoutRowMark({
          contractId: row.contractId,
          recurringMonthId: row.recurringMonthId,
          previousState: previous,
        });
        await prisma.payoutRow.update({
          where: { id: row.id },
          data: {
            matchStatus: "MATCHED",
            appliedAt: null,
            recurringMonthId: null,
            previousStateJson: null,
          },
        });
        reverted++;
      } catch (e) {
        console.error("[revertPayoutBatchAction] riga", row.id, e);
        errors++;
      }
    }

    const remaining = await prisma.payoutRow.count({
      where: { batchId, appliedAt: { not: null }, matchStatus: "APPLIED" },
    });

    if (remaining === 0) {
      await prisma.payoutBatch.update({
        where: { id: batchId },
        data: { status: "REVERTED", appliedRows: 0, appliedAt: null },
      });
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "PayoutBatch",
        entityId: batchId,
        details: { source: "revert_payout_batch" },
      });
    }

    revalidatePath(`/provvigioni/liquidazioni/${batch.runId}`);
    revalidatePath("/provvigioni");
    revalidatePath("/contratti");

    return {
      ok: true,
      processed: applied.length,
      remaining,
      applied: reverted,
      skipped,
      errors,
    };
  } catch (e) {
    console.error("[revertPayoutBatchAction]", e);
    return fail(errorMessage(e, "Annullamento non riuscito"));
  }
}

/** Risolve a mano una riga ambigua scegliendo il contratto. */
export async function resolvePayoutRowAction(
  formData: FormData,
): Promise<{ ok: true } | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di modificare una liquidazione");
    }

    const rowId = String(formData.get("rowId") ?? "").trim();
    const contractId = String(formData.get("contractId") ?? "").trim();
    const ignore = String(formData.get("ignore") ?? "") === "1";
    if (!rowId) return fail("Riga non indicata");

    const row = await prisma.payoutRow.findUnique({
      where: { id: rowId },
      select: { id: true, appliedAt: true, batch: { select: { runId: true } } },
    });
    if (!row) return fail("Riga non trovata");
    if (row.appliedAt) return fail("Riga già applicata: annulla prima il batch");

    if (ignore) {
      await prisma.payoutRow.update({
        where: { id: rowId },
        data: {
          matchStatus: "IGNORED",
          resolvedById: session.id,
          resolvedAt: new Date(),
          note: "Esclusa manualmente",
        },
      });
    } else {
      if (!contractId) return fail("Contratto non indicato");
      const contract = await prisma.contract.findUnique({
        where: { id: contractId },
        select: { id: true, collaboratorId: true, deletedAt: true },
      });
      if (!contract || contract.deletedAt) {
        return fail("Contratto non valido");
      }
      await prisma.payoutRow.update({
        where: { id: rowId },
        data: {
          matchStatus: "MATCHED",
          contractId: contract.id,
          collaboratorId: contract.collaboratorId,
          matchReason: "manuale",
          matchScore: 100,
          resolvedById: session.id,
          resolvedAt: new Date(),
          note: "Risolta manualmente",
        },
      });
    }

    revalidatePath(`/provvigioni/liquidazioni/${row.batch.runId}`);
    return { ok: true };
  } catch (e) {
    console.error("[resolvePayoutRowAction]", e);
    return fail(errorMessage(e, "Risoluzione non riuscita"));
  }
}

/**
 * Aggiunge una rettifica manuale. La nota è obbligatoria: una rettifica senza
 * motivo è ciò che oggi produce gli script correttivi.
 */
export async function addPayoutAdjustmentAction(
  formData: FormData,
): Promise<{ ok: true; adjustmentId: string } | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di aggiungere rettifiche");
    }

    const runId = String(formData.get("runId") ?? "").trim();
    const collaboratorId = String(formData.get("collaboratorId") ?? "").trim();
    const kindRaw = String(formData.get("kind") ?? "").trim().toUpperCase();
    const note = String(formData.get("note") ?? "").trim();
    const amountRaw = String(formData.get("amount") ?? "")
      .trim()
      .replace(/\./g, "")
      .replace(",", ".");

    if (!runId || !collaboratorId) return fail("Liquidazione o collaboratore non indicati");
    if (!note) return fail("La nota è obbligatoria: indica il motivo della rettifica");
    if (note.length > 500) return fail("La nota supera i 500 caratteri");

    const kinds = ["EXTRA", "STORNO", "ACCONTO", "RETTIFICA"] as const;
    const kind = kinds.find((k) => k === kindRaw);
    if (!kind) return fail("Tipo di rettifica non valido");

    const parsedAmount = Number(amountRaw);
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      return fail("Importo non valido");
    }
    // Storni e acconti sottraggono sempre: il segno non è a discrezione
    const amount =
      kind === "STORNO" || kind === "ACCONTO"
        ? -Math.abs(parsedAmount)
        : parsedAmount;

    const run = await prisma.payoutRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true },
    });
    if (!run) return fail("Liquidazione non trovata");
    if (run.status === "CLOSED") {
      return fail("La liquidazione è chiusa: riaprila per aggiungere rettifiche");
    }

    const collaborator = await prisma.user.findUnique({
      where: { id: collaboratorId },
      select: { id: true },
    });
    if (!collaborator) return fail("Collaboratore non trovato");

    const contractId = String(formData.get("contractId") ?? "").trim();
    const created = await prisma.payoutAdjustment.create({
      data: {
        runId,
        collaboratorId,
        kind,
        amount,
        note,
        contractId: contractId || null,
        createdById: session.id,
      },
      select: { id: true },
    });

    await writeAuditLog({
      userId: session.id,
      action: "CREATE",
      entity: "PayoutAdjustment",
      entityId: created.id,
      details: { runId, kind, amount },
    });

    revalidatePath(`/provvigioni/liquidazioni/${runId}`);
    return { ok: true, adjustmentId: created.id };
  } catch (e) {
    console.error("[addPayoutAdjustmentAction]", e);
    return fail(errorMessage(e, "Rettifica non salvata"));
  }
}

/** Annulla una rettifica senza cancellarla: resta visibile con il motivo. */
export async function voidPayoutAdjustmentAction(
  formData: FormData,
): Promise<{ ok: true } | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di annullare rettifiche");
    }

    const adjustmentId = String(formData.get("adjustmentId") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    if (!adjustmentId) return fail("Rettifica non indicata");
    if (!reason) return fail("Indica il motivo dell'annullamento");

    const adjustment = await prisma.payoutAdjustment.findUnique({
      where: { id: adjustmentId },
      select: { id: true, runId: true, voidedAt: true },
    });
    if (!adjustment) return fail("Rettifica non trovata");
    if (adjustment.voidedAt) return fail("Rettifica già annullata");

    await prisma.payoutAdjustment.update({
      where: { id: adjustmentId },
      data: {
        voidedAt: new Date(),
        voidedById: session.id,
        voidReason: reason.slice(0, 500),
        updatedById: session.id,
      },
    });

    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "PayoutAdjustment",
      entityId: adjustmentId,
      details: { source: "void_payout_adjustment" },
    });

    revalidatePath(`/provvigioni/liquidazioni/${adjustment.runId}`);
    return { ok: true };
  } catch (e) {
    console.error("[voidPayoutAdjustmentAction]", e);
    return fail(errorMessage(e, "Annullamento non riuscito"));
  }
}

/**
 * Apre una nuova versione di report per il ciclo. Le voci nascono vuote e
 * vengono riempite a lotti: la generazione di N documenti non sta in una
 * singola richiesta.
 */
export async function startPayoutReportRunAction(formData: FormData): Promise<
  | { ok: true; reportRunId: string; version: number; itemCount: number }
  | PayoutActionError
> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di generare i report di liquidazione");
    }

    const runId = String(formData.get("runId") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim();
    if (!runId) return fail("Liquidazione non indicata");

    const run = await prisma.payoutRun.findUnique({
      where: { id: runId },
      select: { id: true },
    });
    if (!run) return fail("Liquidazione non trovata");

    const totals = await loadPayoutRunTotals(runId);
    if (totals.length === 0) {
      return fail(
        "Nessun collaboratore con righe attribuite: applica prima il file o risolvi le righe da confermare",
      );
    }

    const last = await prisma.payoutReportRun.findFirst({
      where: { runId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const reportRun = await prisma.payoutReportRun.create({
      data: {
        runId,
        version,
        status: "GENERATING",
        reason: reason ? reason.slice(0, 300) : null,
        createdById: session.id,
      },
      select: { id: true },
    });

    await mapWithConcurrency(totals, INSERT_CONCURRENCY, async (total) => {
      await prisma.payoutReportItem.create({
        data: {
          reportRunId: reportRun.id,
          collaboratorId: total.collaboratorId,
          snapshotJson: "",
          toEmail: null,
        },
      });
    });

    await writeAuditLog({
      userId: session.id,
      action: "CREATE",
      entity: "PayoutReportRun",
      entityId: reportRun.id,
      details: { runId, version, itemCount: totals.length },
    });

    revalidatePath(`/provvigioni/liquidazioni/${runId}`);
    return {
      ok: true,
      reportRunId: reportRun.id,
      version,
      itemCount: totals.length,
    };
  } catch (e) {
    console.error("[startPayoutReportRunAction]", e);
    return fail(errorMessage(e, "Generazione non avviata"));
  }
}

/** Riempie lo snapshot di un lotto di report. Da richiamare finché `remaining` non è 0. */
export async function generatePayoutReportBatchAction(
  formData: FormData,
): Promise<PayoutBatchProgress | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di generare i report di liquidazione");
    }

    const reportRunId = String(formData.get("reportRunId") ?? "").trim();
    if (!reportRunId) return fail("Generazione non indicata");

    const reportRun = await prisma.payoutReportRun.findUnique({
      where: { id: reportRunId },
      select: { id: true, runId: true, version: true },
    });
    if (!reportRun) return fail("Generazione non trovata");

    const pending = await prisma.payoutReportItem.findMany({
      where: { reportRunId, snapshotJson: "" },
      select: { id: true, collaboratorId: true },
      take: REPORT_BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    let generated = 0;
    let errors = 0;

    for (const item of pending) {
      try {
        const snapshot = await buildPayoutSnapshot({
          runId: reportRun.runId,
          collaboratorId: item.collaboratorId,
          version: reportRun.version,
        });
        const collaborator = await prisma.user.findUnique({
          where: { id: item.collaboratorId },
          select: { email: true },
        });
        await prisma.payoutReportItem.update({
          where: { id: item.id },
          data: {
            snapshotJson: JSON.stringify(snapshot),
            importedTotal: snapshot.importedTotal,
            adjustmentsTotal: snapshot.adjustmentsTotal,
            netTotal: snapshot.netTotal,
            rowCount: snapshot.rows.length,
            toEmail: collaborator?.email ?? null,
          },
        });
        generated++;
      } catch (e) {
        console.error("[generatePayoutReportBatchAction] voce", item.id, e);
        await prisma.payoutReportItem
          .update({
            where: { id: item.id },
            data: {
              snapshotJson: "{}",
              lastError: errorMessage(e, "Generazione non riuscita").slice(0, 200),
            },
          })
          .catch(() => undefined);
        errors++;
      }
    }

    const remaining = await prisma.payoutReportItem.count({
      where: { reportRunId, snapshotJson: "" },
    });

    if (remaining === 0) {
      const failed = await prisma.payoutReportItem.count({
        where: { reportRunId, lastError: { not: null } },
      });
      await prisma.payoutReportRun.update({
        where: { id: reportRunId },
        data: { status: failed > 0 ? "PARTIAL" : "READY" },
      });
    }

    revalidatePath(`/provvigioni/liquidazioni/${reportRun.runId}`);
    return {
      ok: true,
      processed: pending.length,
      remaining,
      applied: generated,
      skipped: 0,
      errors,
    };
  } catch (e) {
    console.error("[generatePayoutReportBatchAction]", e);
    return fail(errorMessage(e, "Generazione non riuscita"));
  }
}

function reportRecipient(): string {
  return process.env.PAYOUT_REPORT_TO?.trim() || getMasterEmail();
}

/**
 * Invia un lotto di report. I report vanno all'utente, non ai collaboratori:
 * una email per collaboratore, così può inoltrarla senza rielaborarla.
 *
 * Lo stato passa a SENDING prima della chiamata SMTP: se l'esecuzione si
 * interrompe, la voce resta segnalata come da verificare invece di essere
 * reinviata alla cieca.
 */
export async function sendPayoutReportBatchAction(
  formData: FormData,
): Promise<PayoutBatchProgress | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di inviare i report di liquidazione");
    }
    if (!hasPermission(session.role, "reports.email")) {
      return fail("Non hai permesso di inviare email di report");
    }

    const reportRunId = String(formData.get("reportRunId") ?? "").trim();
    if (!reportRunId) return fail("Generazione non indicata");

    const reportRun = await prisma.payoutReportRun.findUnique({
      where: { id: reportRunId },
      select: {
        id: true,
        runId: true,
        version: true,
        run: { select: { label: true, period: true } },
      },
    });
    if (!reportRun) return fail("Generazione non trovata");

    const recipient = reportRecipient();
    if (!recipient.includes("@")) {
      return fail(
        "Destinatario dei report non configurato: imposta PAYOUT_REPORT_TO o MASTER_EMAIL",
      );
    }

    const pending = await prisma.payoutReportItem.findMany({
      where: {
        reportRunId,
        delivery: { in: ["PENDING", "ERROR"] },
        snapshotJson: { notIn: ["", "{}"] },
      },
      select: {
        id: true,
        attempts: true,
        snapshotJson: true,
        collaborator: { select: { name: true } },
      },
      take: EMAIL_BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    let sent = 0;
    let errors = 0;

    for (const item of pending) {
      const snapshot = parsePayoutSnapshot(item.snapshotJson);
      if (!snapshot) {
        await prisma.payoutReportItem.update({
          where: { id: item.id },
          data: { delivery: "ERROR", lastError: "Snapshot non valido" },
        });
        errors++;
        continue;
      }

      await prisma.payoutReportItem.update({
        where: { id: item.id },
        data: {
          delivery: "SENDING",
          attempts: item.attempts + 1,
          toEmail: recipient,
        },
      });

      try {
        const [xlsx, pdf] = [
          await buildPayoutReportXlsx(snapshot),
          buildPayoutReportPdf(snapshot),
        ];
        const base = payoutReportFileBase(snapshot);
        const lines = [
          `Liquidazione: ${snapshot.runLabel}`,
          `Collaboratore: ${snapshot.collaboratorName}`,
          `Periodo: ${periodLabel(snapshot.period)}`,
          `Versione report: ${snapshot.version}`,
          "",
          `Totale da rendiconti: ${formatCurrency(snapshot.importedTotal)} (${snapshot.rows.length} righe)`,
          `Rettifiche: ${formatCurrency(snapshot.adjustmentsTotal)} (${snapshot.adjustments.length} voci)`,
          `Netto da liquidare: ${formatCurrency(snapshot.netTotal)}`,
        ];

        const result = await sendMail({
          to: recipient,
          subject: `Liquidazione ${periodLabel(snapshot.period)} — ${snapshot.collaboratorName} (v${snapshot.version})`,
          text: lines.join("\n"),
          attachments: [
            {
              filename: `${base}.xlsx`,
              content: xlsx,
              contentType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
            {
              filename: `${base}.pdf`,
              content: pdf,
              contentType: "application/pdf",
            },
          ],
        });

        if (result.ok) {
          await prisma.payoutReportItem.update({
            where: { id: item.id },
            data: { delivery: "SENT", sentAt: new Date(), lastError: null },
          });
          sent++;
        } else {
          await prisma.payoutReportItem.update({
            where: { id: item.id },
            data: {
              delivery: "ERROR",
              lastError: (result.error ?? "Invio non riuscito").slice(0, 200),
            },
          });
          errors++;
        }
      } catch (e) {
        console.error("[sendPayoutReportBatchAction] voce", item.id, e);
        await prisma.payoutReportItem
          .update({
            where: { id: item.id },
            data: {
              delivery: "ERROR",
              lastError: errorMessage(e, "Invio non riuscito").slice(0, 200),
            },
          })
          .catch(() => undefined);
        errors++;
      }
    }

    const remaining = await prisma.payoutReportItem.count({
      where: {
        reportRunId,
        delivery: { in: ["PENDING", "ERROR"] },
        snapshotJson: { notIn: ["", "{}"] },
      },
    });

    if (sent > 0) {
      await writeAuditLog({
        userId: session.id,
        action: "EMAIL",
        entity: "PayoutReportRun",
        entityId: reportRunId,
        details: { sent, version: reportRun.version },
      });
    }

    revalidatePath(`/provvigioni/liquidazioni/${reportRun.runId}`);
    return {
      ok: true,
      processed: pending.length,
      remaining: errors > 0 && remaining === pending.length ? 0 : remaining,
      applied: sent,
      skipped: 0,
      errors,
    };
  } catch (e) {
    console.error("[sendPayoutReportBatchAction]", e);
    return fail(errorMessage(e, "Invio non riuscito"));
  }
}

/**
 * Marca la liquidazione al collaboratore: passo distinto e successivo
 * all'incasso dal fornitore. Da richiamare finché `remaining` non è 0.
 */
export async function markPayoutRunLiquidatedAction(
  formData: FormData,
): Promise<PayoutBatchProgress | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di liquidare le provvigioni");
    }

    const runId = String(formData.get("runId") ?? "").trim();
    if (!runId) return fail("Liquidazione non indicata");

    const run = await prisma.payoutRun.findUnique({
      where: { id: runId },
      select: { id: true, period: true, status: true },
    });
    if (!run) return fail("Liquidazione non trovata");
    if (run.status === "CLOSED") return fail("La liquidazione è chiusa");

    const rows = await prisma.payoutRow.findMany({
      where: {
        batch: { runId, status: { not: "REVERTED" } },
        matchStatus: "APPLIED",
        contractId: { not: null },
        contract: { status: { not: "PROVVIGIONE_LIQUIDATA" } },
      },
      select: { id: true, contractId: true, period: true, amount: true },
      take: APPLY_BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    let liquidated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      if (!row.contractId) {
        skipped++;
        continue;
      }
      try {
        const outcome = await applyPayoutRowMark({
          contractId: row.contractId,
          period: row.period ?? run.period,
          settledPeriod: run.period,
          amount: row.amount == null ? null : decimalToNumber(row.amount),
          markMode: "LIQUIDATO",
          note: `Liquidazione collaboratore · ${run.period}`,
        });
        if (outcome.ok) liquidated++;
        else skipped++;
      } catch (e) {
        console.error("[markPayoutRunLiquidatedAction] riga", row.id, e);
        errors++;
      }
    }

    const remaining = await prisma.payoutRow.count({
      where: {
        batch: { runId, status: { not: "REVERTED" } },
        matchStatus: "APPLIED",
        contractId: { not: null },
        contract: { status: { not: "PROVVIGIONE_LIQUIDATA" } },
      },
    });

    if (remaining === 0) {
      await prisma.payoutRun.update({
        where: { id: runId },
        data: { liquidatedAt: new Date() },
      });
      await writeAuditLog({
        userId: session.id,
        action: "UPDATE",
        entity: "PayoutRun",
        entityId: runId,
        details: { source: "mark_payout_run_liquidated" },
      });
    }

    revalidatePath(`/provvigioni/liquidazioni/${runId}`);
    revalidatePath("/provvigioni");
    revalidatePath("/contratti");

    return {
      ok: true,
      processed: rows.length,
      remaining,
      applied: liquidated,
      skipped,
      errors,
    };
  } catch (e) {
    console.error("[markPayoutRunLiquidatedAction]", e);
    return fail(errorMessage(e, "Liquidazione non riuscita"));
  }
}

/** Chiude o riapre il ciclo: una liquidazione chiusa non accetta modifiche. */
export async function setPayoutRunClosedAction(
  formData: FormData,
): Promise<{ ok: true; status: string } | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di chiudere una liquidazione");
    }

    const runId = String(formData.get("runId") ?? "").trim();
    const close = String(formData.get("close") ?? "") === "1";
    if (!runId) return fail("Liquidazione non indicata");

    const run = await prisma.payoutRun.findUnique({
      where: { id: runId },
      select: { id: true, appliedAt: true },
    });
    if (!run) return fail("Liquidazione non trovata");

    const status = close ? "CLOSED" : run.appliedAt ? "APPLIED" : "DRAFT";
    await prisma.payoutRun.update({
      where: { id: runId },
      data: { status, closedAt: close ? new Date() : null },
    });

    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "PayoutRun",
      entityId: runId,
      details: { source: "set_payout_run_closed", status },
    });

    revalidatePath("/provvigioni/liquidazioni");
    revalidatePath(`/provvigioni/liquidazioni/${runId}`);
    return { ok: true, status };
  } catch (e) {
    console.error("[setPayoutRunClosedAction]", e);
    return fail(errorMessage(e, "Operazione non riuscita"));
  }
}

/** Totali per collaboratore, filtrati secondo la visibilità del richiedente. */
export async function loadPayoutRunTotalsAction(
  formData: FormData,
): Promise<
  { ok: true; totals: PayoutCollaboratorTotal[] } | PayoutActionError
> {
  try {
    const session = await requireSession();
    if (!canReadPayout(session.role)) {
      return fail("Non hai accesso alle liquidazioni");
    }
    const runId = String(formData.get("runId") ?? "").trim();
    if (!runId) return fail("Liquidazione non indicata");

    const visibility = await contractVisibilityWhere(session);
    const totals = await loadPayoutRunTotals(runId, visibility);
    return { ok: true, totals };
  } catch (e) {
    console.error("[loadPayoutRunTotalsAction]", e);
    return fail(errorMessage(e, "Lettura dei totali non riuscita"));
  }
}

/** Candidati per la risoluzione manuale di una riga ambigua. */
export async function loadPayoutRowCandidatesAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      candidates: Array<{
        id: string;
        contractNumber: string;
        clientName: string;
        supplierName: string;
        collaboratorName: string;
        podPdr: string;
      }>;
    }
  | PayoutActionError
> {
  try {
    const session = await requireSession();
    if (!canManagePayout(session.role)) {
      return fail("Non hai permesso di modificare una liquidazione");
    }
    const rowId = String(formData.get("rowId") ?? "").trim();
    if (!rowId) return fail("Riga non indicata");

    const row = await prisma.payoutRow.findUnique({
      where: { id: rowId },
      select: { candidateIdsJson: true },
    });
    if (!row) return fail("Riga non trovata");

    let ids: string[] = [];
    if (row.candidateIdsJson) {
      try {
        const parsed: unknown = JSON.parse(row.candidateIdsJson);
        if (Array.isArray(parsed)) {
          ids = parsed.filter((v): v is string => typeof v === "string");
        }
      } catch {
        ids = [];
      }
    }
    if (ids.length === 0) return { ok: true, candidates: [] };

    const contracts = await prisma.contract.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        podPdr: true,
        pod: true,
        pdr: true,
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
        client: {
          select: {
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    });

    return {
      ok: true,
      candidates: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        clientName: clientDisplayName(c.client),
        supplierName: c.supplier.name,
        collaboratorName: c.collaborator.name,
        podPdr: c.podPdr || c.pod || c.pdr || "",
      })),
    };
  } catch (e) {
    console.error("[loadPayoutRowCandidatesAction]", e);
    return fail(errorMessage(e, "Lettura dei candidati non riuscita"));
  }
}

/**
 * Anteprima della marcatura massiva Helios: nessuna scrittura.
 * Parametri: periodLimit, markMode (INCASSATO|LIQUIDATO), exclusionMode (TOTAL|ACTIVE_ONLY).
 */
export async function previewBulkHistoricalHeliosAction(
  formData: FormData,
): Promise<BulkHistoricalPreviewResult | PayoutActionError> {
  try {
    const session = await requireSession();
    if (!canBulkHistorical(session.role)) {
      return fail("Solo l'amministratore può eseguire la marcatura massiva");
    }

    const params = readBulkHistoricalParams(formData);
    if ("ok" in params) return params;

    const built = await buildBulkHistoricalPlan({
      periodLimit: params.periodLimit,
      markMode: params.markMode,
      exclusionMode: params.exclusionMode,
    });
    if (!built.ok) return fail(built.error);

    return planToPreview(built.plan);
  } catch (e) {
    console.error("[previewBulkHistoricalHeliosAction]", e);
    return fail(errorMessage(e, "Anteprima non riuscita"));
  }
}

/**
 * Crea il batch tracciato (PayoutRun + PayoutBatch + PayoutRow) dalla marcatura
 * massiva. Idempotente sulla firma dei parametri: un secondo invio riprende il
 * batch esistente. L'applicazione effettiva avviene con applyPayoutBatchAction.
 */
export async function createBulkHistoricalHeliosBatchAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      runId: string;
      batchId: string;
      totalRows: number;
      matchedRows: number;
      existing: boolean;
    }
  | PayoutActionError
> {
  try {
    const session = await requireSession();
    if (!canBulkHistorical(session.role)) {
      return fail("Solo l'amministratore può eseguire la marcatura massiva");
    }

    const params = readBulkHistoricalParams(formData);
    if ("ok" in params) return params;

    const built = await buildBulkHistoricalPlan({
      periodLimit: params.periodLimit,
      markMode: params.markMode,
      exclusionMode: params.exclusionMode,
    });
    if (!built.ok) return fail(built.error);

    const plan = built.plan;
    if (plan.toApply.length === 0) {
      return fail("Nessuna rata da applicare con i parametri scelti");
    }

    const existingBatch = await prisma.payoutBatch.findUnique({
      where: { sha256: plan.signature },
      select: { id: true, runId: true, totalRows: true, matchedRows: true },
    });
    if (existingBatch) {
      return {
        ok: true,
        runId: existingBatch.runId,
        batchId: existingBatch.id,
        totalRows: existingBatch.totalRows,
        matchedRows: existingBatch.matchedRows,
        existing: true,
      };
    }

    const supplier = await prisma.supplier.findFirst({
      where: {
        name: { equals: plan.supplierName, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!supplier) return fail("Fornitore non trovato");

    const sourceId = await ensureSource({
      name: `${plan.supplierName} — marcatura massiva`,
      kind: "SUPPLIER_STATEMENT",
    });

    const run = await prisma.payoutRun.upsert({
      where: {
        period_label: { period: plan.periodLimit, label: plan.runLabel },
      },
      update: { markMode: plan.markMode },
      create: {
        period: plan.periodLimit,
        label: plan.runLabel,
        markMode: plan.markMode,
        createdById: session.id,
        notes: `Marcatura massiva · esclusione ${plan.exclusionMode} · ${plan.excludedCollaboratorPatterns.join(", ")}`,
      },
      select: { id: true, status: true },
    });
    if (run.status === "CLOSED") {
      return fail("La liquidazione collegata è chiusa: riaprila prima di procedere");
    }

    const computedTotal = round2(
      plan.toApply.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    );

    const batch = await prisma.payoutBatch.create({
      data: {
        runId: run.id,
        sourceId,
        filename: `${plan.runLabel}.bulk`,
        sha256: plan.signature,
        fileSize: 0,
        status: "PARSED",
        totalRows: plan.toApply.length,
        matchedRows: plan.toApply.length,
        ambiguousRows: 0,
        unmatchedRows: 0,
        computedTotal,
        uploadedById: session.id,
      },
      select: { id: true },
    });

    await mapWithConcurrency(plan.toApply, INSERT_CONCURRENCY, async (row, idx) => {
      await prisma.payoutRow.create({
        data: {
          batchId: batch.id,
          sheetName: "bulk",
          rowIndex: idx,
          rawJson: JSON.stringify({
            kind: "bulk-historical",
            contractId: row.contractId,
            period: row.period,
            amount: row.amount,
            outsideSupplyWindow: row.outsideSupplyWindow,
          }),
          podRaw: null,
          clientNameRaw: row.clientName,
          amount: row.amount,
          period: row.period,
          matchStatus: "MATCHED",
          matchScore: 100,
          matchReason: "bulk_historical",
          contractId: row.contractId,
          collaboratorId: row.collaboratorId,
          note: row.outsideSupplyWindow
            ? "Fuori finestra fornitura — verificare bonifica mesi"
            : null,
        },
      });
    });

    await writeAuditLog({
      userId: session.id,
      action: "CREATE",
      entity: "PayoutBatch",
      entityId: batch.id,
      details: {
        source: "bulk_historical_helios",
        periodLimit: plan.periodLimit,
        markMode: plan.markMode,
        exclusionMode: plan.exclusionMode,
        rateCount: plan.toApply.length,
        contractCount: plan.summary.contractCount,
        totalAmount: computedTotal,
        outsideWindowCount: plan.summary.outsideWindowCount,
      },
    });

    revalidatePath("/provvigioni/liquidazioni");
    return {
      ok: true,
      runId: run.id,
      batchId: batch.id,
      totalRows: plan.toApply.length,
      matchedRows: plan.toApply.length,
      existing: false,
    };
  } catch (e) {
    console.error("[createBulkHistoricalHeliosBatchAction]", e);
    return fail(errorMessage(e, "Creazione batch non riuscita"));
  }
}
