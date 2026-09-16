"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyPayoutBatchAction,
  createBulkHistoricalHeliosBatchAction,
  previewBulkHistoricalHeliosAction,
} from "@/lib/payout-actions";
import {
  BULK_HISTORICAL_PERIOD_LIMIT,
  type BulkHistoricalPreviewResult,
} from "@/lib/payout/view-types";
import { periodLabel } from "@/lib/recurring";
import { formatCurrency } from "@/lib/commission";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

function buildFormData(params: {
  markMode: "INCASSATO" | "LIQUIDATO";
  exclusionMode: "TOTAL" | "ACTIVE_ONLY";
}): FormData {
  const fd = new FormData();
  fd.set("periodLimit", BULK_HISTORICAL_PERIOD_LIMIT);
  fd.set("markMode", params.markMode);
  fd.set("exclusionMode", params.exclusionMode);
  return fd;
}

export function PayoutBulkHistoricalPanel() {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [markMode, setMarkMode] = useState<"INCASSATO" | "LIQUIDATO">(
    "LIQUIDATO",
  );
  const [exclusionMode, setExclusionMode] = useState<"TOTAL" | "ACTIVE_ONLY">(
    "ACTIVE_ONLY",
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkHistoricalPreviewResult | null>(
    null,
  );

  function resetMessages() {
    setError(null);
    setMessage(null);
    setProgress(null);
  }

  function runPreview() {
    resetMessages();
    setPreview(null);
    start(async () => {
      const res = await previewBulkHistoricalHeliosAction(
        buildFormData({ markMode, exclusionMode }),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res);
    });
  }

  function runApply() {
    if (!preview) return;

    const statoLabel =
      markMode === "LIQUIDATO"
        ? "liquidato al collaboratore (Pagato)"
        : "incassato dal fornitore (Incassato)";
    const exclLabel =
      exclusionMode === "ACTIVE_ONLY"
        ? "escludi Moschetta e Lobefaro solo sui contratti attivi"
        : "escludi tutti i contratti di Moschetta e Lobefaro";

    const lines = [
      `Confermi la marcatura massiva Helios fino a ${periodLabel(BULK_HISTORICAL_PERIOD_LIMIT)}?`,
      "",
      `Stato: ${statoLabel}`,
      `Esclusione: ${exclLabel}`,
      "",
      `${preview.summary.contractCount} contratti · ${preview.summary.rateCount} rate · ${formatCurrency(preview.summary.totalAmount)}`,
      `${preview.summary.skippedCount} casi saltati`,
    ];
    if (preview.summary.outsideWindowCount > 0) {
      lines.push(
        "",
        `Attenzione: ${preview.summary.outsideWindowCount} rate sono fuori finestra di fornitura.`,
      );
    }
    lines.push("", "L'operazione resta annullabile dalla scheda liquidazione.");

    if (!window.confirm(lines.join("\n"))) return;

    resetMessages();
    start(async () => {
      const created = await createBulkHistoricalHeliosBatchAction(
        buildFormData({ markMode, exclusionMode }),
      );
      if (!created.ok) {
        setError(created.error);
        return;
      }

      if (created.existing) {
        setMessage(
          "Batch già esistente con gli stessi parametri: ripresa applicazione.",
        );
      }

      let applied = 0;
      let skipped = 0;
      let errors = 0;
      let guard = 0;
      for (;;) {
        const fd = new FormData();
        fd.set("batchId", created.batchId);
        const step = await applyPayoutBatchAction(fd);
        if (!step.ok) {
          setError(step.error);
          break;
        }
        applied += step.applied;
        skipped += step.skipped;
        errors += step.errors;
        setProgress(`Applicate ${applied} rate · ${step.remaining} rimanenti`);
        if (step.remaining === 0) break;
        guard += 1;
        if (step.processed === 0 || guard > 500) break;
      }

      setMessage(
        [
          `Marcatura completata: ${applied} rate applicate`,
          skipped > 0 ? `${skipped} saltate` : null,
          errors > 0 ? `${errors} in errore` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setPreview(null);
      router.push(`/provvigioni/liquidazioni/${created.runId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong>Prerequisito:</strong> eseguire prima la bonifica dei mesi
        ricorrenti fuori intervallo. Le rate fuori finestra vengono segnalate in
        anteprima ma non bloccate.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Field label="Stato da applicare">
            <Select
              value={markMode}
              onChange={(e) => {
                setMarkMode(e.target.value as "INCASSATO" | "LIQUIDATO");
                setPreview(null);
                resetMessages();
              }}
            >
              <option value="LIQUIDATO">
                Liquidato al collaboratore (predefinito)
              </option>
              <option value="INCASSATO">Incassato dal fornitore</option>
            </Select>
          </Field>
          <p className="mt-1 text-xs text-slate-500">
            {markMode === "LIQUIDATO"
              ? "Liquidato = hai pagato il collaboratore (Pagato, PROVVIGIONE_LIQUIDATA)."
              : "Incassato = il fornitore ha pagato l'agenzia (Incassato, PAGATO_DAL_FORNITORE)."}
          </p>
        </div>

        <div>
          <Field label="Esclusione Moschetta / Lobefaro">
            <Select
              value={exclusionMode}
              onChange={(e) => {
                setExclusionMode(e.target.value as "TOTAL" | "ACTIVE_ONLY");
                setPreview(null);
                resetMessages();
              }}
            >
              <option value="ACTIVE_ONLY">
                Solo contratti attivi (predefinito)
              </option>
              <option value="TOTAL">Esclusione totale</option>
            </Select>
          </Field>
          <p className="mt-1 text-xs text-slate-500">
            {exclusionMode === "ACTIVE_ONLY"
              ? "Salta solo i contratti ancora attivi di Moschetta e Lobefaro; lo storico chiuso viene marcato."
              : "Salta tutti i contratti di Moschetta e Lobefaro, attivi o meno."}
          </p>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Fornitore: <strong>Helios</strong> · Mesi fino a{" "}
        <strong>{periodLabel(BULK_HISTORICAL_PERIOD_LIMIT)}</strong> compreso
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Calcolo anteprima…" : "Anteprima"}
        </Button>
        <Button
          onClick={runApply}
          disabled={pending || !preview || preview.summary.rateCount === 0}
        >
          {pending && preview ? "Applicazione…" : "Conferma e applica"}
        </Button>
      </div>

      {progress ? <p className="text-sm text-slate-600">{progress}</p> : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-700">{message}</p>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-slate-500">Contratti</p>
              <p className="text-lg font-semibold text-slate-900">
                {preview.summary.contractCount}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Rate</p>
              <p className="text-lg font-semibold text-slate-900">
                {preview.summary.rateCount}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Totale</p>
              <p className="text-lg font-semibold text-emerald-700">
                {formatCurrency(preview.summary.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Saltati</p>
              <p className="text-lg font-semibold text-slate-700">
                {preview.summary.skippedCount}
              </p>
            </div>
          </div>

          {preview.summary.outsideWindowCount > 0 ? (
            <p className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {preview.summary.outsideWindowCount} rate selezionate cadono fuori
              dalla finestra di fornitura del contratto: valuta la bonifica
              prima di applicare.
            </p>
          ) : null}

          {preview.byCollaborator.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Per collaboratore
              </h3>
              <div className="max-h-48 overflow-auto rounded border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Collaboratore</th>
                      <th className="px-3 py-2">Contratti</th>
                      <th className="px-3 py-2">Rate</th>
                      <th className="px-3 py-2">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.byCollaborator.map((row) => (
                      <tr key={row.collaboratorName} className="border-t">
                        <td className="px-3 py-1.5">{row.collaboratorName}</td>
                        <td className="px-3 py-1.5">{row.contractCount}</td>
                        <td className="px-3 py-1.5">{row.rateCount}</td>
                        <td className="px-3 py-1.5">
                          {formatCurrency(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.byMonth.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Per mese
              </h3>
              <div className="max-h-40 overflow-auto rounded border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Mese</th>
                      <th className="px-3 py-2">Rate</th>
                      <th className="px-3 py-2">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.byMonth.map((row) => (
                      <tr key={row.period} className="border-t">
                        <td className="px-3 py-1.5">
                          {periodLabel(row.period)}
                        </td>
                        <td className="px-3 py-1.5">{row.rateCount}</td>
                        <td className="px-3 py-1.5">
                          {formatCurrency(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.skippedByReason.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Casi saltati (per motivo)
              </h3>
              <ul className="space-y-1 text-sm text-slate-600">
                {preview.skippedByReason.map((s) => (
                  <li key={s.reason}>
                    <strong>{s.count}</strong> · {s.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.sampleSkipped.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Esempi saltati ({preview.sampleSkipped.length}
                {preview.truncated ? "+" : ""})
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-slate-600">
                {preview.sampleSkipped.map((s, i) => (
                  <li key={`${s.contractNumber}-${s.period}-${i}`}>
                    {s.contractNumber} · {s.collaboratorName} · {s.period}:{" "}
                    {s.reason}
                    {s.detail ? ` (${s.detail})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {preview.truncated ? (
            <p className="text-xs text-slate-500">
              Anteprima troncata: i totali sopra riguardano tutte le rate.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
