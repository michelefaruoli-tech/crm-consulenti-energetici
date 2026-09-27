/**
 * P1.2 B4 — filtri rapidi stato storno.
 * Uso: npx tsx scripts/check-storno-filters.ts
 *
 * Verifica parse/URL, where Prisma e coerenza con badge B1.
 * Nessuna scrittura DB.
 */
import {
  andStornoStatusWhere,
  buildStornoStatusWhere,
  formatStornoStatusFilters,
  fuoriStornoFilterWhere,
  inStornoWhere,
  mergeLegacyFuoriStornoFocus,
  parseStornoStatusFilters,
  stornoFilterAllowsHistorical,
  stornoFilterNeedsDoppiaIds,
  stornoInScadenzaWhere,
  STORNO_FILTER_IDS,
  stornatoFilterWhere,
  toggleStornoStatusFilter,
} from "../src/lib/storno-filters";
import { STORNO_BADGE_DEFS } from "../src/lib/storno-badges";
import { STORNO_WARNING_DAYS } from "../src/lib/storno-status";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Id filtri = badge B1");
check(
  "stessi 6 id",
  STORNO_FILTER_IDS,
  [
    "in_storno",
    "storno_in_scadenza",
    "fuori_storno",
    "doppia_posizione",
    "storico",
    "stornato",
  ],
);
for (const id of STORNO_FILTER_IDS) {
  check(`label ${id}`, STORNO_BADGE_DEFS[id]?.label != null, true);
}

console.log("\n• Parse / format URL");
check(
  "parse multi",
  parseStornoStatusFilters("in_storno|storico|fuori_storno"),
  ["in_storno", "storico", "fuori_storno"],
);
check(
  "alias in-scadenza",
  parseStornoStatusFilters("in-scadenza"),
  ["storno_in_scadenza"],
);
check(
  "alias pod-ricontrattualizzato",
  parseStornoStatusFilters("pod_ricontrattualizzato"),
  ["storico"],
);
check("ignora sconosciuti", parseStornoStatusFilters("foo|in_storno"), [
  "in_storno",
]);
check(
  "format ordine canonico",
  formatStornoStatusFilters(["storico", "in_storno"]),
  "in_storno|storico",
);
check(
  "toggle add",
  toggleStornoStatusFilter(["in_storno"], "storico"),
  ["in_storno", "storico"],
);
check(
  "toggle remove",
  toggleStornoStatusFilter(["in_storno", "storico"], "in_storno"),
  ["storico"],
);

console.log("\n• Legacy focus=fuori-storno");
check(
  "merge legacy",
  mergeLegacyFuoriStornoFocus([], "fuori-storno"),
  ["fuori_storno"],
);
check(
  "merge no dup",
  mergeLegacyFuoriStornoFocus(["fuori_storno"], "fuori-storno"),
  ["fuori_storno"],
);

console.log("\n• Flags");
check(
  "needs doppia",
  stornoFilterNeedsDoppiaIds(["doppia_posizione"]),
  true,
);
check(
  "allows historical",
  stornoFilterAllowsHistorical(["storico", "in_storno"]),
  true,
);
check(
  "no historical",
  stornoFilterAllowsHistorical(["in_storno"]),
  false,
);

console.log("\n• Where Prisma (now dal caller)");
const now = new Date("2026-09-27T12:00:00.000Z");
const inStorno = inStornoWhere(now);
const inScad = stornoInScadenzaWhere(now);
const fuori = fuoriStornoFilterWhere(now);
const stornato = stornatoFilterWhere();

const inSer = JSON.stringify(inStorno);
const scadSer = JSON.stringify(inScad);
const fuoriSer = JSON.stringify(fuori);

check("in_storno usa stornoEndDate", inSer.includes("stornoEndDate"), true);
check(
  "in_scadenza usa stornoEndDate",
  scadSer.includes("stornoEndDate"),
  true,
);
check("fuori usa stornoMonths 0", fuoriSer.includes("stornoMonths"), true);
check("warning days", STORNO_WARNING_DAYS, 30);
check(
  "stornato OR status/commission",
  JSON.stringify(stornato).includes("STORNATO") &&
    JSON.stringify(stornato).includes("stornoDate"),
  true,
);

const combined = buildStornoStatusWhere(
  ["in_storno", "stornato"],
  { now, doppiaIds: [] },
);
check("combinati → OR", Boolean(combined && "OR" in combined), true);

const anded = andStornoStatusWhere(
  { deletedAt: null },
  buildStornoStatusWhere(["storico"], { now }),
);
check("AND base+storno", Boolean(anded && "AND" in anded), true);

const empty = buildStornoStatusWhere([], { now });
check("nessun filtro → undefined", empty, undefined);

console.log(
  failures === 0
    ? "\n✅ check-storno-filters OK\n"
    : `\n❌ check-storno-filters: ${failures} fallimenti\n`,
);
process.exit(failures === 0 ? 0 : 1);
