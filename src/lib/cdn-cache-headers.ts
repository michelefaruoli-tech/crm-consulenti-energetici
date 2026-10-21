/** Header cache per route GET a basso rischio (Hobby Fluid / CDN Vercel). */

export const CAP_CDN_CACHE_HEADERS = {
  // Lookup geografico statico: CDN 24h anche con cookie sessione.
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
  "Vercel-CDN-Cache-Control": "max-age=86400",
  "CDN-Cache-Control": "max-age=86400",
} as const;

export const HEALTH_CDN_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
  "Vercel-CDN-Cache-Control": "max-age=60",
  "CDN-Cache-Control": "max-age=60",
} as const;

/** Lista fornitori autenticata: solo browser, non CDN condivisa. */
export const SUPPLIER_SEARCH_BROWSER_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=300",
} as const;
