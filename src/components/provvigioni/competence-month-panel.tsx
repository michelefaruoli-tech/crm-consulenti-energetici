"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import type { CompetenceMonthStats } from "@/lib/provvigioni-competence";

function buildHref(
  base: Record<string, string | undefined>,
  extra: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...extra };
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  return `/provvigioni?${params.toString()}`;
}

export function CompetenceMonthPanel({
  stats,
  monthOptions,
  queryBase,
  activeStato,
}: {
  stats: CompetenceMonthStats;
  monthOptions: string[];
  queryBase: Record<string, string | undefined>;
  activeStato?: string;
}) {
  const period = stats.period;

  function chipClass(active: boolean, color: "slate" | "emerald" | "amber" | "indigo") {
    const colors = {
      slate: active
        ? "bg-slate-800 text-white border-slate-800"
        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
      emerald: active
        ? "bg-emerald-700 text-white border-emerald-700"
        : "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100",
      amber: active
        ? "bg-amber-700 text-white border-amber-700"
        : "bg-amber-50 text-amber-950 border-amber-200 hover:bg-amber-100",
      indigo: active
        ? "bg-indigo-700 text-white border-indigo-700"
        : "bg-indigo-50 text-indigo-950 border-indigo-200 hover:bg-indigo-100",
    };
    return `rounded-lg border px-3 py-1.5 text-sm font-medium transition ${colors[color]}`;
  }

  const isAll = !activeStato || activeStato === "Tutti";
  const isIncassato = activeStato === "Incassato";
  const isDaIncassare = activeStato === "Da incassare";
  const isPagato = activeStato === "Pagato";

  return (
    <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">Mese di competenza</h2>
          <p className="mt-1 text-sm text-slate-600">
            Rate del mese selezionato: incassate dal fornitore o ancora da incassare.
          </p>
        </div>
        <label className="text-sm text-slate-600">
          <span className="mr-2 font-medium">Competenza:</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold"
            value={period}
            onChange={(e) => {
              window.location.href = buildHref(queryBase, {
                competence: e.target.value,
                stato: activeStato && activeStato !== "Tutti" ? activeStato : null,
              });
            }}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Rate totali mese</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{stats.totalRates}</p>
          <p className="text-xs text-slate-500">{stats.contractCount} contratti</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700">Incassate (PAID)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">{stats.paidCount}</p>
          <p className="text-sm font-semibold text-emerald-800">
            {formatCurrency(stats.paidAmount)}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">Da incassare</p>
          <p className="mt-1 text-2xl font-bold text-amber-950">{stats.missingCount}</p>
          <p className="text-sm font-semibold text-amber-800">
            {formatCurrency(stats.missingAmount)}
          </p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs font-medium text-indigo-700">Liquidate ai collab.</p>
          <p className="mt-1 text-2xl font-bold text-indigo-900">{stats.liquidatedCount}</p>
          <p className="text-sm font-semibold text-indigo-800">
            {formatCurrency(stats.liquidatedAmount)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={buildHref(queryBase, { competence: period, stato: null })}
          className={chipClass(isAll, "slate")}
        >
          Tutte ({stats.totalRates})
        </Link>
        <Link
          href={buildHref(queryBase, { competence: period, stato: "Incassato" })}
          className={chipClass(isIncassato, "emerald")}
        >
          Incassate ({stats.paidCount}) · {formatCurrency(stats.paidAmount)}
        </Link>
        <Link
          href={buildHref(queryBase, { competence: period, stato: "Da incassare" })}
          className={chipClass(isDaIncassare, "amber")}
        >
          Da incassare ({stats.missingCount}) · {formatCurrency(stats.missingAmount)}
        </Link>
        <Link
          href={buildHref(queryBase, { competence: period, stato: "Pagato" })}
          className={chipClass(isPagato, "indigo")}
        >
          Pagate collab. ({stats.liquidatedCount})
        </Link>
      </div>
    </section>
  );
}
