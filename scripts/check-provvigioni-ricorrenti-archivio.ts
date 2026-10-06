/**
 * Regola Michele: ricorrenti annuali (R) — in elenco solo ultima liquidata
 * + da incassare (liquidate precedenti archiviate, solo filtro UI).
 *
 * Uso: npx tsx scripts/check-provvigioni-ricorrenti-archivio.ts
 */
import {
  filterVisibleAnnualRecurringMonths,
  isArchivedAnnualLiquidatedRate,
  parseIncludeArchivedAnnual,
  shouldShowAnnualUnitLiquidatedRow,
} from "../src/lib/provvigioni-annual-archive";
import {
  expandContractsToProvvigioneRows,
  type ContractForProvvigioneRow,
} from "../src/lib/provvigioni-rows";

let failures = 0;

function check(name: string, got: unknown, expected: unknown) {
  if (got !== expected) {
    failures += 1;
    console.error(`❌ ${name}\n   got:      ${String(got)}\n   expected: ${String(expected)}`);
    return;
  }
  console.log(`✅ ${name}`);
}

console.log("• Predicate pure");

const months = [
  { period: "2024-05", status: "LIQUIDATED" },
  { period: "2025-05", status: "LIQUIDATED" },
  { period: "2026-05", status: "PENDING" },
];

check(
  "2024 liquidata è archiviata se esiste 2025 liquidata",
  isArchivedAnnualLiquidatedRate(months[0]!, months),
  true,
);
check(
  "2025 liquidata (ultima) non è archiviata",
  isArchivedAnnualLiquidatedRate(months[1]!, months),
  false,
);
check(
  "PENDING non è mai archiviata",
  isArchivedAnnualLiquidatedRate(months[2]!, months),
  false,
);

const visible = filterVisibleAnnualRecurringMonths(months);
check(
  "filtro: solo ultima liquidata + da incassare",
  visible.map((m) => `${m.period}:${m.status}`).sort().join("|"),
  ["2025-05:LIQUIDATED", "2026-05:PENDING"].sort().join("|"),
);

const onlyCurrentYear = filterVisibleAnnualRecurringMonths([
  { period: "2026-03", status: "LIQUIDATED" },
]);
check(
  "solo liquidata anno in corso → mostra quella",
  onlyCurrentYear.map((m) => m.period).join("|"),
  "2026-03",
);

const withPaid = filterVisibleAnnualRecurringMonths([
  { period: "2024-01", status: "LIQUIDATED" },
  { period: "2025-01", status: "LIQUIDATED" },
  { period: "2026-01", status: "PAID" },
]);
check(
  "PAID (incassato da liquidare) resta visibile + ultima liquidata",
  withPaid.map((m) => `${m.period}:${m.status}`).sort().join("|"),
  ["2025-01:LIQUIDATED", "2026-01:PAID"].sort().join("|"),
);

const showAll = filterVisibleAnnualRecurringMonths(months, {
  includeArchived: true,
});
check(
  "?archiviate=1 mostra tutte le liquidate",
  showAll.filter((m) => m.status === "LIQUIDATED").length,
  2,
);

check(
  "parse archiviate=1",
  parseIncludeArchivedAnnual("1"),
  true,
);
check(
  "parse archiviate assente",
  parseIncludeArchivedAnnual(undefined),
  false,
);

check(
  "unità liquidata nascosta se esistono rate LIQUIDATED",
  shouldShowAnnualUnitLiquidatedRow({
    contractStatus: "PROVVIGIONE_LIQUIDATA",
    hasLiquidatedRecurringMonth: true,
  }),
  false,
);
check(
  "unità liquidata visibile se è l’unica liquidata",
  shouldShowAnnualUnitLiquidatedRow({
    contractStatus: "PROVVIGIONE_LIQUIDATA",
    hasLiquidatedRecurringMonth: false,
  }),
  true,
);

console.log("\n• Espansione elenco Provvigioni (multi-anno)");

