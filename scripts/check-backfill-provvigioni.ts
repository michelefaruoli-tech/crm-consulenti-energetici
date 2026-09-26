/**
 * Verifica della logica di backfill "contratto salvato ma non in Provvigioni"
 * (senza database): quali periodi dovrebbero già esistere per un contratto
 * ricorrente e quali risultano davvero mancanti rispetto alle rate già
 * presenti. Copre mensile non-Helios, mensile Helios (lag M+2), annuale
 * (+12), KO/ANNULLATO e una tantum (mai backfillato).
 *
 * Uso: npx tsx scripts/check-backfill-provvigioni.ts
 */
import {
  expectedPeriodsFor,
  findMissing,
  planBackfillForContract,
} from "../src/lib/recurring-backfill";
import { RECURRING_AUTO_CLOSED_NOTE } from "../src/lib/recurring-window";

type Contract = Parameters<typeof expectedPeriodsFor>[0];

const client = {
  type: "PRIVATO",
  companyName: null,
  firstName: "Nico",
  lastName: "D'Errico",
} as const;

const base: Omit<Contract, "recurrence" | "supplier" | "recurringMonths"> = {
  id: "c1",
  podPdr: "IT001E12345678",
  pod: null,
  pdr: null,
  recurrenceKind: "UT",
  collectionDate: null,
  insertionDate: new Date(2026, 0, 1),
  supplyStartDate: new Date(2026, 0, 1),
  operationType: "CAMBIO",
  status: "ATTIVATO",
  expiryDate: null,
  collaborator: { name: "Michele Faruoli" },
  client,
  statusHistory: [],
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const now = new Date(2026, 8, 15); // 15 settembre 2026

console.log("\n• Mensile non-Helios: contratto appena salvato, nessuna rata esistente");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Sorgenia Business" },
    recurringMonths: [],
    supplyStartDate: new Date(2026, 8, 1),
  };
  const expected = expectedPeriodsFor(contract, now);
  check("periodi attesi = mese corrente", expected, ["2026-09"]);
  const missing = findMissing(contract, now);
  check("segnalato come mancante", missing?.missingPeriods, ["2026-09"]);
  check("tipo M", missing?.recurrenceKind, "M");
}

console.log("\n• Mensile Helios: lag M+2 resta (agosto non generabile a settembre)");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Helios" },
    supplyStartDate: new Date(2026, 0, 1),
    recurringMonths: [],
  };
  const expected = expectedPeriodsFor(contract, now);
  check("ultimo periodo generabile = luglio (settembre − 2)", expected.at(-1), "2026-07");
  check("agosto NON tra i periodi attesi", expected.includes("2026-08"), false);
  check("settembre NON tra i periodi attesi", expected.includes("2026-09"), false);
}

console.log("\n• Mensile: rate già presenti non vengono riproposte come mancanti");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Sorgenia Business" },
    supplyStartDate: new Date(2026, 5, 1),
    recurringMonths: [
      { period: "2026-06", status: "PAID" },
      { period: "2026-07", status: "PAID" },
      { period: "2026-08", status: "PENDING" },
    ],
  };
  const missing = findMissing(contract, now);
  check("solo settembre manca", missing?.missingPeriods, ["2026-09"]);
}

console.log("\n• Mensile: rata Incassato/Pagato/storno esistente non viene mai toccata");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Sorgenia Business" },
    supplyStartDate: new Date(2026, 0, 1),
    recurringMonths: [
      { period: "2026-01", status: "PAID" },
      { period: "2026-02", status: "PAID" },
      { period: "2026-03", status: "PAID" },
      { period: "2026-04", status: "PAID" },
      { period: "2026-05", status: "LIQUIDATED" },
      { period: "2026-06", status: "PAID" },
      { period: "2026-07", status: "PAID" },
      { period: "2026-08", status: "PAID" },
      { period: "2026-09", status: "PAID" },
    ],
  };
  const missing = findMissing(contract, now);
  check("nessuna rata mancante: già tutte presenti", missing, null);
}

console.log("\n• Annuale (+12): non ancora dovuto → nessun backfill");
{
  const contract: Contract = {
    ...base,
    recurrence: "R",
    recurrenceKind: "R",
    supplier: { name: "Etruria Energy" },
    supplyStartDate: new Date(2026, 6, 1), // luglio: scadenza a luglio 2027
    recurringMonths: [],
  };
  const missing = findMissing(contract, now);
  check("nessuna scadenza ancora dovuta", missing, null);
}

console.log("\n• Annuale (+12): scadenza già maturata e mai creata → backfill");
{
  const contract: Contract = {
    ...base,
    recurrence: "R",
    recurrenceKind: "R",
    supplier: { name: "Sinergy" },
    supplyStartDate: new Date(2025, 6, 1), // luglio 2025 → scadenza luglio 2026 (già passata)
    collectionDate: new Date(2025, 6, 15),
    recurringMonths: [],
  };
  const missing = findMissing(contract, now);
  check("scadenza luglio 2026 mancante", missing?.missingPeriods, ["2026-07"]);
  check("tipo R", missing?.recurrenceKind, "R");
  check("piano = anteprima", planBackfillForContract(contract, now).map((p) => p.period), [
    "2026-07",
  ]);
}

console.log("\n• Annuale: primo anno non incassato → nessun backfill (allineato al sync)");
{
  const contract: Contract = {
    ...base,
    recurrence: "R",
    recurrenceKind: "R",
    supplier: { name: "Sinergy" },
    supplyStartDate: new Date(2025, 6, 1),
    collectionDate: null,
    recurringMonths: [],
  };
  check("nessuna scadenza attesa", expectedPeriodsFor(contract, now), []);
  check("non segnalato", findMissing(contract, now), null);
}

console.log("\n• Mensile: rata auto-chiusa fuori regola conta come mancante");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Sorgenia Business" },
    supplyStartDate: new Date(2026, 5, 1),
    recurringMonths: [
      { period: "2026-06", status: "PAID" },
      {
        period: "2026-07",
        status: "CLOSED",
        note: RECURRING_AUTO_CLOSED_NOTE.beforeStart,
      },
      { period: "2026-08", status: "PENDING" },
    ],
  };
  const missing = findMissing(contract, now);
  check("luglio da riaprire (+ settembre mancante)", missing?.missingPeriods, [
    "2026-07",
    "2026-09",
  ]);
}

console.log("\n• KO / ANNULLATO: mai backfillato (nessuna nuova rata)");
{
  const contract: Contract = {
    ...base,
    recurrence: "M",
    recurrenceKind: "M",
    supplier: { name: "Sorgenia Business" },
    status: "KO",
    supplyStartDate: new Date(2026, 0, 1),
    recurringMonths: [],
  };
  check("nessun periodo atteso per KO", expectedPeriodsFor(contract, now), []);
}

console.log("\n• Una tantum: non ha mai bisogno di RecurringMonth");
{
  const contract: Contract = {
    ...base,
    recurrence: "Una tantum",
    recurrenceKind: "UT",
    supplier: { name: "Enel Energia" },
    recurringMonths: [],
  };
  check("nessun periodo atteso per UT", expectedPeriodsFor(contract, now), []);
  check("mai segnalato mancante", findMissing(contract, now), null);
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Backfill Provvigioni mancanti: tutte le verifiche superate.");
