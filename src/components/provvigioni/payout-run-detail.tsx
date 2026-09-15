"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addPayoutAdjustmentAction,
  applyPayoutBatchAction,
  generatePayoutReportBatchAction,
  loadPayoutRowCandidatesAction,
  markPayoutRunLiquidatedAction,
  resolvePayoutRowAction,
  revertPayoutBatchAction,
  sendPayoutReportBatchAction,
  setPayoutRunClosedAction,
  startPayoutReportRunAction,
  voidPayoutAdjustmentAction,
} from "@/lib/payout-actions";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import { PAYOUT_ADJUSTMENT_LABEL } from "@/lib/payout/adjustment-labels";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

type RunInfo = {
  id: string;
  period: string;
  label: string;
  status: string;
  markMode: string;
  appliedAt: string | null;
  liquidatedAt: string | null;
  closedAt: string | null;
};

type BatchInfo = {
  id: string;
  filename: string;
  sourceName: string;
  status: string;
  totalRows: number;
  matchedRows: number;
  ambiguousRows: number;
  unmatchedRows: number;
  appliedRows: number;
  computedTotal: number;
  declaredTotal: number | null;
  uploadedBy: string;
  createdAt: string;
};

type TotalInfo = {
  collaboratorId: string;
  collaboratorName: string;
  rowCount: number;
  importedTotal: number;
  adjustmentsTotal: number;
  netTotal: number;
  appliedCount: number;
};

type PendingRow = {
  id: string;
  sheetName: string;
  rowIndex: number;
  podRaw: string;
  clientNameRaw: string;
  amount: number | null;
  period: string | null;
  matchStatus: string;
  matchReason: string | null;
  note: string | null;
  hasCandidates: boolean;
};

