import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import type { ProvvigioniFinancialSummary } from "@/lib/provvigioni-summary";

function buildHref(
  base: Record<string, string | undefined>,
  stato: string,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v) params.set(k, v);
  }
  params.set("stato", stato);
  return `/provvigioni?${params.toString()}`;
}

export function ProvvigioniSummaryCards({
  summary,
  competencePeriod,
  competenceAll,
  queryBase,
  contractCount,
}: {
  summary: ProvvigioniFinancialSummary;
  competencePeriod: string | null;
  competenceAll: boolean;
  queryBase: Record<string, string | undefined>;
  contractCount: number;
}) {
  const periodHint =
    competenceAll || !competencePeriod
      ? "tutti i periodi"
      : periodLabel(competencePeriod);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contratti in elenco
        </p>
        <p className="mt-2 text-3xl font-bold text-slate-900">{contractCount}</p>
        <p className="mt-1 text-xs text-slate-500">Con filtri attivi</p>
      </div>

      <Link
        href={buildHref(queryBase, "Incassato")}
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Incassato
        </p>
        <p className="mt-1 text-xs text-emerald-700/80">
          Dal fornitore · da liquidare · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-emerald-900">
          {summary.incassatoCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-emerald-800">
          {formatCurrency(summary.incassatoAmount)}
        </p>
      </Link>

      <Link
        href={buildHref(queryBase, "Da incassare")}
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Da incassare
        </p>
        <p className="mt-1 text-xs text-amber-700/80">
          In attesa dal fornitore · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-amber-950">
          {summary.daIncassareCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-amber-800">
          {formatCurrency(summary.daIncassareAmount)}
        </p>
      </Link>

      <Link
        href={buildHref(queryBase, "Pagato")}
        className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
          Pagato
        </p>
        <p className="mt-1 text-xs text-indigo-700/80">
          Liquidato al collaboratore · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-indigo-900">
          {summary.pagatoCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-indigo-800">
          {formatCurrency(summary.pagatoAmount)}
        </p>
      </Link>
    </div>
  );
}
