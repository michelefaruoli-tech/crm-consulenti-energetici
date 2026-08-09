"use client";

import Link from "next/link";
import { updateRecurringMonthStatusAction } from "@/lib/recurring-actions";
import { periodLabel } from "@/lib/recurring";

export type ToLiquidateAlert = {
  id: string;
  period: string;
  settledPeriod: string | null;
  contractId: string;
  podPdr: string;
  supplierName: string;
  clientName: string;
  collaboratorName?: string;
  amount?: number;
};

/**
 * Rate già Incassate: qui segni Pagato e la riga scompare.
 * Se la lista è vuota non mostriamo nulla (niente box grigio inutile).
 */
export function RecurringToLiquidatePanel({
  alerts,
  kind = "monthly",
}: {
  alerts: ToLiquidateAlert[];
  kind?: "monthly" | "annual" | "all";
}) {
  if (alerts.length === 0) return null;

  const titleKind =
    kind === "all"
      ? "Ricorrenze mensili e annuali"
      : kind === "annual"
        ? "Ricorrenti annuali"
        : "Ricorrenti mensili";

  return (
    <section className="rounded-xl border border-sky-300 bg-sky-50 p-4 shadow-sm">
      <h2 className="text-base font-semibold text-sky-950">
        {titleKind}: già incassati → segna Pagato ({alerts.length})
      </h2>
      <p className="mt-1 text-xs text-sky-900/80">
        Questi mesi sono <strong>Incassato</strong> (fornitore ok). Clicca{" "}
        <strong>Pagato</strong> quando hai liquidato il collaboratore: la riga viene{" "}
        <strong>eliminata</strong> da questa lista. Sotto in tabella resta la data
        dell&apos;ultimo mese pagato.
      </p>

      <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
        {alerts.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2"
          >
            <div>
              <Link
                href={`/contratti/${a.contractId}`}
                className="font-medium text-emerald-700 hover:underline"
              >
                {a.clientName}
              </Link>
              <p className="text-xs text-slate-500">
                {a.supplierName}
                {a.collaboratorName ? ` · ${a.collaboratorName}` : ""}
                {a.podPdr ? ` · ${a.podPdr}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-sky-900">
                Competenza {periodLabel(a.period)}
                {a.settledPeriod
                  ? ` · rendiconto ${periodLabel(a.settledPeriod)}`
                  : ""}
                {a.amount != null ? ` · € ${a.amount}` : ""}
                {" · stato: Incassato"}
              </p>
            </div>
            <form action={updateRecurringMonthStatusAction}>
              <input type="hidden" name="recurringMonthId" value={a.id} />
              <input type="hidden" name="status" value="LIQUIDATED" />
              <button
                type="submit"
                className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
              >
                Pagato
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
