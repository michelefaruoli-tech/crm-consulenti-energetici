"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  applyAnomaliesBulkAction,
  previewAnomaliesBulkAction,
} from "@/lib/anomalies-bulk-actions";
import type { AnomalyBulkPreviewRow } from "@/lib/anomalies-bulk";
import { friendlyActionError } from "@/lib/friendly-client-error";

const DECISION_LABEL: Record<AnomalyBulkPreviewRow["decision"], string> = {
  delete_before_start: "Elimina (prima inizio fornitura)",
  mark_paid: "Segna incassata",
  skip: "Salta",
};

/**
 * Bonifica massiva delle segnalazioni Anomalie (rate mancanti + assenti Helios):
 * Anteprima → conferma → Applica.
 */
export function AnomaliesBulkPanel({ monthIds }: { monthIds: string[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying">("idle");
  const [preview, setPreview] = useState<{
    rows: AnomalyBulkPreviewRow[];
    deleteCount: number;
    markPaidCount: number;
    skipCount: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [applyDetails, setApplyDetails] = useState<
    Array<{ period: string; outcome: string; motivo?: string }>
  >([]);

  if (monthIds.length === 0) return null;

  async function runPreview() {
    setPhase("previewing");
    setError(null);
    setMessage(null);
    setApplyDetails([]);
    setConfirmed(false);
    setPreview(null);
    try {
      const res = await previewAnomaliesBulkAction({ monthIds });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setPreview({
        rows: res.rows,
        deleteCount: res.deleteCount,
        markPaidCount: res.markPaidCount,
        skipCount: res.skipCount,
      });
      setPhase("idle");
    } catch (e) {
      setError(friendlyActionError(e));
      setPhase("idle");
    }
  }

  async function runApply() {
    if (!preview || !confirmed) return;
    setPhase("applying");
    setError(null);
    setMessage(null);
    try {
      const res = await applyAnomaliesBulkAction({ monthIds });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setMessage(
        `Esito: ${res.deleted} eliminate, ${res.markedPaid} segnate incassate, ${res.skipped} saltate.`,
      );
      setApplyDetails(
        res.rowResults.map((r) => ({
          period: r.period,
          outcome: r.outcome,
          motivo: r.motivo,
        })),
      );
      setPreview(null);
      setConfirmed(false);
      setPhase("idle");
      router.refresh();
    } catch (e) {
      setError(friendlyActionError(e));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">
        Bonifica anomalie (Anteprima → Applica)
      </h3>
      <p className="mt-1 text-xs text-slate-600">
        Sulle {monthIds.length} segnalazioni aperte: elimina le rate con
        competenza <strong>prima dell&apos;inizio fornitura</strong>; segna{" "}
        <strong>incassate</strong> quelle ancora da incassare ma corrette
        (dentro l&apos;intervallo). Nessuna scrittura senza conferma.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={runPreview} disabled={busy}>
          {phase === "previewing" ? "Anteprima in corso…" : "1. Anteprima classificazione"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <p>{message}</p>
          {applyDetails.length > 0 ? (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-emerald-900">
              {applyDetails.slice(0, 80).map((row, i) => (
                <li key={`${row.period}-${i}`}>
                  {row.period}: <strong>{row.outcome}</strong>
                  {row.motivo ? ` — ${row.motivo}` : ""}
                </li>
              ))}
              {applyDetails.length > 80 ? (
                <li className="text-emerald-700">
                  + altre {applyDetails.length - 80} righe
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat
              value={preview.deleteCount}
              label="Da eliminare (prima inizio)"
              tone="text-red-700"
            />
            <Stat
              value={preview.markPaidCount}
              label="Da segnare incassate"
              tone="text-emerald-700"
            />
            <Stat value={preview.skipCount} label="Saltate / già a posto" />
          </div>

          <div className="max-h-56 overflow-auto rounded border border-slate-100">
            {preview.rows.slice(0, 200).map((row) => (
              <div
                key={row.monthId}
                className="border-b border-slate-100 px-3 py-2 text-xs last:border-0"
              >
                <p className="font-medium text-slate-900">
                  {row.clientLabel} · {row.periodLabel}
                </p>
                <p className="text-slate-500">
                  {DECISION_LABEL[row.decision]}
                  {row.motivo ? ` — ${row.motivo}` : ""}
                  {row.status !== "—" ? ` · stato ${row.status}` : ""}
                </p>
              </div>
            ))}
            {preview.rows.length > 200 ? (
              <p className="px-3 py-2 text-xs text-slate-400">
                + altre {preview.rows.length - 200} righe
              </p>
            ) : null}
          </div>

          {(preview.deleteCount > 0 || preview.markPaidCount > 0) && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />
                Ho controllato l&apos;anteprima: confermo l&apos;eliminazione delle{" "}
                {preview.deleteCount} rate prima dell&apos;inizio fornitura e di
                segnare incassate le {preview.markPaidCount} rate corrette.
              </label>
              <Button type="button" onClick={runApply} disabled={busy || !confirmed}>
                {phase === "applying" ? "Applicazione in corso…" : "2. Applica"}
              </Button>
            </div>
          )}
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
