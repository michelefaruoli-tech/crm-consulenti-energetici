"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyMissingProvvigioniRowsAction,
  scanMissingProvvigioniRowsAction,
  syncRecentRecurringContractsAction,
} from "@/lib/recurring-backfill-actions";
import type { MissingProvvigioneRow } from "@/lib/recurring-backfill";
import { friendlyActionError } from "@/lib/friendly-client-error";
import { periodLabel } from "@/lib/recurring";

type Preview = {
  findings: MissingProvvigioneRow[];
  scannedContracts: number;
  missingContractsCount: number;
  missingPeriodsCount: number;
  /** null = tutti; 30 = solo ultimo mese */
  scopeDays: number | null;
};

const EMPTY: Preview = {
  findings: [],
  scannedContracts: 0,
  missingContractsCount: 0,
  missingPeriodsCount: 0,
  scopeDays: null,
};

export function ProvvigioniBackfillPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "scanning" | "applying" | "syncing"
  >("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function runPreview(scopeDays: number | null): Promise<Preview | null> {
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setConfirmed(false);
    setPreview(null);

    const acc: Preview = { ...EMPTY, findings: [], scopeDays };
    let cursor: string | null = null;

    try {
      for (let guard = 0; guard < 200; guard++) {
        const res = await scanMissingProvvigioniRowsAction({
          cursor,
          insertedSinceDays: scopeDays,
        });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return null;
        }
        acc.findings.push(...res.findings);
        acc.scannedContracts += res.scannedContracts;
        acc.missingContractsCount += res.missingContractsCount;
        acc.missingPeriodsCount += res.missingPeriodsCount;
        setProgress(
          scopeDays
            ? `Analizzati ${acc.scannedContracts} contratti degli ultimi ${scopeDays} giorni…`
            : `Analizzati ${acc.scannedContracts} contratti ricorrenti…`,
        );
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
      const after = await runPreview(preview.scopeDays);
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

  /** Catch-up sync su tutti i ricorrenti degli ultimi 30 giorni (idempotente). */
  async function handleSyncRecentMonth() {
    setPhase("syncing");
    setError(null);
    setMessage(null);
    let cursor: string | null = null;
    let scanned = 0;
    let synced = 0;
    let errCount = 0;

    try {
      for (let guard = 0; guard < 200; guard++) {
        const res = await syncRecentRecurringContractsAction({
          cursor,
          days: 30,
        });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return;
        }
        scanned += res.scanned;
        synced += res.synced;
        errCount += res.errors.length;
        setProgress(
          `Sync ultimo mese: ${synced}/${scanned} contratti aggiornati…`,
        );
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      setProgress(null);
      setPhase("idle");
      setMessage(
        `Sync ultimo mese completato: ${synced} contratti sincronizzati su ${scanned} esaminati` +
          (errCount > 0 ? ` (${errCount} errori).` : ".") +
          " Helios senza rate nel lag M+2 resta visibile in Da incassare; le rate si creano al mese di pagamento.",
      );
      await runPreview(30);
    } catch (e) {
      setPhase("idle");
      setProgress(null);
      setError(friendlyActionError(e));
    }
  }

  const busy = phase !== "idle";
  const annualFindings =
    preview?.findings.filter((f) => f.recurrenceKind === "R") ?? [];
  const monthlyFindings =
    preview?.findings.filter((f) => f.recurrenceKind === "M") ?? [];
  const annualPeriods = annualFindings.reduce(
    (n, f) => n + f.missingPeriods.length,
    0,
  );

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        5. Backfill contratti mancanti in Provvigioni
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Trova i contratti ricorrenti (mensili o annuali, qualsiasi fornitore)
        già salvati che non hanno ancora la riga in Provvigioni e la crea come{" "}
        <strong>Da incassare</strong> (mai liquidata in automatico). Rispetta
        sempre la finestra di fornitura e il ritardo Helios M+2: a settembre non
        crea agosto né settembre; agosto solo a ottobre. Le annuali solo al 13°
        mese. Non tocca mai una rata già presente — Incassato, Pagato o storno
        restano come li hai impostati tu. Percorso: Anteprima → conferma → Crea.
        Per i contratti di oggi/ultimo mese usa «Sync ultimo mese» (idempotente)
        e poi l’anteprima filtrata a 30 giorni.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => runPreview(null)}
          disabled={busy}
        >
          {phase === "scanning" && preview?.scopeDays == null
            ? "Anteprima in corso…"
            : "1. Anteprima tutti"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => runPreview(30)}
          disabled={busy}
        >
          {phase === "scanning" && preview?.scopeDays === 30
            ? "Anteprima in corso…"
            : "1b. Anteprima ultimo mese (30 gg)"}
        </Button>
        <Button type="button" variant="secondary" onClick={handleSyncRecentMonth} disabled={busy}>
          {phase === "syncing" ? "Sync in corso…" : "Sync ultimo mese (catch-up)"}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              value={preview.scannedContracts}
              label={
                preview.scopeDays
                  ? `Esaminati (ultimi ${preview.scopeDays} gg)`
                  : "Contratti ricorrenti esaminati"
              }
            />
            <Stat
              value={preview.missingContractsCount}
              label="Contratti senza rata"
              tone="text-violet-700"
            />
            <Stat
              value={monthlyFindings.length}
              label={`Mensili (${preview.missingPeriodsCount - annualPeriods} rate)`}
              tone="text-slate-900"
            />
            <Stat
              value={annualFindings.length}
              label={`Annuali da rivedere (${annualPeriods} rate)`}
              tone="text-violet-700"
            />
          </div>

          {preview.findings.length === 0 ? (
            <p className="text-sm text-emerald-800">
              Nessun contratto ricorrente senza rata
              {preview.scopeDays
                ? ` negli ultimi ${preview.scopeDays} giorni`
                : ""}
              : non c’è niente da sistemare. Helios senza rate nel lag resta
              comunque visibile in Provvigioni (gettone previsto).
            </p>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                Contratti che riceveranno la rata «Da incassare» (mese rif. =
                competenza)
                {preview.scopeDays
                  ? ` — ultimi ${preview.scopeDays} giorni`
                  : ""}
              </h3>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-[720px] text-left text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-2 py-2">Contratto</th>
                      <th className="px-2 py-2">Collaboratore</th>
                      <th className="px-2 py-2">Tipo</th>
                      <th className="px-2 py-2">Mesi rif. mancanti</th>
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
                          {f.missingPeriods
                            .map((p) => `${periodLabel(p)} (${p})`)
                            .join(", ")}
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
