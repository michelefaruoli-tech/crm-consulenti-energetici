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
  const [settledPeriod, setSettledPeriod] = useState(settledOptions[0] ?? toPeriod(new Date()));
  const titleKind =
    kind === "annual" ? "Ricorrenti annuali (12 mesi)" : "Ricorrenti mensili";

  if (alerts.length === 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Nessuna competenza in ritardo su {titleKind.toLowerCase()}.
        </div>
        {otherRecurringCount > 0 ? (
          <p className="text-xs text-slate-600">
            Hai comunque <strong>{otherRecurringCount}</strong> contratti in elenco senza mesi
            ancora da incassare.
          </p>
        ) : null}
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
        {titleKind}: da incassare ({alerts.length})
      </h2>
      <p className="mt-1 text-xs text-amber-900/80">
        {kind === "annual" ? (
          <>
            Scadenze a <strong>12 mesi</strong> dall&apos;ultimo pagamento ricevuto (o
            dall&apos;ingresso in fornitura se non c&apos;è ancora un pagamento). Segna{" "}
            <strong>Incassato</strong> quando il fornitore paga; poi usa il pannello sotto per{" "}
            <strong>Pagato</strong> (liquidazione collaboratore).
          </>
        ) : (
          <>
            Mesi di competenza già scaduti e non incassati. Quando segni{" "}
            <strong>Incassato</strong>, scegli il mese del rendiconto fornitore. Poi in lista
            «da liquidare» puoi segnare <strong>Pagato</strong> e togliere la riga.
          </>
        )}
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
                    {first.collaboratorName ? ` · ${first.collaboratorName}` : ""}
                    {first.podPdr ? ` · ${first.podPdr}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-amber-800">
                    Competenze: {months.map((m) => periodLabel(m.period)).join(", ")}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {months.slice(0, 6).map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-slate-600">
                        {periodLabel(m.period)}
                      </span>
                      <form action={updateRecurringMonthStatusAction}>
                        <input type="hidden" name="recurringMonthId" value={m.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <input type="hidden" name="settledPeriod" value={settledPeriod} />
                        <button
                          type="submit"
                          className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white"
                        >
                          Incassato
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
