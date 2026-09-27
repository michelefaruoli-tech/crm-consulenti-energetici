/**
 * P1.1 B4 — colonne operative M/R (competenza, atteso, mese previsto, ritardo).
 * Uso: npx tsx scripts/check-provvigioni-colonne-m-r.ts
 *
 * Verifica mapping UI puro: Helios M+2, no anticipo, ritardo solo su Da incassare.
 * Non tocca motore sync / switch / annuali.
 */
import {
  competencePeriodsForExpectedPayable,
  expectedPayablePeriod,
  HELIOS_RECURRING_GENERATION_LAG_MONTHS,
  operativeDelayDays,
  operativeDelayLabel,
} from "../src/lib/provvigioni-operative";
import { addMonths } from "../src/lib/recurring";
import { COLUMN_FILTER_PARAM } from "../src/lib/provvigioni-column-filters";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Helios: mese previsto = competenza + M+2 (agosto → ottobre)");
check(
  "lag costante",
  HELIOS_RECURRING_GENERATION_LAG_MONTHS,
  2,
);
check(
  "agosto → ottobre",
  expectedPayablePeriod("2026-08", "Helios Energia"),
  "2026-10",
);
check(
  "luglio → settembre",
  expectedPayablePeriod("2026-07", "Helios"),
  "2026-09",
);
check(
  "non-Helios: previsto = competenza",
  expectedPayablePeriod("2026-08", "Enel Energia"),
  "2026-08",
);
check(
  "senza competenza → null",
  expectedPayablePeriod(undefined, "Helios"),
  null,
);

console.log("\n• Filtro mese previsto → competenze DB");
{
  const mapped = competencePeriodsForExpectedPayable(["2026-10", "2026-09"]);
  check("Helios da ottobre", mapped.helios.includes("2026-08"), true);
  check("Helios da settembre", mapped.helios.includes("2026-07"), true);
  check("other resta ottobre", mapped.other.includes("2026-10"), true);
  check(
    "inverso Helios: ottobre − 2 = agosto",
    addMonths("2026-10", -HELIOS_RECURRING_GENERATION_LAG_MONTHS),
    "2026-08",
  );
}

console.log("\n• Ritardo: solo Da incassare oltre il mese previsto");
{
  // 15 ottobre 2026, previsto settembre → in ritardo da fine settembre
  const now = new Date(2026, 9, 15); // mese 0-based: ottobre
  const days = operativeDelayDays({
    stato: "Da incassare",
    expectedPeriod: "2026-09",
    now,
  });
  check("giorni > 0", (days ?? 0) > 0, true);
  check("label gg", operativeDelayLabel(days)?.endsWith(" gg"), true);

  check(
    "dentro mese previsto → null",
    operativeDelayDays({
      stato: "Da incassare",
      expectedPeriod: "2026-10",
      now,
    }),
    null,
  );
  check(
    "Incassato da liquidare → null",
    operativeDelayDays({
      stato: "Incassato da liquidare",
      expectedPeriod: "2026-08",
      now,
    }),
    null,
  );
  check(
    "Liquidato (alias Pagato) → null",
    operativeDelayDays({
      stato: "Liquidato",
      expectedPeriod: "2026-08",
      now,
    }),
    null,
  );
  check(
    "alias Incassato → null",
    operativeDelayDays({
      stato: "Incassato",
      expectedPeriod: "2026-08",
      now,
    }),
    null,
  );
}

console.log("\n• Parametro URL filtro mese previsto");
check(
  "COLUMN_FILTER_PARAM.mesePrevisto",
  COLUMN_FILTER_PARAM.mesePrevisto,
  "meseprev",
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche B4 colonne M/R fallite.`);
  process.exit(1);
}
console.log("\n✅ Colonne operative M/R (B4): ok.");
