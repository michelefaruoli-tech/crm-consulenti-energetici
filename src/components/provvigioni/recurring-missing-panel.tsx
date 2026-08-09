"use client";

import Link from "next/link";
import { updateRecurringMonthStatusAction } from "@/lib/recurring-actions";
import { periodLabel, toPeriod } from "@/lib/recurring";

export type MissingAlert = {
  id: string;
  period: string;
  contractId: string;
  podPdr: string;
  supplierName: string;
  clientName: string;
  collaboratorName?: string;
  amount?: number;
};

/**
 * Solo mesi già scaduti e non ancora incassati.
 * Incassato → passa alla lista «Pagato» sotto; Pagato → esce del tutto.
 */
export function RecurringMissingPanel({
  alerts,
  otherRecurringCount = 0,
  kind = "monthly",
}: {
  alerts: MissingAlert[];
  otherRecurringCount?: number;
  kind?: "monthly" | "annual" | "all";
}) {
  const settledPeriod = toPeriod(new Date());
  const titleKind =
    kind === "all"
      ? "Ricorrenze mensili e annuali"
      : kind === "annual"
        ? "Ricorrenti annuali"
        : "Ricorrenti mensili";

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        Nessun mese da incassare su {titleKind.toLowerCase()}
        {otherRecurringCount > 0
          ? ` (${otherRecurringCount} contratti in elenco, tutti già a posto).`
          : "."}
      </div>
    );
  }

  const byContract = new Map<string, MissingAlert[]>();
  for (const a of alerts) {
    const list = byContract.get(a.contractId) ?? [];
    list.push(a);
    byContract.set(a.contractId, list);
  }
  const totalAmount = alerts.reduce((sum, alert) => sum + (alert.amount ?? 0), 0);

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Ricorrenze ancora da incassare
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Solo rate scadute e non ancora ricevute dal fornitore.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-900">
            {alerts.length} {alerts.length === 1 ? "rata" : "rate"}
          </span>
          {totalAmount > 0 ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
              {totalAmount.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
            </span>
          ) : null}
        </div>
      </div>

      <ul className="mt-3 grid gap-2 text-sm lg:grid-cols-2">
        {[...byContract.entries()].map(([contractId, months]) => {
          const first = months[0]!;
          return (
            <li
              key={contractId}
              className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/contratti/${contractId}`}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    {first.clientName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {first.supplierName}
                    {first.collaboratorName ? ` · ${first.collaboratorName}` : ""}
                    {first.podPdr ? ` · ${first.podPdr}` : ""}
                  </p>
                </div>
                <div className="flex w-full flex-wrap gap-1.5">
                  {months.map((m) => (
                    <div
                      key={m.id}
                      className="inline-flex items-center overflow-hidden rounded-lg border border-amber-200 bg-amber-50"
                    >
                      <span className="px-2 py-1 text-[11px] font-semibold text-amber-950">
                        {periodLabel(m.period)}
                      </span>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <input type="hidden" name="settledPeriod" value={settledPeriod} />
                        <button
                          type="submit"
                          className="border-l border-amber-200 bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                          title="Fornitore ha pagato / lo segnalo come incassato"
                        >
                          Segna incassato
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
