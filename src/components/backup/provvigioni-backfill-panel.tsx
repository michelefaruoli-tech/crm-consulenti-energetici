"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyMissingProvvigioniRowsAction,
  scanMissingProvvigioniRowsAction,
} from "@/lib/recurring-backfill-actions";
import type { MissingProvvigioneRow } from "@/lib/recurring-backfill";
import { friendlyActionError } from "@/lib/friendly-client-error";

type Preview = {
  findings: MissingProvvigioneRow[];
  scannedContracts: number;
  missingContractsCount: number;
  missingPeriodsCount: number;
};

const EMPTY: Preview = {
  findings: [],
  scannedContracts: 0,
  missingContractsCount: 0,
  missingPeriodsCount: 0,
};

export function ProvvigioniBackfillPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "applying">("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function runPreview(): Promise<Preview | null> {
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setConfirmed(false);
    setPreview(null);

    const acc: Preview = { ...EMPTY, findings: [] };
    let cursor: string | null = null;

    try {
      for (let guard = 0; guard < 200; guard++) {
        const res = await scanMissingProvvigioniRowsAction({ cursor });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return null;
        }
        acc.findings.push(...res.findings);
        acc.scannedContracts += res.scannedContracts;
        acc.missingContractsCount += res.missingContractsCount;
        acc.missingPeriodsCount += res.missingPeriodsCount;
        setProgress(`Analizzati ${acc.scannedContracts} contratti ricorrenti…`);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      acc.findings.sort((a, b) => a.label.localeCompare(b.label, "it"));
      setPreview(acc);
      setProgress(null);
      setPhase("idle");
      return acc;
    } catch (e) {
      setError(friendlyActionError(e));
      setProgress(null);
      setPhase("idle");
      return null;
    }
  }

  async function handleApply() {
    if (!preview || !confirmed || preview.findings.length === 0) return;
    const contractIds = preview.findings.map((f) => f.contractId);

    setPhase("applying");
    setError(null);
    setMessage(null);

    try {
      const res = await applyMissingProvvigioniRowsAction({ contractIds });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setPhase("idle");
      const after = await runPreview();
      setMessage(
        `Backfill completato: ${res.created} create, ${res.updated} aggiornate su ${res.contracts} contratti.` +
          (res.errors.length > 0
            ? ` ${res.errors.length} contratto/i con errore (vedi console).`
            : "") +
          (after
            ? ` Controllo successivo: ${after.missingContractsCount} contratti ancora senza rata.`
            : ""),
      );
    } catch (e) {
      setPhase("idle");
      setError(friendlyActionError(e));
    }
  }

  const busy = phase !== "idle";

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        5. Backfill contratti mancanti in Provvigioni
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Trova i contratti ricorrenti (mensili o annuali, qualsiasi fornitore)
        già salvati che non hanno ancora la riga in Provvigioni e la crea come{" "}
        <strong>Da incassare</strong>. Rispetta sempre la finestra di fornitura
        e il ritardo Helios (2 mesi): non crea nulla fuori regola. Non tocca mai
        una rata già presente — Incassato, Pagato o storno restano come li hai
        impostati tu.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={runPreview} disabled={busy}>
          {phase === "scanning" ? "Anteprima in corso…" : "1. Anteprima (non modifica nulla)"}
        </Button>
        {preview && preview.findings.length > 0 ? (
          <Button type="button" onClick={handleApply} disabled={busy || !confirmed}>
            {phase === "applying"
              ? "Backfill in corso…"
              : `2. Crea ${preview.missingPeriodsCount} rate mancanti`}
          </Button>
        ) : null}
      </div>

      {progress ? <p className="mt-3 text-sm text-slate-600">{progress}</p> : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat value={preview.scannedContracts} label="Contratti ricorrenti esaminati" />
            <Stat
              value={preview.missingContractsCount}
              label="Contratti senza rata"
              tone="text-violet-700"
            />
            <Stat
              value={preview.missingPeriodsCount}
              label="Rate da creare"
              tone="text-violet-700"
            />
          </div>

          {preview.findings.length === 0 ? (
            <p className="text-sm text-emerald-800">
              Nessun contratto ricorrente senza rata: non c’è niente da
              sistemare.
            </p>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                Contratti che riceveranno la rata «Da incassare»
              </h3>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-[720px] text-left text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-2 py-2">Contratto</th>
                      <th className="px-2 py-2">Collaboratore</th>
                      <th className="px-2 py-2">Tipo</th>
                      <th className="px-2 py-2">Mesi mancanti</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.findings.map((f) => (
                      <tr
                        key={f.contractId}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-2 py-2 align-top">{f.label}</td>
                        <td className="px-2 py-2 align-top">{f.collaboratorName}</td>
                        <td className="px-2 py-2 align-top">
                          {f.recurrenceKind === "R" ? "Annuale" : "Mensile"}
                        </td>
                        <td className="px-2 py-2 align-top text-xs">
                          {f.missingPeriods.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.findings.length > 0 ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
                className="mt-0.5 rounded border-slate-300"
              />
              Ho controllato l’elenco e confermo la creazione delle rate «Da
              incassare» per questi {preview.missingContractsCount} contratti.
              Operazione ripetibile senza danni.
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Stat({
  value,
  label,
  tone = "text-slate-900",
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
