/**
 * P1.1 B8 — alias query robusti + deep-link Dashboard.
 * Uso: npx tsx scripts/check-provvigioni-deep-links.ts
 */
import {
  canonicalizeProvvigioneStato,
  normalizeProvvigioneStatoToken,
} from "../src/lib/provvigioni-stato";
import {
  parseStatoFilter,
  parseProvvigioniFocus,
  resolveProvvigioniFocusFromQuery,
  buildProvvigioniListWhere,
  effectiveStatoForList,
} from "../src/lib/provvigioni-filters";
import {
  canonicalizeProvvigioniDeepLinkQuery,
  provvigioniDeepLinkHref,
} from "../src/lib/provvigioni-deep-links";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Alias stato robusti (case / trattini / +)");
check(
  "normalize Incassato-da-liquidare",
  normalizeProvvigioneStatoToken("Incassato-da-liquidare"),
  "incassato da liquidare",
);
check(
  "canon INCASSATO",
  canonicalizeProvvigioneStato("INCASSATO"),
  "Incassato",
);
check(
  "canon Incassato+da+liquidare",
  canonicalizeProvvigioneStato("Incassato+da+liquidare"),
  "Incassato",
);
check(
  "canon liquidato minuscolo",
  canonicalizeProvvigioneStato("liquidato"),
  "Pagato",
);
check(
  "parse Incassato-da-liquidare|Pagato",
  parseStatoFilter("Incassato-da-liquidare|Pagato"),
  ["Incassato", "Pagato"],
);

console.log("\n• Parse focus alias");
check(
  "focus Incassato",
  parseProvvigioniFocus("Incassato"),
  "incassato-da-liquidare",
);
check(
  "focus Incassato da liquidare",
  parseProvvigioniFocus("Incassato da liquidare"),
  "incassato-da-liquidare",
);
check("focus ut", parseProvvigioniFocus("ut"), "ut-da-incassare");
check(
  "focus anomalie-unificate",
  parseProvvigioniFocus("anomalie-unificate"),
  "anomalie",
);

console.log("\n• Resolve focus da query legacy Dashboard");
check(
  "stato=Incassato → focus B2",
  resolveProvvigioniFocusFromQuery({ stato: "Incassato" }),
  "incassato-da-liquidare",
);
check(
  "stato=Incassato da liquidare → focus B2",
  resolveProvvigioniFocusFromQuery({ stato: "Incassato da liquidare" }),
  "incassato-da-liquidare",
);
check(
  "stato=Da incassare non promuove UT",
  resolveProvvigioniFocusFromQuery({ stato: "Da incassare" }),
  undefined,
);
check(
  "focus esplicito vince",
  resolveProvvigioniFocusFromQuery({
    focus: "ut-da-incassare",
    stato: "Incassato",
  }),
  "ut-da-incassare",
);
check(
  "multi stato non promuove",
  resolveProvvigioniFocusFromQuery({ stato: "Incassato|Pagato" }),
  undefined,
);

console.log("\n• Deep-link href Dashboard");
check(
  "incassato-da-liquidare",
  provvigioniDeepLinkHref("incassato-da-liquidare"),
  "/provvigioni?focus=incassato-da-liquidare",
);
check(
  "ut-da-incassare",
  provvigioniDeepLinkHref("ut-da-incassare"),
  "/provvigioni?focus=ut-da-incassare",
);
check(
  "anomalie",
  provvigioniDeepLinkHref("anomalie"),
  "/provvigioni?focus=anomalie",
);
check(
  "da-incassare-m",
  provvigioniDeepLinkHref("da-incassare-m"),
  "/provvigioni?vista=mensile&stato=Da+incassare",
);
check(
  "legacy stato=Incassato ≡ focus",
  canonicalizeProvvigioniDeepLinkQuery({ stato: "Incassato" }),
  provvigioniDeepLinkHref("incassato-da-liquidare"),
);
check(
  "legacy stato=Pagato ≡ Liquidato",
  canonicalizeProvvigioniDeepLinkQuery({ stato: "Pagato" }),
  provvigioniDeepLinkHref("liquidato"),
);

console.log("\n• Where: legacy stato ≡ focus (compatibilità bookmark)");
const wLegacy = buildProvvigioniListWhere({
  filters: { stato: "Incassato" },
});
const wFocus = buildProvvigioniListWhere({
  filters: {},
  focus: "incassato-da-liquidare",
});
check(
  "where stato=Incassato ≡ focus",
  JSON.stringify(wLegacy) === JSON.stringify(wFocus),
  true,
);
check(
  "effectiveStato focus",
  effectiveStatoForList(undefined, "incassato-da-liquidare"),
  "Incassato",
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche deep-link B8 fallite.`);
  process.exit(1);
}
console.log("\n✅ Alias robusti + deep-link Dashboard (B8): ok.");
