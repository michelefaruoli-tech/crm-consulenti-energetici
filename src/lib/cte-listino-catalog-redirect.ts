import type { CteListinoKind } from "@/lib/cte-listino-detect";

/** Destinazione catalogo dopo «Aggiorna» listino: filtri dove le CTE risultano visibili. */
export type ListinoCatalogLanding = {
  categoria: "RESIDENZIALE" | "BUSINESS" | "CONDOMINI";
  utility: "LUCE" | "GAS";
  prezzo: "FISSO" | "VARIABILE";
  /** Filtro fornitore (contains, case-insensitive). Null = multi-fornitore (es. Compara). */
  fornitore: string | null;
};

export function listinoCatalogLanding(kind: CteListinoKind): ListinoCatalogLanding {
  switch (kind) {
    case "duferco-flex-condomini":
      return {
        categoria: "CONDOMINI",
        utility: "LUCE",
        prezzo: "VARIABILE",
        fornitore: "Duferco",
      };
    case "dolomiti":
      return {
        categoria: "RESIDENZIALE",
        utility: "LUCE",
        prezzo: "FISSO",
        fornitore: "Dolomiti",
      };
    case "enel-corporate":
      // Mix Enel + Soluzione Energia: niente filtro fornitore
      return {
        categoria: "BUSINESS",
        utility: "LUCE",
        prezzo: "FISSO",
        fornitore: null,
      };
    case "sev-iren":
      // LOCK&FIX / SUPER LUCE FIX sono FISSO residenziale sotto fornitore catalogo «Iren»
      // (brand SEV/Serviren). Le variabili (SUMMER, …) si vedono cambiando Tipologia.
      return {
        categoria: "RESIDENZIALE",
        utility: "LUCE",
        prezzo: "FISSO",
        fornitore: "Iren",
      };
    case "compara":
      return {
        categoria: "RESIDENZIALE",
        utility: "LUCE",
        prezzo: "FISSO",
        fornitore: null,
      };
  }
}

export function buildCatalogRedirectAfterListinoImport(opts: {
  kind: CteListinoKind;
  created: number;
  updated: number;
  deactivated?: number;
  label: string;
}): string {
  const landing = listinoCatalogLanding(opts.kind);
  const params = new URLSearchParams();
  params.set("categoria", landing.categoria);
  params.set("utility", landing.utility);
  params.set("prezzo", landing.prezzo);
  if (landing.fornitore) params.set("fornitore", landing.fornitore);
  params.set("importato", opts.kind);
  params.set("c", String(opts.created));
  params.set("u", String(opts.updated));
  if (opts.deactivated != null && opts.deactivated > 0) {
    params.set("d", String(opts.deactivated));
  }
  params.set("label", opts.label);
  return `/catalogo-cte?${params.toString()}`;
}
