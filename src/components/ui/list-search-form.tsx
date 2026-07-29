import Link from "next/link";
import { Button } from "@/components/ui/button";

type Hidden = Record<string, string | undefined | null>;

/**
 * Barra «Cerca cliente» per le pagine con liste lunghe.
 * Form GET: mantiene gli altri filtri come campi hidden.
 */
export function ListSearchForm({
  action,
  q,
  placeholder = "Cerca cliente, CF, P.IVA, POD o n. contratto…",
  hidden = {},
  clearHref,
}: {
  action: string;
  q?: string | null;
  placeholder?: string;
  /** Parametri da preservare (vista, collab, settled, …) — senza `q` e `page` */
  hidden?: Hidden;
  /** Link «Pulisci» (stessa pagina senza q). Se assente, costruito da action + hidden. */
  clearHref?: string;
}) {
  const clear =
    clearHref ??
    (() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(hidden)) {
        if (v) params.set(k, v);
      }
      const qs = params.toString();
      return qs ? `${action}?${qs}` : action;
    })();

  return (
    <form className="flex flex-wrap gap-2" action={action} method="get">
      {Object.entries(hidden).map(([name, value]) =>
        value ? (
          <input key={name} type="hidden" name={name} value={value} />
        ) : null,
      )}
      <input
        name="q"
        defaultValue={q ?? ""}
        placeholder={placeholder}
        autoComplete="off"
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 sm:min-w-[16rem] sm:py-2 sm:text-sm"
      />
      <Button type="submit" variant="secondary">
        Cerca
      </Button>
      {q?.trim() ? (
        <Link
          href={clear}
          className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Pulisci
        </Link>
      ) : null}
    </form>
  );
}