type AdjustmentInfo = {
  id: string;
  kind: string;
  amount: number;
  note: string;
  collaboratorId: string;
  collaboratorName: string;
  authorName: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

type ReportItemInfo = {
  id: string;
  collaboratorName: string;
  importedTotal: number;
  adjustmentsTotal: number;
  netTotal: number;
  rowCount: number;
  delivery: string;
  sentAt: string | null;
  lastError: string | null;
  ready: boolean;
};

type ReportRunInfo = {
  id: string;
  version: number;
  status: string;
  reason: string | null;
  createdAt: string;
  authorName: string;
  items: ReportItemInfo[];
};

type Candidate = {
  id: string;
  contractNumber: string;
  clientName: string;
  supplierName: string;
  collaboratorName: string;
  podPdr: string;
};

const DELIVERY_LABEL: Record<string, string> = {
  PENDING: "Da inviare",
  SENDING: "Invio avviato — da verificare",
  SENT: "Inviato",
  ERROR: "Errore",
  SKIPPED: "Saltato",
};

const MATCH_STATUS_LABEL: Record<string, string> = {
  AMBIGUOUS: "Da confermare",
  UNMATCHED: "Contratto non trovato",
  ERROR: "Errore",
};

/** Numero massimo di giri del ciclo a lotti, salvaguardia contro il non-avanzamento. */
const LOOP_GUARD = 500;

function itDate(iso: string): string {
  return new Date(iso).toLocaleString("it-IT");
}

export function PayoutRunDetail({
  canManage,
  run,
  batches,
  totals,
  pendingRows,
  adjustments,
  reportRuns,
  adjustmentsAfterReport,
}: {
  canManage: boolean;
  run: RunInfo;
  batches: BatchInfo[];
  totals: TotalInfo[];
  pendingRows: PendingRow[];
  adjustments: AdjustmentInfo[];
  reportRuns: ReportRunInfo[];
  adjustmentsAfterReport: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const [adjCollaborator, setAdjCollaborator] = useState(
    totals[0]?.collaboratorId ?? "",
  );
  const [adjKind, setAdjKind] = useState("EXTRA");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");

  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const closed = run.status === "CLOSED";
  const netTotal = totals.reduce((sum, t) => sum + t.netTotal, 0);
  const importedTotal = totals.reduce((sum, t) => sum + t.importedTotal, 0);
  const adjustmentsTotal = totals.reduce((sum, t) => sum + t.adjustmentsTotal, 0);

  function reset() {
    setError(null);
    setMessage(null);
    setProgress(null);
  }

  /** Richiama un'azione a lotti finché non resta nulla da elaborare. */
  async function runBatched(
    action: (fd: FormData) => Promise<
      | { ok: true; processed: number; remaining: number; applied: number; skipped: number; errors: number }
      | { ok: false; error: string }
    >,
    buildFd: () => FormData,
    label: string,
  ): Promise<{ applied: number; skipped: number; errors: number } | null> {
    let applied = 0;
    let skipped = 0;
    let errors = 0;
    for (let guard = 0; guard < LOOP_GUARD; guard++) {
      const step = await action(buildFd());
      if (!step.ok) {
        setError(step.error);
        return null;
      }
      applied += step.applied;
      skipped += step.skipped;
      errors += step.errors;
      setProgress(`${label}: ${applied} completate · ${step.remaining} rimanenti`);
      if (step.remaining === 0 || step.processed === 0) break;
    }
    return { applied, skipped, errors };
  }

  function applyBatch(batchId: string) {
    reset();
    start(async () => {
      const result = await runBatched(
        applyPayoutBatchAction,
        () => {
          const fd = new FormData();
          fd.set("batchId", batchId);
          return fd;
        },
        "Applicazione",
      );
      if (result) {
        setMessage(
          `Applicate ${result.applied} righe · ${result.skipped} saltate${
            result.errors > 0 ? ` · ${result.errors} in errore` : ""
          }`,
        );
        router.refresh();
      }
    });
  }

  function revertBatch(batchId: string, filename: string) {
    if (
      !window.confirm(
        `Annullare l'applicazione di «${filename}»? I contratti tornano allo stato precedente.`,
      )
    ) {
      return;
    }
    reset();
    start(async () => {
      const result = await runBatched(
        revertPayoutBatchAction,
        () => {
          const fd = new FormData();
          fd.set("batchId", batchId);
          return fd;
        },
        "Annullamento",
      );
      if (result) {
        setMessage(`Annullate ${result.applied} righe`);
        router.refresh();
      }
    });
  }

  function addAdjustment() {
    reset();
    if (!adjCollaborator) {
      setError("Scegli il collaboratore");
      return;
    }
    if (!adjNote.trim()) {
      setError("La nota è obbligatoria: indica il motivo della rettifica");
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("runId", run.id);
      fd.set("collaboratorId", adjCollaborator);
      fd.set("kind", adjKind);
      fd.set("amount", adjAmount);
      fd.set("note", adjNote.trim());
      const res = await addPayoutAdjustmentAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdjAmount("");
      setAdjNote("");
      setMessage("Rettifica aggiunta: i totali sono stati ricalcolati");
      router.refresh();
    });
  }

  function voidAdjustment(id: string) {
    const reason = window.prompt("Motivo dell'annullamento della rettifica:");
    if (!reason?.trim()) return;
    reset();
    start(async () => {
      const fd = new FormData();
      fd.set("adjustmentId", id);
      fd.set("reason", reason.trim());
      const res = await voidPayoutAdjustmentAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage("Rettifica annullata: resta visibile nello storico");
      router.refresh();
    });
  }

  function generateReports() {
    reset();
    const reason =
      reportRuns.length > 0
        ? window.prompt(
            "Motivo della rigenerazione (resta nello storico delle versioni):",
            adjustmentsAfterReport > 0 ? "Rettifiche manuali aggiunte" : "",
          )
        : "";
    if (reportRuns.length > 0 && reason === null) return;

    start(async () => {
      const fd = new FormData();
      fd.set("runId", run.id);
      if (reason) fd.set("reason", reason);
      const started = await startPayoutReportRunAction(fd);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      const result = await runBatched(
        generatePayoutReportBatchAction,
        () => {
          const inner = new FormData();
          inner.set("reportRunId", started.reportRunId);
          return inner;
        },
        "Generazione report",
      );
      if (result) {
        setMessage(
          `Versione ${started.version} generata: ${result.applied} report su ${started.itemCount}`,
        );
        router.refresh();
      }
    });
  }

  function sendReports(reportRunId: string, version: number) {
    if (
      !window.confirm(
        `Inviare i report della versione ${version}? Le email arrivano al tuo indirizzo, una per collaboratore.`,
      )
    ) {
      return;
    }
    reset();
    start(async () => {
      const result = await runBatched(
        sendPayoutReportBatchAction,
        () => {
          const fd = new FormData();
          fd.set("reportRunId", reportRunId);
          return fd;
        },
        "Invio email",
      );
      if (result) {
        setMessage(
          `Inviati ${result.applied} report${
            result.errors > 0 ? ` · ${result.errors} in errore` : ""
          }`,
        );
        router.refresh();
      }
    });
  }

  function markLiquidated() {
    if (
      !window.confirm(
        "Segnare le provvigioni come liquidate ai collaboratori? È il passo successivo all'incasso dal fornitore.",
      )
    ) {
      return;
    }
    reset();
    start(async () => {
      const result = await runBatched(
        markPayoutRunLiquidatedAction,
        () => {
          const fd = new FormData();
          fd.set("runId", run.id);
          return fd;
        },
        "Liquidazione",
      );
      if (result) {
        setMessage(`Liquidati ${result.applied} contratti`);
        router.refresh();
      }
    });
  }

  function toggleClosed() {
    reset();
    start(async () => {
      const fd = new FormData();
      fd.set("runId", run.id);
      fd.set("close", closed ? "0" : "1");
      const res = await setPayoutRunClosedAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(closed ? "Liquidazione riaperta" : "Liquidazione chiusa");
      router.refresh();
    });
  }

  function showCandidates(rowId: string) {
    reset();
    start(async () => {
      const fd = new FormData();
      fd.set("rowId", rowId);
      const res = await loadPayoutRowCandidatesAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCandidatesFor(rowId);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setMessage("Nessun candidato registrato per questa riga");
      }
    });
  }

  function resolveRow(rowId: string, contractId: string | null) {
    reset();
    start(async () => {
      const fd = new FormData();
      fd.set("rowId", rowId);
      if (contractId) fd.set("contractId", contractId);
      else fd.set("ignore", "1");
      const res = await resolvePayoutRowAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCandidatesFor(null);
      setCandidates([]);
      setMessage(
        contractId
          ? "Riga assegnata: applica il file per scriverla sui contratti"
          : "Riga esclusa dalla liquidazione",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Totale da rendiconti</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatCurrency(importedTotal)}
          </p>
        </Card>
        <Card className={adjustmentsTotal < 0 ? "border-amber-200 bg-amber-50" : ""}>
          <p className="text-sm text-slate-500">Rettifiche manuali</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatCurrency(adjustmentsTotal)}
          </p>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm text-slate-500">Netto da liquidare</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatCurrency(netTotal)}
          </p>
        </Card>
      </div>

      {canManage ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generateReports} disabled={pending || closed}>
              {reportRuns.length === 0
                ? "Genera report per collaboratore"
                : "Rigenera report"}
            </Button>
            <Button
              variant="secondary"
              onClick={markLiquidated}
              disabled={pending || closed || !run.appliedAt}
            >
              Segna liquidato ai collaboratori
            </Button>
            <Button variant="ghost" onClick={toggleClosed} disabled={pending}>
              {closed ? "Riapri liquidazione" : "Chiudi liquidazione"}
            </Button>
          </div>
          {run.liquidatedAt ? (
            <p className="mt-2 text-sm text-emerald-700">
              Liquidata ai collaboratori il {itDate(run.liquidatedAt)}
            </p>
          ) : null}
          {adjustmentsAfterReport > 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              {adjustmentsAfterReport} rettifiche sono state aggiunte dopo
              l&apos;ultima generazione: i report vanno rigenerati.
            </p>
          ) : null}
          {closed ? (
            <p className="mt-2 text-sm text-slate-500">
              La liquidazione è chiusa: riaprila per aggiungere file o rettifiche.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle>Totali per collaboratore</CardTitle>
        {totals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessuna riga attribuita a un collaboratore. Risolvi le righe da
            confermare qui sotto.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Collaboratore</th>
                  <th className="px-3 py-2">Righe</th>
                  <th className="px-3 py-2">Applicate</th>
                  <th className="px-3 py-2 text-right">Da rendiconti</th>
                  <th className="px-3 py-2 text-right">Rettifiche</th>
                  <th className="px-3 py-2 text-right">Netto</th>
                  <th className="px-3 py-2">Rendiconto generico</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.collaboratorId} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{t.collaboratorName}</td>
                    <td className="px-3 py-2">{t.rowCount}</td>
                    <td className="px-3 py-2">{t.appliedCount}</td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(t.importedTotal)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        t.adjustmentsTotal < 0 ? "text-red-700" : ""
                      }`}
                    >
                      {formatCurrency(t.adjustmentsTotal)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatCurrency(t.netTotal)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        className="text-xs text-emerald-700 hover:underline"
                        href={`/api/report/excel?collaboratorId=${t.collaboratorId}&month=${run.period}`}
                      >
                        Excel
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage ? (
        <Card>
          <CardTitle>Rettifiche manuali</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            Extra, storni e acconti già versati. Non sovrascrivono i dati
            importati: sono voci distinte con autore, data e motivo. Storni e
            acconti sottraggono sempre dal netto.
          </p>

          {!closed ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Collaboratore">
                <Select
                  value={adjCollaborator}
                  onChange={(e) => setAdjCollaborator(e.target.value)}
                >
                  <option value="">Scegli…</option>
                  {totals.map((t) => (
                    <option key={t.collaboratorId} value={t.collaboratorId}>
                      {t.collaboratorName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipo">
                <Select
                  value={adjKind}
                  onChange={(e) => setAdjKind(e.target.value)}
                >
                  {Object.entries(PAYOUT_ADJUSTMENT_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Importo €">
                <Input
                  value={adjAmount}
                  inputMode="decimal"
                  placeholder="es. 50,00"
                  onChange={(e) => setAdjAmount(e.target.value)}
                />
              </Field>
              <Field label="Nota (obbligatoria)">
                <Textarea
                  value={adjNote}
                  rows={2}
                  placeholder="Motivo della rettifica"
                  onChange={(e) => setAdjNote(e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button
                  variant="secondary"
                  onClick={addAdjustment}
                  disabled={pending}
                >
                  Aggiungi rettifica
                </Button>
                {adjKind === "STORNO" || adjKind === "ACCONTO" ? (
                  <span className="ml-3 text-xs text-slate-500">
                    L&apos;importo verrà sottratto dal netto.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {adjustments.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Collaboratore</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Importo</th>
                    <th className="px-3 py-2">Nota</th>
                    <th className="px-3 py-2">Inserita</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr
                      key={a.id}
                      className={`border-t border-slate-100 ${
                        a.voidedAt ? "text-slate-400 line-through" : ""
                      }`}
                    >
                      <td className="px-3 py-2">{a.collaboratorName}</td>
                      <td className="px-3 py-2">
                        {PAYOUT_ADJUSTMENT_LABEL[a.kind] ?? a.kind}
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${
                          a.amount < 0 && !a.voidedAt ? "text-red-700" : ""
                        }`}
                      >
                        {formatCurrency(a.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {a.note}
                        {a.voidReason ? (
                          <span className="block text-xs no-underline">
                            Annullata: {a.voidReason}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {itDate(a.createdAt)} · {a.authorName}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!a.voidedAt && !closed ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => voidAdjustment(a.id)}
                            disabled={pending}
                          >
                            Annulla
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle>File importati</CardTitle>
        <div className="mt-3 space-y-3">
          {batches.map((b) => {
            const quadra =
              b.declaredTotal == null
                ? null
                : Math.abs(b.computedTotal - b.declaredTotal) < 0.01;
            return (
              <div
                key={b.id}
                className="rounded-lg border border-slate-200 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{b.filename}</p>
                    <p className="text-xs text-slate-500">
                      {b.sourceName} · caricato da {b.uploadedBy} il{" "}
                      {itDate(b.createdAt)}
                    </p>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {b.status}
                  </span>
                </div>
                <p className="mt-2 text-slate-700">
                  {b.totalRows} righe · {b.appliedRows} applicate ·{" "}
                  {b.ambiguousRows} da confermare · {b.unmatchedRows} non trovate
                </p>
                <p className="mt-1 text-slate-700">
                  Totale letto {formatCurrency(b.computedTotal)}
                  {b.declaredTotal != null ? (
                    <>
                      {" · "}dichiarato {formatCurrency(b.declaredTotal)}
                      {quadra ? (
                        <span className="ml-2 text-emerald-700">quadra</span>
                      ) : (
                        <span className="ml-2 text-red-700">non quadra</span>
                      )}
                    </>
                  ) : null}
                </p>
                {canManage && !closed ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {b.status === "PARSED" || b.matchedRows > b.appliedRows ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => applyBatch(b.id)}
                        disabled={pending}
                      >
                        Applica righe pronte
                      </Button>
                    ) : null}
                    {b.appliedRows > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revertBatch(b.id, b.filename)}
                        disabled={pending}
                      >
                        Annulla applicazione
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {pendingRows.length > 0 ? (
        <Card>
          <CardTitle>Righe da risolvere</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            Non vengono applicate in automatico. Le righe senza contratto possono
            indicare una pratica mai inserita a sistema.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Riga</th>
                  <th className="px-3 py-2">POD/PDR</th>
                  <th className="px-3 py-2">Cliente nel file</th>
                  <th className="px-3 py-2">Competenza</th>
                  <th className="px-3 py-2 text-right">Importo</th>
                  <th className="px-3 py-2">Esito</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.sheetName}:{row.rowIndex}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.podRaw}</td>
                    <td className="px-3 py-2">{row.clientNameRaw}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.period ? periodLabel(row.period) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.amount == null ? "—" : formatCurrency(row.amount)}
                    </td>
                    <td className="px-3 py-2">
                      {MATCH_STATUS_LABEL[row.matchStatus] ?? row.matchStatus}
                      {row.note ? (
                        <span className="block text-xs text-slate-500">
                          {row.note}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && !closed ? (
                        <div className="flex justify-end gap-1">
                          {row.hasCandidates ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => showCandidates(row.id)}
                              disabled={pending}
                            >
                              Candidati
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resolveRow(row.id, null)}
                            disabled={pending}
                          >
                            Escludi
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {candidatesFor && candidates.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                Scegli il contratto per la riga selezionata
              </p>
              <ul className="mt-2 space-y-2">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white p-2 text-sm"
                  >
                    <span>
                      {c.clientName}
                      <span className="block text-xs text-slate-500">
                        {c.contractNumber} · {c.supplierName} ·{" "}
                        {c.collaboratorName} · {c.podPdr}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      onClick={() => resolveRow(candidatesFor, c.id)}
                      disabled={pending}
                    >
                      Assegna
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle>Report generati</CardTitle>
        {reportRuns.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessun report generato. Ogni generazione crea una versione numerata,
            così si sa sempre quale documento è stato inviato.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {reportRuns.map((rr) => (
              <div
                key={rr.id}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      Versione {rr.version}
                    </p>
                    <p className="text-xs text-slate-500">
                      {itDate(rr.createdAt)} · {rr.authorName} · {rr.status}
                      {rr.reason ? ` · ${rr.reason}` : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => sendReports(rr.id, rr.version)}
                      disabled={
                        pending || rr.items.every((i) => i.delivery === "SENT")
                      }
                    >
                      Invia report via email
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Collaboratore</th>
                        <th className="px-3 py-2">Righe</th>
                        <th className="px-3 py-2 text-right">Netto</th>
                        <th className="px-3 py-2">Invio</th>
                        <th className="px-3 py-2">Documenti</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rr.items.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{item.collaboratorName}</td>
                          <td className="px-3 py-2">{item.rowCount}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatCurrency(item.netTotal)}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {DELIVERY_LABEL[item.delivery] ?? item.delivery}
                            {item.sentAt ? (
                              <span className="block text-slate-500">
                                {itDate(item.sentAt)}
                              </span>
                            ) : null}
                            {item.lastError ? (
                              <span className="block text-red-700">
                                {item.lastError}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {item.ready ? (
                              <span className="flex gap-2 text-xs">
                                <Link
                                  className="text-emerald-700 hover:underline"
                                  href={`/api/provvigioni/liquidazioni/report/${item.id}?formato=pdf`}
                                >
                                  PDF
                                </Link>
                                <Link
                                  className="text-emerald-700 hover:underline"
                                  href={`/api/provvigioni/liquidazioni/report/${item.id}?formato=xlsx`}
                                >
                                  Excel
                                </Link>
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">
                                in generazione
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
