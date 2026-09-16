"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyRecurringCleanupAction,
  scanRecurringCleanupAction,
} from "@/lib/recurring-cleanup-actions";
import type { ContractCleanupFinding } from "@/lib/recurring-cleanup";
import { RECURRING_STATUS_LABELS } from "@/lib/recurring";

/** Allineato a `CLEANUP_APPLY_MONTH_BATCH` in `recurring-cleanup.ts`. */
const APPLY_MONTH_CHUNK = 100;
/** Altezza massima tabella anteprima (scroll interno, tutte le righe selezionabili). */
const TABLE_MAX_HEIGHT = "28rem";

type Preview = {
  findings: ContractCleanupFinding[];
  scannedContracts: number;
  scannedMonths: number;
  removableCount: number;
  manualCount: number;
};

type RemovableRow = {
  id: string;
  contractId: string;
  contractLabel: string;
  collaboratorName: string;
  periodLabel: string;
  reason: string;
  status: string;
  amount: number | null;
};

const EMPTY: Preview = {
  findings: [],
  scannedContracts: 0,
  scannedMonths: 0,
  removableCount: 0,
  manualCount: 0,
};

function flattenRemovable(findings: ContractCleanupFinding[]): RemovableRow[] {
  const rows: RemovableRow[] = [];
  for (const f of findings) {
    for (const m of f.removable) {
      rows.push({
        id: m.id,
        contractId: f.contractId,
        contractLabel: f.label,
        collaboratorName: f.collaboratorName,
        periodLabel: m.periodLabel,
        reason: m.reason,
        status: RECURRING_STATUS_LABELS[m.status as keyof typeof RECURRING_STATUS_LABELS] ?? m.status,
        amount: m.amount,
      });
    }
  }
  return rows.sort((a, b) =>
    a.contractLabel.localeCompare(b.contractLabel, "it") ||
    a.periodLabel.localeCompare(b.periodLabel),
  );
}

function allRemovableIds(findings: ContractCleanupFinding[]): string[] {
  return findings.flatMap((f) => f.removable.map((m) => m.id));
}

