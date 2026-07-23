"use client";

import Link from "next/link";
import { updateRecurringMonthStatusAction } from "@/lib/recurring-actions";
import { periodLabel } from "@/lib/recurring";

export type MissingAlert = {
  id: string;
  period: string;
  contractId: string;
  podPdr: string;
  supplierName: string;
  clientName: string;
};

export function RecurringMissingPanel({ alerts }: { alerts: MissingAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        Nessun mese mancante sulle ricorrenze mensili.
      </div>
    );
  }

  const byContract = new Map<string, MissingAlert[]>();
  for (const a of alerts) {
    const list = byContract.get(a.contractId) ?? [];
    list.push(a);
    byContract.set(a.contractId, list);
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <h2 className="text-base font-semibold text-amber-950">
        Ricorrenze: mesi non pagati ({alerts.length})
      </h2>
      <p className="mt-1 text-xs text-amber-900/80">
        Se manca un mese (es. mar 2026), resta segnalato anche dopo. Puoi segnarlo Pagato, Chiuso
        oppure Non pagato (errore).
      </p>
      <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
        {[...byContract.entries()].map(([contractId, months]) => {
          const first = months[0];
          return (
            <li
              key={contractId}
              className="rounded-lg border border-amber-200 bg-white px-3 py-2"
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
                    {first.podPdr ? ` · ${first.podPdr}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-amber-800">
                    Mancanti: {months.map((m) => periodLabel(m.period)).join(", ")}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {months.slice(0, 4).map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-slate-600">{periodLabel(m.period)}</span>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <button
                          type="submit"
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white"
                        >
                          Pagato
                        </button>
                      </form>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="CLOSED" />
                        <button
                          type="submit"
                          className="rounded bg-slate-600 px-2 py-0.5 text-[11px] text-white"
                        >
                          Chiuso
                        </button>
                      </form>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="ERROR_UNPAID" />
                        <button
                          type="submit"
                          className="rounded bg-red-700 px-2 py-0.5 text-[11px] text-white"
                        >
                          Errore
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
