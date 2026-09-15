"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyRecurringCleanupAction,
  scanRecurringCleanupAction,
} from "@/lib/recurring-cleanup-actions";
import type { ContractCleanupFinding } from "@/lib/recurring-cleanup";

/** Contratti bonificati per chiamata: allineato a CLEANUP_APPLY_BATCH. */
const APPLY_CHUNK = 50;
/** Contratti mostrati nell'elenco di anteprima (il resto è contato). */
const MAX_VISIBLE = 40;

type Preview = {
  findings: ContractCleanupFinding[];
  scannedContracts: number;
  scannedMonths: number;
  removableCount: number;
  manualCount: number;
};

const EMPTY: Preview = {
  findings: [],
  scannedContracts: 0,
  scannedMonths: 0,
  removableCount: 0,
  manualCount: 0,
};

export function RecurringCleanupPanel() {
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
      // Lotti successivi: ogni richiesta resta breve (limite serverless).
      for (let guard = 0; guard < 500; guard++) {
        const res = await scanRecurringCleanupAction({ cursor });
        if (!res.ok) {
          setError(res.error);
          setPhase("idle");
          return null;
        }
        acc.findings.push(...res.findings);
        acc.scannedContracts += res.scannedContracts;
        acc.scannedMonths += res.scannedMonths;
        acc.removableCount += res.removableCount;
        acc.manualCount += res.manualCount;
        setProgress(
          `Analizzati ${acc.scannedContracts} contratti · ${acc.scannedMonths} rate…`,
        );
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      acc.findings.sort(
        (a, b) =>
          b.removable.length + b.manual.length - (a.removable.length + a.manual.length),
      );
      setPreview(acc);
      setProgress(null);
      setPhase("idle");
      return acc;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Anteprima non riuscita");
      setProgress(null);
      setPhase("idle");
      return null;
    }
  }

  async function handleApply() {
    if (!preview || !confirmed) return;
    const contractIds = preview.findings
      .filter((f) => f.removable.length > 0)
      .map((f) => f.contractId);
    if (contractIds.length === 0) return;

    setPhase("applying");
    setError(null);
    setMessage(null);

    let deleted = 0;
    let done = 0;
    try {
      // Lotti piccoli: si può interrompere e riprendere senza danni.
      for (let i = 0; i < contractIds.length; i += APPLY_CHUNK) {
        const chunk = contractIds.slice(i, i + APPLY_CHUNK);
        const res = await applyRecurringCleanupAction({ contractIds: chunk });
        if (!res.ok) {
          setError(
            `${res.error} — rimosse ${deleted} rate su ${done} contratti prima dell'errore.` +
              " Puoi rilanciare l'anteprima e riprendere.",
          );
          setPhase("idle");
          return;
        }
        deleted += res.deleted;
        done += chunk.length;
        setProgress(`Bonificati ${done}/${contractIds.length} contratti…`);
      }

      setProgress(null);
      setPhase("idle");
      const after = await runPreview();
      setMessage(
        `Bonifica completata: ${deleted} rate rimosse su ${contractIds.length} contratti.` +
          (after
            ? ` Controllo successivo: ${after.removableCount} rate ancora da rimuovere,` +
              ` ${after.manualCount} da decidere a mano.`
            : ""),
      );
    } catch (e) {
      setProgress(null);
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Bonifica non riuscita");
    }
  }

  const busy = phase !== "idle";
  const withRemovable = preview?.findings.filter((f) => f.removable.length > 0) ?? [];
  const withManual = preview?.findings.filter((f) => f.manual.length > 0) ?? [];

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        4. Bonifica mesi ricorrenti fuori intervallo
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Rimuove le rate ricorrenti generate <strong>prima</strong> dell’inizio
        fornitura o <strong>dopo</strong> la chiusura del contratto. Il mese di
        ingresso e quello di chiusura restano sempre inclusi. Prima l’anteprima,
        poi la conferma: nessuna rimozione al primo clic. Le rate già incassate,
        pagate o segnalate non vengono mai toccate.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={runPreview} disabled={busy}>
          {phase === "scanning" ? "Anteprima in corso…" : "1. Anteprima (non modifica nulla)"}
        </Button>
        {preview && preview.removableCount > 0 ? (
          <Button
            type="button"
            variant="danger"
            onClick={handleApply}
            disabled={busy || !confirmed}
          >
            {phase === "applying"
              ? "Rimozione in corso…"
              : `2. Rimuovi ${preview.removableCount} rate`}
          </Button>
        ) : null}
      </div>

      {progress ? (
        <p className="mt-3 text-sm text-slate-600">{progress}</p>
      ) : null}

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
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat value={preview.scannedContracts} label="Contratti esaminati" />
            <Stat value={preview.scannedMonths} label="Rate esaminate" />
            <Stat
              value={preview.removableCount}
              label="Rate da rimuovere"
              tone="text-red-700"
            />
            <Stat
              value={preview.manualCount}
              label="Da decidere a mano"
              tone="text-amber-700"
            />
          </div>

          {preview.removableCount === 0 && preview.manualCount === 0 ? (
            <p className="text-sm text-emerald-800">
              Nessuna rata fuori intervallo: non c’è niente da bonificare.
            </p>
          ) : null}

          {withRemovable.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Da rimuovere · {preview.removableCount} rate su{" "}
                {withRemovable.length} contratti
              </h3>
              <ul className="space-y-2 text-sm text-slate-700">
                {withRemovable.slice(0, MAX_VISIBLE).map((f) => (
                  <li key={f.contractId} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="font-medium text-slate-800">{f.label}</p>
                    <p className="text-xs text-slate-500">
                      Intervallo di fornitura: {f.windowLabel} · {f.removable.length}{" "}
                      rate da rimuovere
                    </p>
                    <p className="text-xs text-slate-600">
                      {f.removable
                        .map((m) => `${m.periodLabel} (${m.reason})`)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
              {withRemovable.length > MAX_VISIBLE ? (
                <p className="mt-2 text-xs text-slate-500">
                  … altri {withRemovable.length - MAX_VISIBLE} contratti non
                  mostrati (verranno bonificati comunque).
                </p>
              ) : null}
            </div>
          ) : null}

          {withManual.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-amber-900">
                Da decidere a mano · {preview.manualCount} rate fuori intervallo già
                incassate, pagate o segnalate
              </h3>
              <p className="mb-2 text-xs text-amber-800">
                Non vengono rimosse nemmeno confermando: portano un valore
                economico. Vanno verificate una a una in Provvigioni.
              </p>
              <ul className="space-y-2 text-sm text-amber-900">
                {withManual.slice(0, MAX_VISIBLE).map((f) => (
                  <li key={f.contractId} className="border-b border-amber-200 pb-2 last:border-0">
                    <p className="font-medium">{f.label}</p>
                    <p className="text-xs">
                      {f.manual
                        .map(
                          (m) =>
                            `${m.periodLabel} · ${m.status}` +
                            `${m.amount != null ? ` · ${m.amount}€` : ""} · ${m.reason}`,
                        )
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
              {withManual.length > MAX_VISIBLE ? (
                <p className="mt-2 text-xs text-amber-800">
                  … altri {withManual.length - MAX_VISIBLE} contratti non mostrati.
                </p>
              ) : null}
            </div>
          ) : null}

          {preview.removableCount > 0 ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
                className="mt-0.5 rounded border-slate-300"
              />
              Ho letto l’elenco e confermo la rimozione delle {preview.removableCount}{" "}
              rate fuori intervallo. L’operazione è ripetibile senza danni e resta
              registrata nel registro attività.
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
