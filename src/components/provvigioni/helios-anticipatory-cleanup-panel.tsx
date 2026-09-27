"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyHeliosAnticipatoryAction,
  scanHeliosAnticipatoryAction,
} from "@/lib/helios-anticipatory-actions";
import type { HeliosAnticipatoryRow } from "@/lib/helios-anticipatory-cleanup";
import { RECURRING_STATUS_LABELS } from "@/lib/recurring";
import { friendlyActionError } from "@/lib/friendly-client-error";
import { HELIOS_ANTICIPATORY_APPLY_BATCH } from "@/lib/helios-anticipatory-cleanup";

const TABLE_MAX_HEIGHT = "28rem";

type Preview = {
  rows: HeliosAnticipatoryRow[];
  lastPayableCompetence: string;
  lastPayableLabel: string;
};

const EMPTY: Preview = {
  rows: [],
  lastPayableCompetence: "",
  lastPayableLabel: "",
};

export function HeliosAnticipatoryCleanupPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"idle" | "scanning" | "applying">("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const sortedRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    return [...rows].sort(
      (a, b) =>
        a.period.localeCompare(b.period) ||
        a.contractLabel.localeCompare(b.contractLabel, "it"),
    );
  }, [preview]);

  const allIds = useMemo(() => sortedRows.map((r) => r.id), [sortedRows]);

  async function runScan() {
    setPhase("scanning");
    setError(null);
    setMessage(null);
    setConfirmed(false);
    setProgress("Anteprima in corso…");
    try {
      const all: HeliosAnticipatoryRow[] = [];
      let cursor: string | null = null;
      let lastPayable = "";
      let lastLabel = "";
      let guard = 0;
      do {
        const res = await scanHeliosAnticipatoryAction({ cursor });
        if (!res.ok) {
          setError(res.error);
          setPreview(null);
          setSelectedIds(new Set());
          return;
        }
        all.push(...res.rows);
        lastPayable = res.lastPayableCompetence;
        lastLabel = res.lastPayableLabel;
        cursor = res.nextCursor;
        setProgress(
          `Anteprima: ${all.length} rate anticipate (fino a competenza ${lastLabel})…`,
        );
        guard += 1;
      } while (cursor && guard < 50);

      const next: Preview = {
        rows: all,
        lastPayableCompetence: lastPayable,
        lastPayableLabel: lastLabel,
      };
      setPreview(next);
      setSelectedIds(new Set(all.map((r) => r.id)));
      setMessage(
        all.length === 0
          ? `Nessuna rata Helios oltre ${lastLabel}: ok.`
          : `Trovate ${all.length} rate Helios con competenza > ${lastLabel}. Controlla e conferma prima di applicare.`,
      );
    } catch (e) {
      setError(friendlyActionError(e));
      setPreview(null);
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function runApply() {
    if (!preview || selectedIds.size === 0 || !confirmed) return;
    setPhase("applying");
    setError(null);
    setMessage(null);
    const ids = [...selectedIds];
    let closed = 0;
    let deleted = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ids.length; i += HELIOS_ANTICIPATORY_APPLY_BATCH) {
        const chunk = ids.slice(i, i + HELIOS_ANTICIPATORY_APPLY_BATCH);
        setProgress(
          `Applicazione ${Math.min(i + chunk.length, ids.length)}/${ids.length}…`,
        );
        const res = await applyHeliosAnticipatoryAction({ monthIds: chunk });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        closed += res.closed;
        deleted += res.deleted;
        skipped += res.skipped;
      }
      setMessage(
        `Bonifica completata: ${closed} chiuse (lag M+2), ${deleted} eliminate` +
          (skipped > 0 ? `, ${skipped} saltate` : "") +
          `. Competenze fino a ${preview.lastPayableLabel} non toccate.`,
      );
      setPreview(EMPTY);
      setSelectedIds(new Set());
      setConfirmed(false);
    } catch (e) {
      setError(friendlyActionError(e));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelectedIds(on ? new Set(allIds) : new Set());
  }

  const busy = phase !== "idle";

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Trova rate Helios con <strong>mese riferimento (competenza)</strong>{" "}
        oltre l&apos;ultima pagabile (calendario − 2 mesi). A settembre non
        devono esistere agosto né settembre: vanno chiuse o eliminate. Luglio e
        precedenti restano intatti. Percorso: Anteprima → conferma → Applica.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={runScan} disabled={busy}>
          {phase === "scanning" ? "Anteprima in corso…" : "1. Anteprima (non modifica nulla)"}
        </Button>
      </div>

      {progress ? (
        <p className="text-sm text-slate-500" role="status">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p>
      ) : null}

      {preview && preview.rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              Ultima competenza legittima oggi:{" "}
              <strong>{preview.lastPayableLabel}</strong> (
              <code className="text-xs">{preview.lastPayableCompetence}</code>)
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => toggleAll(true)}
                disabled={busy}
              >
                Seleziona tutte
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => toggleAll(false)}
                disabled={busy}
              >
                Deseleziona
              </Button>
            </div>
          </div>

          <div
            className="overflow-auto rounded-lg border border-slate-200"
            style={{ maxHeight: TABLE_MAX_HEIGHT }}
          >
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-2 py-2">Sel.</th>
                  <th className="px-2 py-2">Contratto</th>
                  <th className="px-2 py-2">Collaboratore</th>
                  <th className="px-2 py-2">Mese rif.</th>
                  <th className="px-2 py-2">Stato</th>
                  <th className="px-2 py-2">Incasso</th>
                  <th className="px-2 py-2">Azione</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={busy}
                        aria-label={`Seleziona ${row.periodLabel} per ${row.contractLabel}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium">{row.contractLabel}</td>
                    <td className="px-2 py-1.5">{row.collaboratorName}</td>
                    <td className="px-2 py-1.5">{row.periodLabel}</td>
                    <td className="px-2 py-1.5">
                      {RECURRING_STATUS_LABELS[
                        row.status as keyof typeof RECURRING_STATUS_LABELS
                      ] ?? row.status}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">
                      {row.settledPeriod ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {row.suggestedAction === "delete" ? "Elimina" : "Chiudi (lag)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />
            <span>
              Confermo di chiudere/eliminare le{" "}
              <strong>{selectedIds.size}</strong> rate Helios selezionate con
              competenza successiva a {preview.lastPayableLabel}. Non vengono
              toccate le competenze fino a quel mese.
            </span>
          </label>

          <Button
            type="button"
            onClick={runApply}
            disabled={busy || !confirmed || selectedIds.size === 0}
          >
            {phase === "applying"
              ? "Applicazione…"
              : `2. Applica (${selectedIds.size})`}
          </Button>
        </>
      ) : null}
    </div>
  );
}
