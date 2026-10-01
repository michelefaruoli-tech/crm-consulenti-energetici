/**
 * Contratti salvati → subito in Provvigioni.
 *
 * Verifica (senza DB):
 * - neverSyncedMonthlyWhere include Helios (visibilità lag M+2 senza rate)
 * - esclude BOZZA / KO
 * - piano backfill Helios rispetta ancora lag (nessuna rata anticipata)
 *
 * Uso: npx tsx scripts/check-contratti-subito-provvigioni.ts
 */
import { neverSyncedMonthlyWhere } from "../src/lib/provvigioni-filters";
import {
  expectedPeriodsFor,
  findMissing,
  planBackfillForContract,
} from "../src/lib/recurring-backfill";
import { provvigioneStatoWhere } from "../src/lib/provvigioni-filters";

type Contract = Parameters<typeof expectedPeriodsFor>[0];

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const now = new Date(2026, 9, 1); // 1 ottobre 2026 → lastPayable Helios = agosto

console.log("\n• neverSyncedMonthlyWhere: Helios incluso, BOZZA/KO esclusi");
{
  const s = JSON.stringify(neverSyncedMonthlyWhere);
  check("recurrenceKind M", s.includes('"recurrenceKind":"M"'), true);
  check("nessuna rata", s.includes('"recurringMonths":{"none":{}}'), true);
  check(
    "NON esclude Helios per nome fornitore",
    s.toLowerCase().includes("helios") === false,
    true,
  );
  check("esclude BOZZA", s.includes("BOZZA"), true);
  check("esclude KO", s.includes("KO"), true);
}

console.log("\n• Da incassare: bozze fuori lista");
{
  const where = provvigioneStatoWhere("Da incassare");
  const s = JSON.stringify(where);
  check("esclude BOZZA dallo status notIn", s.includes("BOZZA"), true);
}

console.log("\n• Helios appena inserito (ingresso set): nessuna rata a ottobre (lag)");
{
  const contract: Contract = {
    id: "h1",
    podPdr: "IT001E999",
    pod: null,
    pdr: null,
    recurrence: "M",
    recurrenceKind: "M",
    collectionDate: null,
    insertionDate: new Date(2026, 8, 20),
    supplyStartDate: new Date(2026, 8, 1), // settembre
    operationType: "NUOVA_ATTIVAZIONE",
    status: "INSERITO",
    expiryDate: null,
    supplier: { name: "Helios" },
    collaborator: { name: "Michele" },
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "Test",
      lastName: "Helios",
    },
    statusHistory: [],
    recurringMonths: [],
  };
  // A ottobre lastPayable = agosto; start = settembre → nessuna rata da creare
  const expected = expectedPeriodsFor(contract, now);
  check("nessun periodo Helios anticipato", expected, []);
  check("findMissing null (lag rispettato)", findMissing(contract, now), null);
  check("piano vuoto", planBackfillForContract(contract, now), []);
}

console.log("\n• Helios con ingresso luglio: a ottobre crea fino ad agosto");
{
  const contract: Contract = {
    id: "h2",
    podPdr: "IT001E888",
    pod: null,
    pdr: null,
    recurrence: "M",
    recurrenceKind: "M",
    collectionDate: null,
    insertionDate: new Date(2026, 6, 1),
    supplyStartDate: new Date(2026, 6, 1), // luglio
    operationType: "CAMBIO",
    status: "IN_LAVORAZIONE",
    expiryDate: null,
    supplier: { name: "Helios" },
    collaborator: { name: "Michele" },
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "Test",
      lastName: "Lug",
    },
    statusHistory: [],
    recurringMonths: [],
  };
  const expected = expectedPeriodsFor(contract, now);
  check("periodi lug–ago", expected, ["2026-07", "2026-08"]);
  check(
    "mancanti lug–ago",
    findMissing(contract, now)?.missingPeriods,
    ["2026-07", "2026-08"],
  );
}

console.log("\n• Non-Helios salvato INSERITO: crea subito il mese corrente");
{
  const contract: Contract = {
    id: "n1",
    podPdr: "IT001E777",
    pod: null,
    pdr: null,
    recurrence: "M",
    recurrenceKind: "M",
    collectionDate: null,
    insertionDate: new Date(2026, 9, 1),
    supplyStartDate: new Date(2026, 9, 1),
    operationType: "CAMBIO",
    status: "INSERITO",
    expiryDate: null,
    supplier: { name: "Enel" },
    collaborator: { name: "Michele" },
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "Test",
      lastName: "Enel",
    },
    statusHistory: [],
    recurringMonths: [],
  };
  check("mese ottobre", expectedPeriodsFor(contract, now), ["2026-10"]);
}

if (failures > 0) {
  console.error(`\n${failures} assertion fallite`);
  process.exit(1);
}
console.log("\nTutti i check ok.\n");
