"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
};

function defaultSettledOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(toPeriod(d));
  }
  return out;
}

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
  kind?: "monthly" | "annual";
}) {
  const settledOptions = useMemo(() => defaultSettledOptions(), []);
  const [settledPeriod, setSettledPeriod] = useState(
    settledOptions[0] ?? toPeriod(new Date()),
  );
  const titleKind =
    kind === "annual" ? "Ricorrenti annuali" : "Ricorrenti mensili";

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

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <h2 className="text-base font-semibold text-amber-950">
        {titleKind}: da incassare ({alerts.length} mesi)
      </h2>
      <p className="mt-1 text-xs text-amber-900/80">
        Qui vedi <strong>solo</strong> i mesi che dovevano già essere pagati dal fornitore e
        non lo sono. Clicca <strong>Incassato</strong> quando li segnali / li ricevi; poi in
        basso potrai segnare <strong>Pagato</strong> (liquidazione collaboratore) e la riga
        sparisce.
      </p>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-950">
        <span className="font-medium">Mese rendiconto fornitore:</span>
        <select
          className="rounded border border-amber-300 bg-white px-2 py-1"
          value={settledPeriod}
          onChange={(e) => setSettledPeriod(e.target.value)}
        >
          {settledOptions.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
        {[...byContract.entries()].map(([contractId, months]) => {
          const first = months[0]!;
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
                    {first.collaboratorName ? ` · ${first.collaboratorName}` : ""}
                    {first.podPdr ? ` · ${first.podPdr}` : ""}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-1.5 sm:w-auto">
                  {months.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-end gap-1"
                    >
                      <span className="mr-auto text-[11px] font-medium text-amber-900 sm:mr-2">
                        {periodLabel(m.period)} · da incassare
                      </span>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <input type="hidden" name="settledPeriod" value={settledPeriod} />
                        <button
                          type="submit"
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-700"
                          title="Fornitore ha pagato / lo segnalo come incassato"
                        >
                          Incassato
                        </button>
                      </form>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="LIQUIDATED" />
                        <input type="hidden" name="settledPeriod" value={settledPeriod} />
                        <button
                          type="submit"
                          className="rounded bg-teal-700 px-2 py-0.5 text-[11px] text-white hover:bg-teal-800"
                          title="Incassato e già liquidato al collaboratore → esce dalla lista"
                        >
                          Incassato + Pagato
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
