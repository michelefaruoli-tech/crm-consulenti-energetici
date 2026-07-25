import Link from "next/link";
import { PAGE_SIZE, buildPageHref, pageCount } from "@/lib/pagination";

export function PaginationNav({
  path,
  page,
  total,
  pageSize = PAGE_SIZE,
  query = {},
  loadedCount,
}: {
  path: string;
  page: number;
  total: number;
  pageSize?: number;
  /** Altri parametri da preservare (vista, collab, …) — senza `page` */
  query?: Record<string, string | undefined | null>;
  /** Quante righe ha davvero restituito il server in questa pagina */
  loadedCount?: number;
}) {
  const pages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const shown =
    loadedCount != null ? loadedCount : total === 0 ? 0 : to - from + 1;

  function href(p: number) {
    return buildPageHref(path, {
      ...query,
      page: p <= 1 ? undefined : String(p),
    });
  }

  // Mostra al massimo ~7 numeri pagina intorno a quella corrente
  const window: number[] = [];
  const start = Math.max(1, current - 3);
  const end = Math.min(pages, current + 3);
  for (let i = start; i <= end; i++) window.push(i);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <p className="text-slate-600">
        Contratti{" "}
        <span className="font-medium text-slate-900">
          {total === 0 ? "0" : `${from}–${from + shown - 1}`}
        </span>{" "}
        di <span className="font-medium text-slate-900">{total}</span>
        {" · "}
        <span className="font-medium text-slate-900">{shown}</span> in questa pagina
        (max {pageSize})
        {pages > 1 ? (
          <>
            {" "}
            · pagina {current}/{pages}
          </>
        ) : null}
      </p>
      {pages > 1 ? (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Paginazione">
          <Link
            href={href(Math.max(1, current - 1))}
            className={`rounded-lg px-3 py-1.5 ${
              current <= 1
                ? "pointer-events-none text-slate-300"
                : "bg-slate-100 text-slate-800 hover:bg-slate-200"
            }`}
            aria-disabled={current <= 1}
          >
            ← Prec
          </Link>
          {start > 1 ? (
            <>
              <Link href={href(1)} className="rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-slate-100">
                1
              </Link>
              {start > 2 ? <span className="px-1 text-slate-400">…</span> : null}
            </>
          ) : null}
          {window.map((p) => (
            <Link
              key={p}
              href={href(p)}
              className={`rounded-lg px-2.5 py-1.5 ${
                p === current
                  ? "bg-emerald-600 font-medium text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {p}
            </Link>
          ))}
          {end < pages ? (
            <>
              {end < pages - 1 ? <span className="px-1 text-slate-400">…</span> : null}
              <Link
                href={href(pages)}
                className="rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-slate-100"
              >
                {pages}
              </Link>
            </>
          ) : null}
          <Link
            href={href(Math.min(pages, current + 1))}
            className={`rounded-lg px-3 py-1.5 ${
              current >= pages
                ? "pointer-events-none text-slate-300"
                : "bg-slate-100 text-slate-800 hover:bg-slate-200"
            }`}
            aria-disabled={current >= pages}
          >
            Succ →
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
