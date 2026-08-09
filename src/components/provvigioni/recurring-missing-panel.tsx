"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [collaboratorFilter, setCollaboratorFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
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
  const suppliers = [...new Set(alerts.map((a) => a.supplierName))].sort();
  const collaborators = [
    ...new Set(alerts.map((a) => a.collaboratorName).filter(Boolean) as string[]),
  ].sort();
  const normalizedQuery = query.trim().toLocaleLowerCase("it");
  const groups = [...byContract.entries()]
    .map(([contractId, months]) => ({
      contractId,
      months: [...months].sort((a, b) => a.period.localeCompare(b.period)),
      first: months[0]!,
    }))
    .filter(({ first }) =>
      (!normalizedQuery ||
        `${first.clientName} ${first.podPdr}`.toLocaleLowerCase("it").includes(normalizedQuery)) &&
      (!supplierFilter || first.supplierName === supplierFilter) &&
      (!collaboratorFilter || first.collaboratorName === collaboratorFilter),
    )
    .sort((a, b) => a.months[0]!.period.localeCompare(b.months[0]!.period));

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

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisibleCount(25); }}
          placeholder="Cerca cliente o POD/PDR"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={supplierFilter}
          onChange={(e) => { setSupplierFilter(e.target.value); setVisibleCount(25); }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Tutti i fornitori</option>
          {suppliers.map((supplier) => <option key={supplier}>{supplier}</option>)}
        </select>
        <select
          value={collaboratorFilter}
          onChange={(e) => { setCollaboratorFilter(e.target.value); setVisibleCount(25); }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Tutti i collaboratori</option>
          {collaborators.map((collaborator) => <option key={collaborator}>{collaborator}</option>)}
        </select>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {groups.slice(0, visibleCount).map(({ contractId, months, first }) => {
          const contractTotal = months.reduce((sum, month) => sum + (month.amount ?? 0), 0);
          return (
            <li
              key={contractId}
              className="rounded-xl border border-slate-200 bg-slate-50/70"
            >
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                  <Link
                    href={`/contratti/${contractId}`}
                    className="font-medium text-emerald-700 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {first.clientName}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {first.supplierName}
                    {first.collaboratorName ? ` · ${first.collaboratorName}` : ""}
                    {first.podPdr ? ` · ${first.podPdr}` : ""}
                  </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                    {months.length} {months.length === 1 ? "rata" : "rate"}
                  </span>
                  <span className="text-xs text-slate-600">da {periodLabel(months[0]!.period)}</span>
                  {contractTotal > 0 ? (
                    <span className="w-20 text-right text-xs font-semibold tabular-nums text-slate-800">
                      {contractTotal.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                    </span>
                  ) : null}
                  <span className="text-xs font-medium text-emerald-700">Mostra mesi ▾</span>
                </summary>
                <div className="flex flex-wrap gap-1.5 border-t border-slate-200 bg-white px-3 py-3">
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
              </details>
            </li>
          );
        })}
      </ul>
      {groups.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + 25)}
          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Mostra altri 25 · {groups.length - visibleCount} rimanenti
        </button>
      ) : null}
    </section>
  );
}
