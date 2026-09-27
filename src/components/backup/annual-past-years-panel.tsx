"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyAnnualPastYearsAction,
  runAnnualPastYearsAutoAction,
  scanAnnualPastYearsAction,
} from "@/lib/annual-past-years-actions";
import type { AnnualPastYearsRow } from "@/lib/annual-past-years-shared";
import { ANNUAL_PAST_YEARS_APPLY_BATCH } from "@/lib/annual-past-years-shared";
import { friendlyActionError } from "@/lib/friendly-client-error";

const TABLE_MAX_HEIGHT = "28rem";

type Preview = {
  rows: AnnualPastYearsRow[];
  openFrom: string;
  openFromLabel: string;
  openKept: number;
};

export function AnnualPastYearsCleanupPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<
    "idle" | "scanning" | "applying" | "auto"
  >("idle");
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
      const all: AnnualPastYearsRow[] = [];
      let cursor: string | null = null;
      let openFrom = "";
      let openFromLabel = "";
      let openKept = 0;
      let guard = 0;
      do {
        const res = await scanAnnualPastYearsAction({ cursor });
        if (!res.ok) {
          setError(res.error);
          setPreview(null);
          setSelectedIds(new Set());
          return;
        }
        all.push(...res.rows);
        openFrom = res.openFrom;
        openFromLabel = res.openFromLabel;
        openKept = res.openKept;
        cursor = res.nextCursor;
        setProgress(
          `Anteprima: ${all.length} da liquidare (aperte ≥ ${openFromLabel}: ${openKept})…`,
        );
        guard += 1;
      } while (cursor && guard < 50);

      setPreview({ rows: all, openFrom, openFromLabel, openKept });
      setSelectedIds(new Set(all.map((r) => r.id)));
      setMessage(
        all.length === 0
          ? `Niente da bonificare. Rate 2026+ ancora aperte: ${openKept}.`
          : `Trovate ${all.length} righe pre-${openFrom.slice(0, 4)} da liquidare. Rate 2026+ aperte: ${openKept}.`,
      );
    } catch (e) {
      setError(friendlyActionError(e));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function runAuto() {
    setPhase("auto");
    setError(null);
    setMessage(null);
    setProgress("Bonifica automatica in corso…");
    try {
      let totalMonths = 0;
      let totalContracts = 0;
      let openKept = 0;
      let guard = 0;
      let done = false;
      do {
        const res = await runAnnualPastYearsAutoAction();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        totalMonths += res.monthsLiquidated;
        totalContracts += res.contractsLiquidated;
        openKept = res.openKept;
        done = res.done !== false;
        setProgress(
          `Liquidate rate ${totalMonths}, contratti ${totalContracts}…`,
        );
        guard += 1;
        if (res.monthsLiquidated + res.contractsLiquidated === 0) done = true;
      } while (!done && guard < 30);

      setMessage(
        `Bonifica completata: ${totalMonths} rate e ${totalContracts} gettoni liquidati. Rate 2026+ ancora aperte: ${openKept}.`,
      );
      setPreview(null);
      setSelectedIds(new Set());
      setConfirmed(false);
    } catch (e) {
      setError(friendlyActionError(e));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  async function runApplySelected() {
    if (!preview || selectedIds.size === 0) return;
    setPhase("applying");
    setError(null);
    setMessage(null);
    try {
      const ids = [...selectedIds];
      let months = 0;
      let contracts = 0;
      let openKept = preview.openKept;
      for (let i = 0; i < ids.length; i += ANNUAL_PAST_YEARS_APPLY_BATCH) {
        const chunk = ids.slice(i, i + ANNUAL_PAST_YEARS_APPLY_BATCH);
        setProgress(
          `Applico ${Math.min(i + chunk.length, ids.length)}/${ids.length}…`,
        );
        const res = await applyAnnualPastYearsAction({ targetIds: chunk });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        months += res.monthsLiquidated;
        contracts += res.contractsLiquidated;
        openKept = res.openKept;
      }
      setMessage(
        `Applicate: ${months} rate e ${contracts} gettoni liquidati. Rate 2026+ aperte: ${openKept}.`,
      );
      setPreview(null);
      setSelectedIds(new Set());
      setConfirmed(false);
    } catch (e) {
      setError(friendlyActionError(e));
    } finally {
      setPhase("idle");
      setProgress(null);
    }
  }

  const busy = phase !== "idle";

  return (
    <section
      id="annuali-anni-passati"
      className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        Bonifica annuali — anni passati
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Rate e gettoni con ricorrenza annuale (R) e competenza prima del 2026
        vengono segnati come <strong>liquidati</strong> (ciclo completo). Restano
        aperte solo le righe 2026+ («Da incassare» / già incassate o liquidate).
        Non tocca Helios mensili. Idempotente: si può rilanciare senza danni.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={runAuto} disabled={busy}>
          {phase === "auto" ? "Bonifica…" : "Sistema direttamente (auto)"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={runScan}
          disabled={busy}
        >
          {phase === "scanning" ? "Anteprima…" : "Solo anteprima"}
        </Button>
      </div>

      {progress ? (
        <p className="mt-2 text-sm text-slate-600">{progress}</p>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

      {preview && preview.rows.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.size === allIds.length && allIds.length > 0}
                onChange={(e) => {
                  setSelectedIds(
                    e.target.checked ? new Set(allIds) : new Set(),
                  );
                }}
              />
              Seleziona tutte ({selectedIds.size}/{allIds.length})
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confermo la liquidazione delle selezionate
            </label>
            <Button
              type="button"
              disabled={busy || !confirmed || selectedIds.size === 0}
              onClick={runApplySelected}
            >
              {phase === "applying"
                ? "Applico…"
                : `Applica ${selectedIds.size} selezionate`}
            </Button>
          </div>

          <div
            className="overflow-auto rounded-lg border border-slate-200 bg-white"
            style={{ maxHeight: TABLE_MAX_HEIGHT }}
          >
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-2" />
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Collaboratore</th>
                  <th className="p-2">Contratto</th>
                  <th className="p-2">Fornitore</th>
                  <th className="p-2">Competenza</th>
                  <th className="p-2">Stato</th>
                  <th className="p-2">Importo</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      {r.kind === "month" ? "Rata" : "Gettone"}
                    </td>
                    <td className="p-2">{r.collaboratorName}</td>
                    <td className="p-2">{r.contractLabel}</td>
                    <td className="p-2">{r.supplierName}</td>
                    <td className="p-2">{r.periodLabel}</td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2">
                      {r.amount != null ? `€ ${r.amount.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
