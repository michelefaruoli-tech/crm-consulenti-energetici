/**
 * P1.1 B3 — vista «Una tantum da incassare» + totali UT/M/R separati.
 * Uso: npx tsx scripts/check-provvigioni-ut-da-incassare.ts
 */
import {
  buildProvvigioniListWhere,
  effectiveStatoForList,
  isBucketSpecificFocus,
  isIncassatoDaLiquidareFocus,
  isUtDaIncassareFocus,
  nonRecurringWhere,
  parseProvvigioniFocus,
  provvigioneStatoWhere,
  recurringMonthlyWhereOr,
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

console.log("\n• Parse focus B3");
check(
  "parse ut-da-incassare",
  parseProvvigioniFocus("ut-da-incassare"),
  "ut-da-incassare",
);
check("parse sconosciuto", parseProvvigioniFocus("altro"), undefined);
check("isUtDaIncassareFocus", isUtDaIncassareFocus("ut-da-incassare"), true);
check(
  "non confondere B2",
  isUtDaIncassareFocus("incassato-da-liquidare"),
  false,
);
check(
  "bucket-specific B2+B3",
  isBucketSpecificFocus("ut-da-incassare") &&
    isBucketSpecificFocus("incassato-da-liquidare") &&
    !isBucketSpecificFocus("da-confermare"),
  true,
);

console.log("\n• Stato effettivo (focus ⇒ Da incassare, senza confondere Incassato/Liquidato)");
check(
  "focus solo → Da incassare",
  effectiveStatoForList(undefined, "ut-da-incassare"),
  "Da incassare",
);
check(
  "stato URL vince sul focus",
  effectiveStatoForList("Incassato", "ut-da-incassare"),
  "Incassato",
);
check(
  "B2 resta Incassato",
  effectiveStatoForList(undefined, "incassato-da-liquidare"),
  "Incassato",
);
check(
  "Liquidato non implicato",
  effectiveStatoForList(undefined, "ut-da-incassare") === "Pagato",
  false,
);

console.log("\n• Expand mode = Da incassare (Helios lag vale; PAID non c’entrano)");
check(
  "expand da focus B3",
  getRecurringExpandMode(
    effectiveStatoForList(undefined, "ut-da-incassare"),
    true,
    undefined,
  ),
  "da-incassare",
);
check(
  "expand B2 distinto",
  getRecurringExpandMode(
    effectiveStatoForList(undefined, "incassato-da-liquidare"),
    true,
    undefined,
  ),
  "incassato",
);

console.log("\n• Where focus ≡ UT + Da incassare (≠ M, ≠ Incassato, ≠ Liquidato)");
const baseFilters = {
  canViewAll: true,
  sessionUserId: "user-test",
  visibility: { deletedAt: null },
};
const whereFocus = buildProvvigioniListWhere({
  filters: baseFilters,
  focus: "ut-da-incassare",
});
const whereUtDaIncassare = buildProvvigioniListWhere({
  filters: {
    ...baseFilters,
    stato: "Da incassare",
    recurrenceMode: "exclude",
  },
});
const whereDaIncassareAll = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Da incassare" },
});
const whereIncassato = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Incassato" },
});
const whereM = buildProvvigioniListWhere({
  filters: {
    ...baseFilters,
    stato: "Da incassare",
    recurrenceMode: "monthly",
  },
});

check(
  "focus ≡ stato=Da incassare + recurrenceMode exclude (UT)",
  JSON.stringify(whereFocus) === JSON.stringify(whereUtDaIncassare),
  true,
);
check(
  "focus include recurrenceKind UT",
  JSON.stringify(whereFocus).includes('"recurrenceKind":"UT"') ||
    JSON.stringify(whereFocus).includes(JSON.stringify(nonRecurringWhere)),
  true,
);
check(
  "focus ≠ Da incassare tutti i tipi",
  JSON.stringify(whereFocus) === JSON.stringify(whereDaIncassareAll),
  false,
);
check(
  "focus ≠ Incassato da liquidare",
  JSON.stringify(whereFocus) === JSON.stringify(whereIncassato),
  false,
);
check(
  "focus ≠ Da incassare M",
  JSON.stringify(whereFocus) === JSON.stringify(whereM),
  false,
);

const whereFocusPlusStato = buildProvvigioniListWhere({
  filters: { ...baseFilters, stato: "Da incassare" },
  focus: "ut-da-incassare",
});
check(
  "focus+stato non doppia clausola (≡ solo focus)",
  JSON.stringify(whereFocusPlusStato) === JSON.stringify(whereFocus),
  true,
);

console.log("\n• No doppio conteggio: Da incassare card ≠ Ricorrenti mensili (where distinti)");
const whereDaIncassare = provvigioneStatoWhere("Da incassare");
check(
  "stato Da incassare definito",
  whereDaIncassare != null,
  true,
);
check(
  "mensili where distinto da UT",
  JSON.stringify(recurringMonthlyWhereOr) ===
    JSON.stringify([{ recurrenceKind: "M" }]),
  true,
);
check(
  "B2 e B3 focus mutualmente esclusivi",
  isIncassatoDaLiquidareFocus("ut-da-incassare") ||
    isUtDaIncassareFocus("incassato-da-liquidare"),
  false,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B3 UT da incassare fallite.`);
  process.exit(1);
}
console.log("\n✅ Vista Una tantum da incassare + split UT/M/R (B3): ok.");
