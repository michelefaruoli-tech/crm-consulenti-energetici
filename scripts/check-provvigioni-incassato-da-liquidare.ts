/**
 * P1.1 B2 — vista first-class «Incassato da liquidare».
 * Uso: npx tsx scripts/check-provvigioni-incassato-da-liquidare.ts
 */
import {
  buildProvvigioniListWhere,
  effectiveStatoForList,
  isIncassatoDaLiquidareFocus,
  parseProvvigioniFocus,
  provvigioneStatoWhere,
} from "../src/lib/provvigioni-filters";
import { getRecurringExpandMode } from "../src/lib/provvigioni-rows";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Parse focus B2");
check(
  "parse incassato-da-liquidare",
  parseProvvigioniFocus("incassato-da-liquidare"),
  "incassato-da-liquidare",
);
check("parse sconosciuto", parseProvvigioniFocus("altro"), undefined);
check(
  "isIncassatoDaLiquidareFocus",
  isIncassatoDaLiquidareFocus("incassato-da-liquidare"),
  true,
);
check(
  "non confondere da-confermare",
  isIncassatoDaLiquidareFocus("da-confermare"),
  false,
);

console.log("\n• Stato effettivo (focus ⇒ Incassato, senza confondere Da/Liquidato)");
check(
  "focus solo → Incassato",
  effectiveStatoForList(undefined, "incassato-da-liquidare"),
  "Incassato",
);
check(
  "stato URL vince sul focus",
  effectiveStatoForList("Da incassare", "incassato-da-liquidare"),
  "Da incassare",
);
check(
  "senza focus resta undefined",
  effectiveStatoForList(undefined, undefined),
  undefined,
);
check(
  "Liquidato non implicato dal focus",
  effectiveStatoForList(undefined, "incassato-da-liquidare") === "Pagato",
  false,
);

console.log("\n• Expand mode = coda PAID (Helios lag non nasconde PAID)");
check(
  "expand da focus effettivo",
  getRecurringExpandMode(
    effectiveStatoForList(undefined, "incassato-da-liquidare"),
    true,
    undefined,
  ),
  "incassato",
);
check(
  "expand Da incassare distinto",
  getRecurringExpandMode("Da incassare", true, undefined),
  "da-incassare",
);
check(
  "expand Liquidato/Pagato distinto",
  getRecurringExpandMode("Pagato", true, undefined),
  "pagato",
);

console.log("\n• Where focus ≡ where stato=Incassato (e ≠ Liquidato / Da incassare)");
const baseFilters = {
  canViewAll: true,
  sessionUserId: "user-test",
  visibility: { deletedAt: null },
};
const whereFocus = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "incassato-da-liquidare",
});
const whereStato = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Incassato" },
});
const whereAlias = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Incassato da liquidare" },
});
const wherePagato = provvigioneStatoWhere("Pagato");
const whereDaIncassare = provvigioneStatoWhere("Da incassare");

check(
  "focus ≡ stato=Incassato",
  JSON.stringify(whereFocus) === JSON.stringify(whereStato),
  true,
);
check(
  "focus ≡ alias Incassato da liquidare",
  JSON.stringify(whereFocus) === JSON.stringify(whereAlias),
  true,
);
check(
  "focus ≠ Liquidato/Pagato",
  JSON.stringify(whereFocus) === JSON.stringify(wherePagato),
  false,
);
check(
  "focus ≠ Da incassare",
  JSON.stringify(whereFocus) === JSON.stringify(whereDaIncassare),
  false,
);

const whereFocusPlusStato = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Incassato" },
  focus: "incassato-da-liquidare",
});
check(
  "focus+stato non doppia clausola (≡ solo stato)",
  JSON.stringify(whereFocusPlusStato) === JSON.stringify(whereStato),
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B2 Incassato da liquidare fallite.`);
  process.exit(1);
}
console.log("\n✅ Vista Incassato da liquidare (B2): ok.");
