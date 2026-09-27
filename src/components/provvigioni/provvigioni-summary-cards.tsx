import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import type { ProvvigioniFinancialSummary } from "@/lib/provvigioni-summary";

/**
 * Card bucket-specific (B2/B3) → focus first-class.
 * Altre card: filtro stato/vista; rimuovono focus bucket per non AND-are
 * bucket incompatibili.
 */
function stripBucketFocus(
  base: Record<string, string | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (!v) continue;
    if (
      k === "focus" &&
      (v === "incassato-da-liquidare" || v === "ut-da-incassare")
    ) {
      continue;
    }
    if (k === "stato") continue;
    params.set(k, v);
  }
  return params;
}

function buildStatoHref(
  base: Record<string, string | undefined>,
  stato: string,
  extra?: Record<string, string | undefined>,
): string {
  const params = stripBucketFocus(base);
  params.set("stato", stato);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (!v) {
        params.delete(k);
        continue;
      }
      params.set(k, v);
    }
  }
  return `/provvigioni?${params.toString()}`;
}

function buildFocusHref(
  base: Record<string, string | undefined>,
  focus: "incassato-da-liquidare" | "ut-da-incassare",
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (!v) continue;
    if (k === "stato" || k === "focus" || k === "vista") continue;
    params.set(k, v);
  }
  params.set("focus", focus);
  return `/provvigioni?${params.toString()}`;
}

export function ProvvigioniSummaryCards({
  summary,
  competencePeriod,
  competenceAll,
  queryBase,
  contractCount,
  activeFocus,
  activeStato,
  activeVista,
}: {
  summary: ProvvigioniFinancialSummary;
  competencePeriod: string | null;
  competenceAll: boolean;
  queryBase: Record<string, string | undefined>;
  contractCount: number;
  activeFocus?: string | null;
  activeStato?: string | null;
  activeVista?: string | null;
}) {
  const periodHint =
    competenceAll || !competencePeriod
      ? "tutti i periodi"
      : periodLabel(competencePeriod);

  const incassatoActive =
    activeFocus === "incassato-da-liquidare" ||
    activeStato === "Incassato" ||
    activeStato === "Incassato da liquidare";
  const utDaIncassareActive = activeFocus === "ut-da-incassare";
  const mDaIncassareActive =
    activeStato === "Da incassare" &&
    activeVista === "mensile" &&
    !activeFocus;
  const rDaIncassareActive =
    activeStato === "Da incassare" &&
    activeVista === "annuale" &&
    !activeFocus;
  const liquidatoActive =
    activeStato === "Liquidato" || activeStato === "Pagato";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contratti in elenco
        </p>
        <p className="mt-2 text-3xl font-bold text-slate-900">{contractCount}</p>
        <p className="mt-1 text-xs text-slate-500">Con filtri attivi</p>
      </div>

      <Link
        href={buildFocusHref(queryBase, "ut-da-incassare")}
        aria-current={utDaIncassareActive ? "page" : undefined}
        className={`rounded-xl border p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md ${
          utDaIncassareActive
            ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Da incassare UT
        </p>
        <p className="mt-1 text-xs text-amber-700/80">
          Una tantum · non ancora dal fornitore · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-amber-950">
          {summary.daIncassareUtCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-amber-800">
          {formatCurrency(summary.daIncassareUtAmount)}
        </p>
      </Link>

      <Link
        href={buildStatoHref(queryBase, "Da incassare", { vista: "mensile" })}
        aria-current={mDaIncassareActive ? "page" : undefined}
        className={`rounded-xl border p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md ${
          mDaIncassareActive
            ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Da incassare M
        </p>
        <p className="mt-1 text-xs text-amber-700/80">
          Rate mensili · totale separato da UT · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-amber-950">
          {summary.daIncassareMCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-amber-800">
          {formatCurrency(summary.daIncassareMAmount)}
        </p>
      </Link>

      <Link
        href={buildStatoHref(queryBase, "Da incassare", { vista: "annuale" })}
        aria-current={rDaIncassareActive ? "page" : undefined}
        className={`rounded-xl border p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md ${
          rDaIncassareActive
            ? "border-amber-500 bg-amber-100 ring-2 ring-amber-400"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Da incassare R
        </p>
        <p className="mt-1 text-xs text-amber-700/80">
          Annuali · 13° mese · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-amber-950">
          {summary.daIncassareRCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-amber-800">
          {formatCurrency(summary.daIncassareRAmount)}
        </p>
      </Link>

      <Link
        href={buildFocusHref(queryBase, "incassato-da-liquidare")}
        aria-current={incassatoActive ? "page" : undefined}
        className={`rounded-xl border p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md ${
          incassatoActive
            ? "border-emerald-500 bg-emerald-100 ring-2 ring-emerald-400"
            : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Incassato da liquidare
        </p>
        <p className="mt-1 text-xs text-emerald-700/80">
          Incassato dal fornitore · non ancora liquidato · {periodHint}
        </p>
        <p className="mt-2 text-3xl font-bold text-emerald-900">
          {summary.incassatoCount}
        </p>
        <p className="mt-1 text-sm font-semibold text-emerald-800">
          {formatCurrency(summary.incassatoAmount)}
        </p>
      </Link>

      <Link
        href={buildStatoHref(queryBase, "Liquidato")}
        aria-current={liquidatoActive ? "page" : undefined}
        className={`rounded-xl border p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md ${
          liquidatoActive
            ? "border-indigo-500 bg-indigo-100 ring-2 ring-indigo-400"
            : "border-indigo-200 bg-indigo-50"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
          Liquidato
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
