import Link from "next/link";
import { buildPageHref } from "@/lib/pagination";
import { DASHBOARD_MIN_YEAR, MONTH_LABELS_IT } from "@/lib/dashboard-aggregates";

/**
 * Sezione "Contratti inseriti per mese — <anno>": 12 mesi Gen→Dic sempre
 * visibili insieme (niente tendina), mese corrente in evidenza, mesi futuri
 * sfumati. Il cambio-anno (‹ ›) serve solo per guardare anni passati.
 */
export function DashboardMonthlyBreakdown({
  year,
  counts,
  currentYear,
  currentMonthIndex,
  path = "/",
  minYear = DASHBOARD_MIN_YEAR,
}: {
  year: number;
  /** 12 valori, indice 0 = Gennaio */
  counts: number[];
  currentYear: number;
  currentMonthIndex: number;
  path?: string;
  minYear?: number;
}) {
  const isCurrentYear = year === currentYear;
  const max = Math.max(1, ...counts);
  const prevYear = year - 1;
  const nextYear = year + 1;
  const canGoPrev = prevYear >= minYear;
  const canGoNext = nextYear <= currentYear;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">
          Contratti inseriti per mese — {year}
        </h2>
        <nav
          className="flex items-center gap-1 text-sm"
          aria-label="Cambia anno"
        >
          <Link
            href={buildPageHref(path, {
              anno: canGoPrev ? String(prevYear) : undefined,
            })}
            aria-disabled={!canGoPrev}
            className={`rounded-lg px-2 py-1 font-medium ${
              canGoPrev
                ? "text-emerald-700 hover:bg-emerald-50"
                : "pointer-events-none text-slate-300"
            }`}
          >
            ‹ {prevYear}
          </Link>
          <span className="px-1 font-semibold text-slate-900">{year}</span>
          <Link
            href={buildPageHref(path, {
              anno: canGoNext ? String(nextYear) : undefined,
            })}
            aria-disabled={!canGoNext}
            className={`rounded-lg px-2 py-1 font-medium ${
              canGoNext
                ? "text-emerald-700 hover:bg-emerald-50"
                : "pointer-events-none text-slate-300"
            }`}
          >
            {nextYear} ›
          </Link>
        </nav>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12">
        {MONTH_LABELS_IT.map((label, i) => {
          const count = counts[i] ?? 0;
          const isCurrent = isCurrentYear && i === currentMonthIndex;
          const isFuture = isCurrentYear && i > currentMonthIndex;
          const barPct = count > 0 ? Math.max(8, Math.round((count / max) * 100)) : 0;

          return (
            <div
              key={label}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center ${
                isCurrent
                  ? "border-emerald-300 bg-emerald-50"
                  : isFuture
                    ? "border-slate-100 bg-slate-50 opacity-50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  isCurrent ? "text-emerald-700" : "text-slate-500"
                }`}
              >
                {label}
              </span>
              <span
                className={`text-xl font-bold tabular-nums ${
                  isCurrent ? "text-emerald-900" : "text-slate-900"
                }`}
              >
                {count}
              </span>
              <span
                className="h-1 w-full overflow-hidden rounded-full bg-slate-100"
                aria-hidden
              >
                <span
                  className={`block h-full rounded-full ${
                    isCurrent ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
