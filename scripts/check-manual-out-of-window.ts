/**
 * Verifica logica rate fuori intervallo con incasso (bonifica manuale).
 * Uso: npx tsx scripts/check-manual-out-of-window.ts
 */
import { findOutOfWindowMonths } from "../src/lib/recurring-cleanup";
import { isDisposableRecurringMonth } from "../src/lib/recurring-window";

type Contract = Parameters<typeof findOutOfWindowMonths>[0];

const base: Omit<Contract, "recurringMonths" | "supplyStartDate"> = {
  id: "c1",
  podPdr: "IT001E89864180",
  insertionDate: new Date(2026, 3, 1),
  supplyStartDate: null,
  operationType: "CAMBIO",
  collectionDate: null,
  recurrence: "M",
  status: "ATTIVATO",
  expiryDate: null,
  supplier: { name: "Helios" },
  collaborator: { name: "Laforgia Vito" },
  client: {
    type: "AZIENDA",
    companyName: "REITOS SRL",
    firstName: null,
    lastName: null,
  },
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

const now = new Date(2026, 8, 15);

console.log("\n• Rata fuori intervallo con incasso → elenco manuale, non rimovibile");
{
  const contract: Contract = {
    ...base,
    supplyStartDate: new Date(2026, 5, 1), // giugno 2026 inizio
    recurringMonths: [
      {
        id: "m-apr",
        period: "2026-04",
        status: "PAID",
        amount: 4,
        paidAt: new Date(2026, 3, 10),
        settledPeriod: "2026-04",
        note: null,
      },
    ],
  };
  const finding = findOutOfWindowMonths(contract, now);
  check("una rata manuale", finding?.manual.length, 1);
  check("zero rimovibili", finding?.removable.length, 0);
  check("id manuale", finding?.manual[0]?.id, "m-apr");
  check("non usa-e-getta", isDisposableRecurringMonth(contract.recurringMonths[0]!), false);
}

console.log("\n• Rata fuori intervallo senza incasso → rimovibile, non manuale");
{
  const contract: Contract = {
    ...base,
    supplyStartDate: new Date(2026, 5, 1),
    recurringMonths: [
      {
        id: "m-apr-pending",
        period: "2026-04",
        status: "PENDING",
        amount: 4,
        paidAt: null,
        settledPeriod: null,
        note: null,
      },
    ],
  };
  const finding = findOutOfWindowMonths(contract, now);
  check("una rimovibile", finding?.removable.length, 1);
  check("zero manuali", finding?.manual.length, 0);
}

console.log("\n• Rata in intervallo → nessuna anomalia");
{
  const contract: Contract = {
    ...base,
    supplyStartDate: new Date(2026, 3, 1),
    recurringMonths: [
      {
        id: "m-apr-ok",
        period: "2026-04",
        status: "PAID",
        amount: 4,
        paidAt: new Date(2026, 3, 10),
        settledPeriod: "2026-04",
        note: null,
      },
    ],
  };
  check("nessun finding", findOutOfWindowMonths(contract, now), null);
}

console.log(
  "\n• Annuale +12 oltre expiry formale → NON fuori intervallo (preserve)",
);
{
  const contract: Contract = {
    ...base,
    recurrence: "R",
    collectionDate: new Date(2025, 5, 15),
    supplyStartDate: new Date(2025, 5, 1),
    expiryDate: new Date(2026, 5, 1),
    recurringMonths: [
      {
        id: "m-2026-06",
        period: "2026-06",
        status: "PENDING",
        amount: 70,
        paidAt: null,
        settledPeriod: null,
        note: null,
      },
    ],
  };
  check(
    "rata annuale +12 non segnalata come fuori intervallo",
    findOutOfWindowMonths(contract, now),
    null,
  );
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Rate fuori intervallo con incasso: verifiche superate.");
