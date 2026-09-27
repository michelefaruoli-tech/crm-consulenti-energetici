/**
 * P1.1 B1 — alias etichette ciclo Provvigioni (zero migration).
 * Uso: npx tsx scripts/check-provvigioni-stato-alias.ts
 */
import {
  canonicalizeProvvigioneStato,
  displayProvvigioneStato,
  simplifiedProvvigioneStato,
  provvigioneStatoActionKind,
  PROVVIGIONE_STATO_OPTIONS,
} from "../src/lib/provvigioni-stato";
import {
  parseStatoFilter,
  provvigioneStatoWhere,
} from "../src/lib/provvigioni-filters";
import { resolveReportStati } from "../src/lib/report-filters";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Alias URL / etichette UI");
check("Incassato → canon", canonicalizeProvvigioneStato("Incassato"), "Incassato");
check(
  "Incassato da liquidare → canon",
  canonicalizeProvvigioneStato("Incassato da liquidare"),
  "Incassato",
);
check("Pagato → canon", canonicalizeProvvigioneStato("Pagato"), "Pagato");
check("Liquidato → canon", canonicalizeProvvigioneStato("Liquidato"), "Pagato");
check("display Incassato", displayProvvigioneStato("Incassato"), "Incassato da liquidare");
check("display Pagato", displayProvvigioneStato("Pagato"), "Liquidato");

console.log("\n• Parse filtro (legacy + nuove etichette)");
check("parse Incassato|Pagato", parseStatoFilter("Incassato|Pagato"), [
  "Incassato",
  "Pagato",
]);
check(
  "parse Incassato da liquidare|Liquidato",
  parseStatoFilter("Incassato da liquidare|Liquidato"),
  ["Incassato", "Pagato"],
);

console.log("\n• Etichette riga");
check(
  "LIQUIDATA → Liquidato",
  simplifiedProvvigioneStato("PROVVIGIONE_LIQUIDATA", true),
  "Liquidato",
);
check(
  "con collectionDate → Incassato da liquidare",
  simplifiedProvvigioneStato("ATTIVO", true),
  "Incassato da liquidare",
);

console.log("\n• Marcatura (non confondere Incassato da liquidare con Liquidato)");
check("Liquidato → liquidato", provvigioneStatoActionKind("Liquidato"), "liquidato");
check("Pagato → liquidato", provvigioneStatoActionKind("Pagato"), "liquidato");
check(
  "Incassato da liquidare → incassato",
  provvigioneStatoActionKind("Incassato da liquidare"),
  "incassato",
);
check(
  "Da incassare → da-incassare",
  provvigioneStatoActionKind("Da incassare"),
  "da-incassare",
);

console.log("\n• Opzioni UI + Report");
check(
  "options include Incassato da liquidare",
  (PROVVIGIONE_STATO_OPTIONS as readonly string[]).includes("Incassato da liquidare"),
  true,
);
check(
  "options include Liquidato",
  (PROVVIGIONE_STATO_OPTIONS as readonly string[]).includes("Liquidato"),
  true,
);
check(
  "options senza Pagato (solo alias)",
  (PROVVIGIONE_STATO_OPTIONS as readonly string[]).includes("Pagato"),
  false,
);
check("report Incassato", resolveReportStati("Incassato"), ["Incassato"]);
check("report Liquidato", resolveReportStati("Liquidato"), ["Pagato"]);
check(
  "report Incassato da liquidare",
  resolveReportStati("Incassato da liquidare"),
  ["Incassato"],
);

const wIncassato = provvigioneStatoWhere("Incassato");
const wAlias = provvigioneStatoWhere("Incassato da liquidare");
check(
  "where Incassato ≡ Incassato da liquidare",
  JSON.stringify(wIncassato) === JSON.stringify(wAlias),
  true,
);
const wPagato = provvigioneStatoWhere("Pagato");
const wLiquidato = provvigioneStatoWhere("Liquidato");
check(
  "where Pagato ≡ Liquidato",
  JSON.stringify(wPagato) === JSON.stringify(wLiquidato),
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche alias B1 fallite.`);
  process.exit(1);
}
console.log("\n✅ Alias etichette ciclo Provvigioni (B1): ok.");
