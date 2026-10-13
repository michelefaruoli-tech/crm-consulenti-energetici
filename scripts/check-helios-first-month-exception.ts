/**
 * Eccezione Helios: attivazione / voltura / switch → prima competenza subito
 * con mese di riferimento; le ricorrenze successive seguono il mese precedente.
 *
 * Uso: npx tsx scripts/check-helios-first-month-exception.ts
 */
import {
  isHeliosCompetenceHiddenByLag,
  isHeliosFirstCompetenceLagException,
  isHeliosFirstMonthVisibleOperation,
  monthlyPeriodsDueForContract,
} from "../src/lib/helios-contract-rules";
import { recurringWindow } from "../src/lib/recurring-window";
import { findEarlyMonthlyRows } from "../src/lib/provvigioni-integrity";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const now = new Date(2026, 9, 1); // ottobre → mese pagato = settembre

console.log("\n• Tipi operazione eccezione (valori già in schema)");
{
  check("NUOVA_ATTIVAZIONE", isHeliosFirstMonthVisibleOperation("NUOVA_ATTIVAZIONE"), true);
  check("ATTIVAZIONE", isHeliosFirstMonthVisibleOperation("ATTIVAZIONE"), true);
  check("VOLTURA", isHeliosFirstMonthVisibleOperation("VOLTURA"), true);
  check("SWITCH", isHeliosFirstMonthVisibleOperation("SWITCH"), true);
  check("CAMBIO (legacy switch)", isHeliosFirstMonthVisibleOperation("CAMBIO"), true);
  check("SUBENTRO", isHeliosFirstMonthVisibleOperation("SUBENTRO"), true);
  check("CESSAZIONE esclusa", isHeliosFirstMonthVisibleOperation("CESSAZIONE"), false);
  check("RINNOVO escluso", isHeliosFirstMonthVisibleOperation("RINNOVO"), false);
  check("vuoto escluso", isHeliosFirstMonthVisibleOperation(null), false);
}

console.log("\n• Helios NUOVA_ATTIVAZIONE ingresso settembre → a ottobre crea set (mese rif.)");
{
  const contract = {
    insertionDate: new Date(2026, 8, 20),
    supplyStartDate: new Date(2026, 8, 1),
    operationType: "NUOVA_ATTIVAZIONE",
    status: "INSERITO",
    expiryDate: null as Date | null,
    statusHistory: [] as Array<{ changedAt: Date }>,
  };
  const window = recurringWindow(contract, now);
  check("window.start = set", window.start, "2026-09");
  check(
    "periodi dovuti = [set]",
    monthlyPeriodsDueForContract({
      supplierName: "Helios",
      operationType: "NUOVA_ATTIVAZIONE",
      window,
      now,
    }),
    ["2026-09"],
  );
  check(
    "prima competenza non nascosta in lista",
    isHeliosCompetenceHiddenByLag({
      period: "2026-09",
      operationType: "NUOVA_ATTIVAZIONE",
      supplyStartPeriod: "2026-09",
      now,
    }),
    false,
  );
  check(
    "ottobre (non prima) resta nascosto",
    isHeliosCompetenceHiddenByLag({
      period: "2026-10",
      operationType: "NUOVA_ATTIVAZIONE",
      supplyStartPeriod: "2026-09",
      now,
    }),
    true,
  );
}

console.log("\n• Helios SWITCH ingresso ottobre → crea ott; ricorrenze > lastPayable no");
{
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 9, 1),
      supplyStartDate: new Date(2026, 9, 1),
      operationType: "SWITCH",
      status: "IN_LAVORAZIONE",
      expiryDate: null,
    },
    now,
  );
  check(
    "periodi = [ott]",
    monthlyPeriodsDueForContract({
      supplierName: "Helios",
      operationType: "SWITCH",
      window,
      now,
    }),
    ["2026-10"],
  );
}

console.log("\n• Helios VOLTURA ingresso luglio → a ottobre solo settembre");
{
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 6, 1),
      supplyStartDate: new Date(2026, 6, 1),
      operationType: "VOLTURA",
      status: "ATTIVATO",
      expiryDate: null,
    },
    now,
  );
  check(
    "solo settembre",
    monthlyPeriodsDueForContract({
      supplierName: "Helios",
      operationType: "VOLTURA",
      window,
      now,
    }),
    ["2026-09"],
  );
}

console.log("\n• Helios ALTRO ingresso set → a ottobre crea settembre (mese pagato)");
{
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 8, 1),
      supplyStartDate: new Date(2026, 8, 1),
      operationType: "ALTRO",
      status: "INSERITO",
      expiryDate: null,
    },
    now,
  );
  check(
    "solo settembre",
    monthlyPeriodsDueForContract({
      supplierName: "Helios",
      operationType: "ALTRO",
      window,
      now,
    }),
    ["2026-09"],
  );
}

console.log("\n• A novembre la riga nuova è solo ottobre");
{
  const november = new Date(2026, 10, 1);
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 0, 1),
      supplyStartDate: new Date(2026, 0, 1),
      operationType: "VOLTURA",
      status: "ATTIVATO",
      expiryDate: null,
    },
    november,
  );
  check(
    "solo ottobre",
    monthlyPeriodsDueForContract({
      supplierName: "Helios",
      operationType: "VOLTURA",
      window,
      now: november,
    }),
    ["2026-10"],
  );
}

console.log("\n• Non-Helios invariato");
{
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 9, 1),
      supplyStartDate: new Date(2026, 9, 1),
      operationType: "SWITCH",
      status: "INSERITO",
      expiryDate: null,
    },
    now,
  );
  check(
    "Enel ottobre",
    monthlyPeriodsDueForContract({
      supplierName: "Enel",
      operationType: "SWITCH",
      window,
      now,
    }),
    ["2026-10"],
  );
}

console.log("\n• Integrity: prima competenza eccezione non è «early»");
{
  const early = findEarlyMonthlyRows(
    {
      recurrence: "M",
      status: "INSERITO",
      operationType: "NUOVA_ATTIVAZIONE",
      insertionDate: new Date(2026, 8, 1),
      supplyStartDate: new Date(2026, 8, 1),
      expiryDate: null,
      supplier: { name: "Helios" },
      recurringMonths: [
        { id: "r1", period: "2026-09", status: "PENDING" },
        { id: "r2", period: "2026-10", status: "PENDING" },
      ],
    },
    now,
  );
  check(
    "solo ottobre early (set = prima competenza)",
    early.map((r) => r.period),
    ["2026-10"],
  );
  check(
    "isHeliosFirstCompetenceLagException set",
    isHeliosFirstCompetenceLagException({
      operationType: "NUOVA_ATTIVAZIONE",
      competencePeriod: "2026-09",
      supplyStartPeriod: "2026-09",
    }),
    true,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion fallite`);
  process.exit(1);
}
console.log("\nTutti i check ok.\n");
