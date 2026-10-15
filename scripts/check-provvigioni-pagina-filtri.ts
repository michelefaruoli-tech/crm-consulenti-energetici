/**
 * Cambio pagina in Provvigioni: fornitore e mese di riferimento restano insieme.
 * Vale per ogni fornitore e ogni mese, e non toglie l'ordinamento Nominativo.
 *
 * Uso: npx tsx scripts/check-provvigioni-pagina-filtri.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildColumnFilterWhere,
  parseProvvigioniColumnFilters,
  provvigioniPageQuery,
} from "../src/lib/provvigioni-column-filters";
import { buildPageHref } from "../src/lib/pagination";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

function pageHref(
  page: number,
  search: Record<string, string | undefined>,
  base: Record<string, string | undefined | null>,
): URLSearchParams {
  const filters = parseProvvigioniColumnFilters(search);
  const query = provvigioniPageQuery(base, filters);
  const href = buildPageHref("/provvigioni", {
    ...query,
    page: page <= 1 ? undefined : String(page),
  });
  return new URLSearchParams(href.split("?")[1] ?? "");
}

const heliosSettembre = {
  supplier: "Helios",
  settled: "2026-10",
  competence: "tutti",
  sort: "client",
  dir: "asc",
  storno: "fuori_storno",
};

console.log("\n• Helios + settembre: la pagina 2 tiene fornitore, mese e Nominativo");
{
  const qs = pageHref(2, { mese: "2026-09" }, heliosSettembre);
  check("fornitore", qs.get("supplier"), "Helios");
  check("mese riferimento", qs.get("mese"), "2026-09");
  check("ordinamento", qs.get("sort"), "client");
  check("verso", qs.get("dir"), "asc");
  check("storno di stato", qs.get("storno"), "fuori_storno");
  check("pagina", qs.get("page"), "2");
}

console.log("\n• Pagina 1: stessi filtri, senza ?page");
{
  const qs = pageHref(1, { mese: "2026-09" }, heliosSettembre);
  check("fornitore", qs.get("supplier"), "Helios");
  check("mese", qs.get("mese"), "2026-09");
  check("niente page", qs.get("page"), null);
  check("Nominativo ancora acceso", qs.get("sort"), "client");
}

console.log("\n• Altri fornitori e altri mesi");
{
  const enel = pageHref(
    3,
    { mese: "2026-03" },
    { supplier: "Enel", competence: "tutti", sort: undefined, dir: undefined },
  );
  check("Enel", enel.get("supplier"), "Enel");
  check("marzo", enel.get("mese"), "2026-03");
  check("pagina 3", enel.get("page"), "3");
  check("senza Nominativo non inventa sort", enel.get("sort"), null);

  const iren = pageHref(
    2,
    { mese: "2025-12|2026-01" },
    { supplier: "Iren", sort: "client", dir: "desc" },
  );
  check("Iren", iren.get("supplier"), "Iren");
  check("due mesi", iren.get("mese"), "2025-12|2026-01");
  check("Z→A resta", iren.get("dir"), "desc");

  const dolomiti = pageHref(
    2,
    { mese: "settembre 2026" },
    { supplier: "Dolomiti" },
  );
  check("Dolomiti", dolomiti.get("supplier"), "Dolomiti");
  check("etichetta settembre conservata", dolomiti.get("mese"), "settembre 2026");
}

console.log("\n• Senza mese di riferimento non compare il parametro");
{
  const qs = pageHref(2, {}, { supplier: "Helios", sort: "client", dir: "asc" });
  check("Helios", qs.get("supplier"), "Helios");
  check("niente mese", qs.get("mese"), null);
  check("sort", qs.get("sort"), "client");
}

console.log("\n• Anche gli altri filtri di colonna restano (gettone)");
{
  const qs = pageHref(
    2,
    { mese: "2026-08", gettone: "120" },
    { supplier: "Sorgenia" },
  );
  check("Sorgenia", qs.get("supplier"), "Sorgenia");
  check("agosto", qs.get("mese"), "2026-08");
  check("gettone", qs.get("gettone"), "120");
}

console.log("\n• Il mese in URL restringe le rate, non solo la prima pagina");
{
  const where = buildColumnFilterWhere(
    parseProvvigioniColumnFilters({ mese: "2026-09" }),
    { suppliers: [], operationTypes: [] },
    { expanded: true },
  );
  check("esclude le righe senza rata", where.excludeUnitRows, true);
  check(
    "periodo settembre",
    where.rate.some(
      (clause) =>
        "period" in clause &&
        clause.period != null &&
        typeof clause.period === "object" &&
        "in" in clause.period &&
        JSON.stringify(clause.period.in) === JSON.stringify(["2026-09"]),
    ),
    true,
  );

  const labeled = buildColumnFilterWhere(
    parseProvvigioniColumnFilters({ mese: "settembre 2026" }),
    { suppliers: [], operationTypes: [] },
    { expanded: true },
  );
  check(
    "settembre 2026 → 2026-09",
    labeled.rate.some(
      (clause) =>
        "period" in clause &&
        clause.period != null &&
        typeof clause.period === "object" &&
        "in" in clause.period &&
        JSON.stringify(clause.period.in) === JSON.stringify(["2026-09"]),
    ),
    true,
  );
}

console.log("\n• La pagina passa questa query a entrambi i pager");
const pageSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/provvigioni/page.tsx"),
  "utf8",
);
check(
  "queryBase include i filtri colonna",
  pageSrc.includes("const queryBase = provvigioniPageQuery("),
  true,
);
check(
  "Nominativo resta negli argomenti",
  pageSrc.includes('sort: sortByClient ? "client" : undefined'),
  true,
);
check(
  "due PaginationNav con la stessa query",
  pageSrc.match(/query=\{queryBase\}/g)?.length ?? 0,
  2,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check falliti (filtri al cambio pagina)`);
  process.exit(1);
}
console.log("\n✅ Filtri Provvigioni al cambio pagina: tutte le verifiche superate.");
