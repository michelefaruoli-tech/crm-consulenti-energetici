/** Schede principali Provvigioni (3 tab). */
export type ProvvigioniVistaTab = "tutti" | "mensile" | "annuale";

/**
 * Href scheda Tutti / M / R.
 * Non eredita `vista` da queryBase: da M/R la card Tutti deve tornare
 * all'elenco completo (senza vista=mensile|annuale), altrimenti l'href
 * resta uguale alla pagina corrente e sembra non cliccabile.
 */
export function buildVistaTabHref(
  vista: ProvvigioniVistaTab,
  base: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (!v || k === "vista") continue;
    params.set(k, v);
  }
  if (vista !== "tutti") params.set("vista", vista);
  return `/provvigioni?${params.toString()}`;
}
