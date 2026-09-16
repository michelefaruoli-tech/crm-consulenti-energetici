/**
 * Verifica della regola di intervallo delle rate ricorrenti (senza database).
 *
 * Copre i casi di confine: ingresso a metà mese, cessazione il 1° del mese,
 * cessazione a metà mese, contratto chiuso, contratto ancora aperto.
 *
 * Uso: npx tsx scripts/check-recurring-window.ts
 */
import {
  isDisposableRecurringMonth,
  isPeriodInRecurringWindow,
  lastGeneratedPeriod,
  recurringWindow,
} from "../src/lib/recurring-window";
import { HELIOS_RECURRING_GENERATION_LAG_MONTHS } from "../src/lib/helios-contract-rules";

type Case = {
  name: string;
  contract: Parameters<typeof recurringWindow>[0];
  expectStart: string;
  expectEnd: string | null;
  inside: string[];
  outside: string[];
};

const base = {
  insertionDate: new Date(2026, 3, 20),
  operationType: "CAMBIO",
  status: "PAGATO_DAL_FORNITORE",
  expiryDate: null,
  statusHistory: [] as Array<{ changedAt: Date }>,
};

const cases: Case[] = [
  {
    name: "Ingresso a metà mese (12/05/2026): maggio incluso, mesi prima esclusi",
    contract: { ...base, supplyStartDate: new Date(2026, 4, 12) },
    expectStart: "2026-05",
    expectEnd: null,
    inside: ["2026-05", "2026-06", "2026-09"],
    outside: ["2026-01", "2026-02", "2026-03", "2026-04", "2025-12"],
  },
  {
    name: "Cessazione il 1° del mese (01/10/2026): ultimo mese settembre",
    contract: {
      ...base,
      supplyStartDate: new Date(2026, 4, 12),
      expiryDate: new Date(2026, 9, 1),
    },
    expectStart: "2026-05",
    expectEnd: "2026-09",
    inside: ["2026-05", "2026-09"],
    outside: ["2026-04", "2026-10", "2026-11"],
  },
  {
    name: "Cessazione a metà mese (15/10/2026): ottobre incluso",
    contract: {
      ...base,
      supplyStartDate: new Date(2026, 4, 12),
      expiryDate: new Date(2026, 9, 15),
    },
    expectStart: "2026-05",
    expectEnd: "2026-10",
    inside: ["2026-10"],
    outside: ["2026-11"],
  },
  {
    name: "Contratto CHIUSO a giugno: ultimo mese giugno",
    contract: {
      ...base,
      supplyStartDate: new Date(2026, 4, 12),
      status: "CHIUSO",
      statusHistory: [{ changedAt: new Date(2026, 5, 18) }],
    },
    expectStart: "2026-05",
    expectEnd: "2026-06",
    inside: ["2026-05", "2026-06"],
    outside: ["2026-04", "2026-07"],
  },
  {
    name: "Senza data fornitura: fallback su regola Switch (inserimento 20/04 → 01/06)",
    contract: { ...base, supplyStartDate: null },
    expectStart: "2026-06",
    expectEnd: null,
    inside: ["2026-06", "2026-07"],
    outside: ["2026-05"],
  },
  {
    name: "Chiusura e cessazione insieme: vince la più vicina",
    contract: {
      ...base,
      supplyStartDate: new Date(2026, 0, 1),
      status: "CHIUSO",
      statusHistory: [{ changedAt: new Date(2026, 7, 4) }],
      expiryDate: new Date(2026, 5, 1),
    },
    expectStart: "2026-01",
    expectEnd: "2026-05",
    inside: ["2026-01", "2026-05"],
    outside: ["2026-06", "2026-08"],
  },
];

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`   ${ok ? "ok " : "KO "} ${label}: ${String(actual)} (atteso ${String(expected)})`);
}

for (const c of cases) {
  console.log(`\n• ${c.name}`);
  const w = recurringWindow(c.contract, new Date(2026, 8, 15));
  check("primo mese", w.start, c.expectStart);
  check("ultimo mese", w.end, c.expectEnd);
  for (const p of c.inside) check(`${p} incluso`, isPeriodInRecurringWindow(w, p), true);
  for (const p of c.outside) check(`${p} escluso`, isPeriodInRecurringWindow(w, p), false);
}

console.log("\n• Rate eliminabili solo se prive di valore economico");
check(
  "PENDING senza incasso",
  isDisposableRecurringMonth({ status: "PENDING", paidAt: null, settledPeriod: null }),
  true,
);
check(
  "MISSING senza incasso",
  isDisposableRecurringMonth({ status: "MISSING", paidAt: null, settledPeriod: null }),
  true,
);
check(
  "CLOSED senza incasso",
  isDisposableRecurringMonth({ status: "CLOSED", paidAt: null, settledPeriod: null }),
  true,
);
check(
  "PAID",
  isDisposableRecurringMonth({ status: "PAID", paidAt: new Date(), settledPeriod: "2026-06" }),
  false,
);
check(
  "LIQUIDATED",
  isDisposableRecurringMonth({
    status: "LIQUIDATED",
    paidAt: new Date(),
    settledPeriod: "2026-06",
  }),
  false,
);
check(
  "ERROR_UNPAID",
  isDisposableRecurringMonth({ status: "ERROR_UNPAID", paidAt: null, settledPeriod: null }),
  false,
);
check(
  "MISSING ma con rendiconto valorizzato",
  isDisposableRecurringMonth({
    status: "MISSING",
    paidAt: null,
    settledPeriod: "2026-06",
  }),
  false,
);

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Regola intervallo rate ricorrenti: tutte le verifiche superate.");

console.log("\n• Helios: ultimo mese generabile = mese corrente − lag competenza");
const heliosWindow = recurringWindow(
  { ...base, supplyStartDate: new Date(2026, 0, 1) },
  new Date(2026, 8, 15),
);
check(
  "settembre 2026, lag 2 → luglio",
  lastGeneratedPeriod(heliosWindow, new Date(2026, 8, 15), HELIOS_RECURRING_GENERATION_LAG_MONTHS),
  "2026-07",
);
check(
  "ottobre 2026, lag 2 → agosto",
  lastGeneratedPeriod(heliosWindow, new Date(2026, 9, 10), HELIOS_RECURRING_GENERATION_LAG_MONTHS),
  "2026-08",
);
check(
  "novembre 2026, lag 2 → settembre",
  lastGeneratedPeriod(heliosWindow, new Date(2026, 10, 5), HELIOS_RECURRING_GENERATION_LAG_MONTHS),
  "2026-09",
);
check(
  "senza lag → mese corrente",
  lastGeneratedPeriod(heliosWindow, new Date(2026, 8, 15), 0),
  "2026-09",
);

if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite (inclusi test Helios).`);
  process.exit(1);
}
console.log("✅ Test Helios lag generazione: ok.");
