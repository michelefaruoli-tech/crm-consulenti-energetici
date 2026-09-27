import Link from "next/link";
import { buildPageHref } from "@/lib/pagination";
import {
  STORNO_FILTER_OPTIONS,
  formatStornoStatusFilters,
  toggleStornoStatusFilter,
} from "@/lib/storno-filters";
import {
  STORNO_BADGE_DEFS,
  type StornoBadgeId,
} from "@/lib/storno-badges";

/**
 * Chip filtri rapidi stato storno (P1.2 B4).
 * Link GET → URL condivisibile; multipli con OR (`storno=a|b`).
 */
export function StornoStatusFilters({
  path,
  selected,
  queryBase = {},
  className = "",
}: {
  path: string;
  selected: StornoBadgeId[];
  /** Altri parametri da preservare (vista, collab, q, …) — senza `page` / `storno`. */
  queryBase?: Record<string, string | undefined | null>;
  className?: string;
}) {
  function hrefFor(next: StornoBadgeId[]): string {
    return buildPageHref(path, {
      ...queryBase,
      storno: formatStornoStatusFilters(next),
      page: undefined,
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-sm ${className}`}
      role="group"
      aria-label="Filtri stato storno"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Stato storno
      </span>
      {STORNO_FILTER_OPTIONS.map((opt) => {
        const active = selected.includes(opt.id);
        const next = toggleStornoStatusFilter(selected, opt.id);
        const def = STORNO_BADGE_DEFS[opt.id];
        return (
          <Link
            key={opt.id}
            href={hrefFor(next)}
            className={
              active
                ? `rounded-lg px-3 py-1.5 font-medium ${def.className}`
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-700 hover:bg-slate-200"
            }
            title={
              active
                ? `Rimuovi filtro «${opt.label}»`
                : `Filtra «${opt.label}» (combinabile)`
            }
          >
            {opt.label}
          </Link>
        );
      })}
      {selected.length > 0 ? (
        <Link
          href={hrefFor([])}
          className="rounded-lg px-2 py-1.5 text-xs text-slate-600 underline-offset-2 hover:underline"
        >
          Azzera storno
        </Link>
      ) : null}
    </div>
  );
}