export function RecurringCleanupPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"idle" | "scanning" | "applying">("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const removableRows = useMemo(
    () => (preview ? flattenRemovable(preview.findings) : []),
    [preview],
  );
  const selectedCount = selectedIds.size;

  async function runPreview(): Promise<Preview | null> {
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setConfirmed(false);
    setPreview(null);
    setSelectedIds(new Set());

    const acc: Preview = { ...EMPTY, findings: [] };
    let cursor: string | null = null;

    try {
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
      setSelectedIds(new Set(allRemovableIds(acc.findings)));
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

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllRemovable(checked: boolean) {
    if (!preview) return;
    setSelectedIds(
      checked ? new Set(allRemovableIds(preview.findings)) : new Set(),
    );
  }

  async function handleApply() {
    if (!preview || !confirmed || selectedCount === 0) return;

    const monthIds = [...selectedIds];
    setPhase("applying");
    setError(null);
    setMessage(null);

    let deleted = 0;
    let done = 0;
    try {
      for (let i = 0; i < monthIds.length; i += APPLY_MONTH_CHUNK) {
        const chunk = monthIds.slice(i, i + APPLY_MONTH_CHUNK);
        const res = await applyRecurringCleanupAction({ monthIds: chunk });
        if (!res.ok) {
          setError(
            `${res.error} — rimosse ${deleted} rate su ${done} selezionate prima dell'errore.` +
              " Puoi rilanciare l'anteprima e riprendere.",
          );
          setPhase("idle");
          return;
        }
        deleted += res.deleted;
        done += chunk.length;
        setProgress(`Rimosse ${done}/${monthIds.length} rate…`);
      }

      setProgress(null);
      setPhase("idle");
      const after = await runPreview();
      setMessage(
        `Bonifica completata: ${deleted} rate rimosse su ${monthIds.length} selezionate.` +
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
  const withManual = preview?.findings.filter((f) => f.manual.length > 0) ?? [];
  const allSelected =
    preview != null &&
    preview.removableCount > 0 &&
    selectedCount === preview.removableCount;

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">
        4. Bonifica mesi ricorrenti fuori intervallo
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Rimuove le rate ricorrenti generate <strong>prima</strong> dell’inizio
        fornitura o <strong>dopo</strong> la chiusura del contratto. Il mese di
        ingresso e quello di chiusura restano sempre inclusi. Prima l’anteprima,
        poi scegli quali rate rimuovere e conferma. Le rate già incassate,
        pagate o segnalate non vengono mai toccate.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={runPreview} disabled={busy}>
          {phase === "scanning" ? "Anteprima in corso…" : "1. Anteprima (non modifica nulla)"}
        </Button>
        {preview && selectedCount > 0 ? (
          <Button
            type="button"
            variant="danger"
            onClick={handleApply}
            disabled={busy || !confirmed}
          >
            {phase === "applying"
              ? "Rimozione in corso…"
              : `2. Rimuovi ${selectedCount} rate selezionate`}
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

          {removableRows.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Seleziona le rate da rimuovere · {selectedCount} di{" "}
                  {preview.removableCount} selezionate
                </h3>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAllRemovable(e.target.checked)}
                    disabled={busy}
                    className="rounded border-slate-300"
                  />
                  Seleziona tutte
                </label>
              </div>
              <p className="mb-3 text-xs text-slate-500">
                Di default tutte le rate sono selezionate. Togli il segno a quelle
                che vuoi tenere.
              </p>
              <div
                className="overflow-auto"
                style={{ maxHeight: TABLE_MAX_HEIGHT }}
              >
                <table className="w-full min-w-[720px] text-left text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-2 py-2 w-10" />
                      <th className="px-2 py-2">Contratto</th>
                      <th className="px-2 py-2">Collaboratore</th>
                      <th className="px-2 py-2">Mese</th>
                      <th className="px-2 py-2">Motivo</th>
                      <th className="px-2 py-2">Stato</th>
                      <th className="px-2 py-2 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {removableRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-2 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            onChange={(e) => toggleRow(row.id, e.target.checked)}
                            disabled={busy}
                            className="rounded border-slate-300"
                            aria-label={`Rimuovere ${row.periodLabel} per ${row.contractLabel}`}
                          />
                        </td>
                        <td className="px-2 py-2 align-top text-slate-800">
                          {row.contractLabel}
                        </td>
                        <td className="px-2 py-2 align-top">{row.collaboratorName}</td>
                        <td className="px-2 py-2 align-top font-medium">
                          {row.periodLabel}
                        </td>
                        <td className="px-2 py-2 align-top text-xs">{row.reason}</td>
                        <td className="px-2 py-2 align-top text-xs">{row.status}</td>
                        <td className="px-2 py-2 align-top text-right text-xs">
                          {row.amount != null ? `${row.amount.toFixed(2)} €` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm text-amber-900">
                  <thead>
                    <tr className="border-b border-amber-200 text-xs uppercase text-amber-800">
                      <th className="px-2 py-2">Contratto</th>
                      <th className="px-2 py-2">Collaboratore</th>
                      <th className="px-2 py-2">Mese</th>
                      <th className="px-2 py-2">Motivo</th>
                      <th className="px-2 py-2">Stato</th>
                      <th className="px-2 py-2 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withManual
                      .flatMap((f) =>
                        f.manual.map((m) => ({
                          contractLabel: f.label,
                          collaboratorName: f.collaboratorName,
                          periodLabel: m.periodLabel,
                          reason: m.reason,
                          status:
                            RECURRING_STATUS_LABELS[
                              m.status as keyof typeof RECURRING_STATUS_LABELS
                            ] ?? m.status,
                          amount: m.amount,
                          key: m.id,
                        })),
                      )
                      .map((row) => (
                        <tr
                          key={row.key}
                          className="border-b border-amber-200/70 last:border-0"
                        >
                          <td className="px-2 py-2">{row.contractLabel}</td>
                          <td className="px-2 py-2">{row.collaboratorName}</td>
                          <td className="px-2 py-2 font-medium">{row.periodLabel}</td>
                          <td className="px-2 py-2 text-xs">{row.reason}</td>
                          <td className="px-2 py-2 text-xs">{row.status}</td>
                          <td className="px-2 py-2 text-right text-xs">
                            {row.amount != null ? `${row.amount.toFixed(2)} €` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {selectedCount > 0 ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
                className="mt-0.5 rounded border-slate-300"
              />
              Ho selezionato {selectedCount} rate e confermo la loro rimozione.
              L’operazione è ripetibile senza danni e resta registrata nel registro
              attività.
            </label>
          ) : preview.removableCount > 0 ? (
            <p className="text-sm text-slate-600">
              Nessuna rata selezionata: spunta almeno una riga per procedere alla
              rimozione.
            </p>
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
