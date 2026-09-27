/**
 * Fix UX: da scheda M/R la card Tutti deve tornare all'elenco completo.
 * Uso: npx tsx scripts/check-provvigioni-vista-tutti.ts
 *
 * Regressione: se queryBase contiene vista=mensile|annuale, l'href Tutti
 * non deve ripeterlo (altrimenti Link punta alla stessa URL e sembra morto).
 */
import { buildVistaTabHref } from "../src/lib/provvigioni-vista-tabs";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const baseFromM: Record<string, string | undefined> = {
  collab: "abc",
  competence: "tutti",
  vista: "mensile",
};

const baseFromR: Record<string, string | undefined> = {
  stato: "Incassato",
  vista: "annuale",
  focus: undefined,
};

console.log("\n• Da M: Tutti resetta vista, M/R impostano vista");
check(
  "Tutti da mensile",
  buildVistaTabHref("tutti", baseFromM),
  "/provvigioni?collab=abc&competence=tutti",
);
check(
  "M da mensile (stessa scheda)",
  buildVistaTabHref("mensile", baseFromM),
  "/provvigioni?collab=abc&competence=tutti&vista=mensile",
);
check(
  "R da mensile",
  buildVistaTabHref("annuale", baseFromM),
  "/provvigioni?collab=abc&competence=tutti&vista=annuale",
);

console.log("\n• Da R: Tutti senza vista=annuale");
check(
  "Tutti da annuale",
  buildVistaTabHref("tutti", baseFromR),
  "/provvigioni?stato=Incassato",
);
check(
  "R da annuale",
  buildVistaTabHref("annuale", baseFromR),
  "/provvigioni?stato=Incassato&vista=annuale",
);

console.log("\n• Da Tutti (base senza vista)");
check(
  "Tutti da root",
  buildVistaTabHref("tutti", { q: "rossi" }),
  "/provvigioni?q=rossi",
);
check(
  "M da root",
  buildVistaTabHref("mensile", { q: "rossi" }),
  "/provvigioni?q=rossi&vista=mensile",
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check falliti (vista Tutti da M/R)`);
  process.exit(1);
}
console.log("\n✅ Vista Tutti da M/R: tutte le verifiche superate.");