function annualMultiYear(): ContractForProvvigioneRow {
  const supply = new Date(2023, 4, 12);
  return {
    id: "c-r-multi",
    clientId: "cl1",
    supplierId: "s1",
    status: "PROVVIGIONE_LIQUIDATA",
    paymentStatus: "Pagato",
    recurrence: "R",
    podPdr: "IT001E999",
    pod: "IT001E999",
    pdr: null,
    collectionDate: new Date(2023, 8, 1),
    commissionConfirmed: true,
    supplyStartDate: supply,
    insertionDate: new Date(2023, 3, 20),
    createdAt: new Date(2023, 3, 20),
    expiryDate: new Date(2028, 4, 12),
    durationMonths: 12,
    stornoEndDate: new Date(2024, 4, 12),
    operationType: "CAMBIO",
    collaboratorId: "u1",
    notes: null,
    agency: null,
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "Davide",
      lastName: "Lovera",
    },
    collaborator: { id: "u1", name: "Collab" },
    supplier: { id: "s1", name: "Sinergy", stornoMonths: 12 },
    commission: {
      id: "cm1",
      expected: 80,
      received: 80,
      paid: 80,
      stornoDate: null,
      stornoAmount: null,
    },
    recurringMonths: [
      { period: "2024-05", status: "LIQUIDATED", amount: 80 },
      { period: "2025-05", status: "LIQUIDATED", amount: 80 },
      { period: "2026-05", status: "PENDING", amount: 80 },
    ],
  };
}

const maps = {
  latestMap: new Map([["c-r-multi", true]]),
  earlyMap: new Map([["c-r-multi", false]]),
};

const rowsDefault = expandContractsToProvvigioneRows([annualMultiYear()], {
  expandMode: "all",
  statoFilter: "Tutti",
  now: new Date(2026, 5, 15),
  ...maps,
});
const keysDefault = rowsDefault
  .map((r) => `${r.stato}:${r.competencePeriod ?? "unita"}`)
  .sort()
  .join("|");
check(
  "elenco default: ultima liquidata 2025 + da incassare 2026 (no 2024, no unità)",
  keysDefault,
  ["Da incassare:2026-05", "Liquidato:2025-05"].sort().join("|"),
);

const rowsArchived = expandContractsToProvvigioneRows([annualMultiYear()], {
  expandMode: "all",
  statoFilter: "Tutti",
  now: new Date(2026, 5, 15),
  includeArchivedAnnual: true,
  ...maps,
});
check(
  "con archiviate=1: anche 2024 liquidata",
  rowsArchived.some((r) => r.competencePeriod === "2024-05"),
  true,
);

const rowsPagato = expandContractsToProvvigioneRows([annualMultiYear()], {
  expandMode: "pagato",
  statoFilter: "Pagato",
  now: new Date(2026, 5, 15),
  ...maps,
});
check(
  "filtro Liquidato: solo ultima (2025), non 2024",
  rowsPagato.map((r) => r.competencePeriod).sort().join("|"),
  "2025-05",
);

const rowsDaInc = expandContractsToProvvigioneRows([annualMultiYear()], {
  expandMode: "da-incassare",
  statoFilter: "Da incassare",
  now: new Date(2026, 5, 15),
  ...maps,
});
check(
  "filtro Da incassare: solo 2026",
  rowsDaInc.map((r) => r.competencePeriod).join("|"),
  "2026-05",
);

/** Mensile M: nessuna archiviazione liquidate (tutti i mesi restano). */
const monthly: ContractForProvvigioneRow = {
  ...annualMultiYear(),
  id: "c-m",
  recurrence: "M",
  status: "IN_ATTESA_PAGAMENTO",
  paymentStatus: "Da incassare",
  recurringMonths: [
    { period: "2026-01", status: "LIQUIDATED", amount: 10 },
    { period: "2026-02", status: "LIQUIDATED", amount: 10 },
    { period: "2026-03", status: "PENDING", amount: 10 },
  ],
};
const monthlyRows = expandContractsToProvvigioneRows([monthly], {
  expandMode: "all",
  statoFilter: "Tutti",
  now: new Date(2026, 5, 15),
  latestMap: new Map([["c-m", true]]),
  earlyMap: new Map([["c-m", false]]),
});
check(
  "mensili M: tutte le liquidate restano visibili",
  monthlyRows.filter((r) => r.stato === "Liquidato").length,
  2,
);

if (failures > 0) {
  console.error(`\n❌ check-provvigioni-ricorrenti-archivio: ${failures} falliti`);
  process.exit(1);
}
console.log("\n✅ check-provvigioni-ricorrenti-archivio ok");
