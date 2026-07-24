/** Dimensione pagina elenchi (Contratti, Provvigioni, Dashboard). */
export const PAGE_SIZE = 100;

export function parsePage(raw: string | undefined | null): number {
  const n = Number.parseInt(String(raw ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

export function pageSkip(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

/** Costruisce URL con query params (salta valori vuoti). */
export function buildPageHref(
  path: string,
  params: Record<string, string | undefined | null>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
