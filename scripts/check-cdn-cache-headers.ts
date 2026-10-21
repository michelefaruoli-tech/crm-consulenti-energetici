/**
 * Guardrail: CAP pubblico + Cache-Control CDN; health 1 min; suppliers browser 5 min.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failures++;
  } else {
    console.log(`OK: ${label}`);
  }
}

const root = process.cwd();
const middleware = readFileSync(join(root, "src/middleware.ts"), "utf8");
const headersLib = readFileSync(join(root, "src/lib/cdn-cache-headers.ts"), "utf8");
const capRoute = readFileSync(join(root, "src/app/api/cap/[cap]/route.ts"), "utf8");
const cityRoute = readFileSync(join(root, "src/app/api/cap/city/route.ts"), "utf8");
const health = readFileSync(join(root, "src/app/api/health/route.ts"), "utf8");
const suppliers = readFileSync(
  join(root, "src/app/api/suppliers/search/route.ts"),
  "utf8",
);

check(
  "middleware espone /api/cap come path pubblico",
  middleware.includes('"/api/cap"'),
);
check(
  "CAP_CDN_CACHE_HEADERS ha s-maxage=86400 e Vercel-CDN-Cache-Control",
  headersLib.includes("s-maxage=86400") &&
    headersLib.includes("Vercel-CDN-Cache-Control") &&
    headersLib.includes("CAP_CDN_CACHE_HEADERS"),
);
check(
  "HEALTH_CDN_CACHE_HEADERS ha s-maxage=60",
  headersLib.includes("HEALTH_CDN_CACHE_HEADERS") &&
    headersLib.includes("s-maxage=60"),
);
check(
  "SUPPLIER_SEARCH_BROWSER_CACHE_HEADERS private max-age=300",
  headersLib.includes("private, max-age=300"),
);
check("cap/[cap] usa CAP_CDN_CACHE_HEADERS", capRoute.includes("CAP_CDN_CACHE_HEADERS"));
check("cap/city usa CAP_CDN_CACHE_HEADERS", cityRoute.includes("CAP_CDN_CACHE_HEADERS"));
check("health usa HEALTH_CDN_CACHE_HEADERS", health.includes("HEALTH_CDN_CACHE_HEADERS"));
check(
  "suppliers/search usa cache browser privata",
  suppliers.includes("SUPPLIER_SEARCH_BROWSER_CACHE_HEADERS") &&
    suppliers.includes("requireApiSession"),
);

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\nTutti i check CDN cache OK");
