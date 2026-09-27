/**
 * P1.2 B5 — KPI / alert storno Dashboard (ponte P1.3).
 * Uso: npx tsx scripts/check-storno-dashboard-kpi.ts
 *
 * Verifica deep-link, periodo opzionale, scope where e coerenza id B4.
 * Nessuna scrittura DB.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildStornoDashboardScopeWhere,
  buildStornoKpiCards,
  insertionPeriodWhere,
  resolveOptionalDashboardPeriod,
  stornoDashboardListHref,
  stornoDatePeriodWhere,
  STORNO_FILTER_IDS,
  STORNO_WARNING_DAYS,
} from "../src/lib/storno-dashboard-kpi";
import { STORNO_BADGE_DEFS } from "../src/lib/storno-badges";
import { formatStornoStatusFilters } from "../src/lib/storno-filters";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Id KPI = filtri B4 / badge B1");
check("stessi 6 id", STORNO_FILTER_IDS, [
  "in_storno",
  "storno_in_scadenza",
  "fuori_storno",
  "doppia_posizione",
  "storico",
  "stornato",
]);
check("warning days = 30", STORNO_WARNING_DAYS, 30);

console.log("\n• Periodo opzionale (no default mese corrente)");
check(
  "vuoto → null",
  resolveOptionalDashboardPeriod({}),
  null,
);
check(
  "solo month",
  resolveOptionalDashboardPeriod({ month: "2026-08" }),
  { from: "2026-08-01", to: "2026-08-31", months: ["2026-08"] },
);
check(
  "from/to",
  resolveOptionalDashboardPeriod({ from: "2026-01-01", to: "2026-01-15" }),
  { from: "2026-01-01", to: "2026-01-15", months: [] },
);

const period = resolveOptionalDashboardPeriod({ month: "2026-08" })!;
const insWhere = insertionPeriodWhere(period);
check(
  "insertion where ha insertionDate",
  JSON.stringify(insWhere).includes("insertionDate"),
  true,
);
const stornoWhere = stornoDatePeriodWhere(period);
check(
  "stornoDate where ha commission.stornoDate",
  JSON.stringify(stornoWhere).includes("stornoDate"),
  true,
);

console.log("\n• Deep-link ?storno=");
check(
  "in scadenza → contratti attivi",
  stornoDashboardListHref({ storno: "storno_in_scadenza" }),
  `/contratti?vista=attivi&storno=${encodeURIComponent("storno_in_scadenza")}`,
);
check(
  "storico → vista storico",
  stornoDashboardListHref({ storno: "storico" }),
  `/contratti?vista=storico&storno=${encodeURIComponent("storico")}`,
);
check(
  "stornato → provvigioni",
  stornoDashboardListHref({ storno: "stornato" }),
  `/provvigioni?storno=${encodeURIComponent("stornato")}`,
);
check(
  "con collab",
  stornoDashboardListHref({
    storno: "in_storno",
    collab: "user_1",
  }),
  `/contratti?vista=attivi&storno=${encodeURIComponent("in_storno")}&collab=user_1`,
);
check(
  "stornato + supplier nome",
  stornoDashboardListHref({
    storno: "stornato",
    supplierName: "Enel",
  }),
  `/provvigioni?storno=${encodeURIComponent("stornato")}&supplier=Enel`,
);

console.log("\n• Card KPI da conteggi");
const cards = buildStornoKpiCards(
  {
    in_storno: 1,
    storno_in_scadenza: 2,
    fuori_storno: 3,
    doppia_posizione: 4,
    storico: 5,
    stornato: 6,
  },
  {},
);
check("6 card", cards.length, 6);
check("label in scadenza", cards[1]?.label, STORNO_BADGE_DEFS.storno_in_scadenza.label);
check(
  "href fuori storno",
  cards[2]?.href.includes(formatStornoStatusFilters(["fuori_storno"])!),
  true,
);

console.log("\n• Scope where (visibility + collab + supplier)");
const scope = buildStornoDashboardScopeWhere({
  visibility: { collaboratorId: "u1" },
  collab: "u2",
  supplierIds: ["s1"],
});
const scopeJson = JSON.stringify(scope);
check("include deletedAt null", scopeJson.includes('"deletedAt":null'), true);
check("include supplierId", scopeJson.includes("supplierId"), true);
check("include collab filtro", scopeJson.includes("u2"), true);

console.log("\n• Wiring Dashboard / package.json");
const page = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/page.tsx"),
  "utf8",
);
check("page importa StornoDashboardSection", page.includes("StornoDashboardSection"), true);
check("page usa loadStornoDashboardKpis", page.includes("loadStornoDashboardKpis"), true);
check(
  "page wiring alert/card storno (P1.3: storni anche in operativa)",
  page.includes("loadStornoDashboardAlerts") && page.includes("buildStornoKpiCards"),
  true,
);
const operativaLib = readFileSync(
  join(process.cwd(), "src/lib/dashboard-operativa.ts"),
  "utf8",
);
check(
  "operativa riusa stornoDashboardListHref",
  operativaLib.includes("stornoDashboardListHref"),
  true,
);

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };
check(
  "check include storno-dashboard-kpi",
  pkg.scripts.check?.includes("check-storno-dashboard-kpi.ts") ?? false,
  true,
);
check(
  "nessun marker package.json",
  !JSON.stringify(pkg).includes("CURSOR_AGENT") &&
    !JSON.stringify(pkg).includes("__MERGE_"),
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B5 KPI storno fallite.`);
  process.exit(1);
}
console.log("\n✅ KPI / alert storno Dashboard (B5): ok.");
