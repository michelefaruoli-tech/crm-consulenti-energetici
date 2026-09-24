/**
 * Verifica della copia annuale +12 all'incasso (senza database).
 *
 * Uso: npx tsx scripts/check-annual-next.ts
 */
import {
  ANNUAL_NEXT_HIDDEN_NOTE,
  isAnnualNextHidden,
  nextAnnualDuePeriod,
} from "../src/lib/recurring";
import { isDisposableRecurringMonth } from "../src/lib/recurring-window";
import { isWithinStornoPeriod, resolveStornoInfo } from "../src/lib/storno-status";
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

check(
  "primo incasso (niente rate pagate) → ingresso + 12 mesi",
  nextAnnualDuePeriod("2026-05", []),
  "2027-05",
);
check(
  "dopo rata 2027-05 incassata → 2028-05",
  nextAnnualDuePeriod("2026-05", ["2027-05"]),
  "2028-05",
);
check(
  "usa l'ultima rata pagata, non la prima",
  nextAnnualDuePeriod("2026-05", ["2027-05", "2028-05"]),
  "2029-05",
);
check(
  "attraversa il cambio anno",
  nextAnnualDuePeriod("2025-12", ["2026-12"]),
  "2027-12",
);

check(
  "nota di sistema riconosciuta come nascosta",
  isAnnualNextHidden(ANNUAL_NEXT_HIDDEN_NOTE),
  true,
);
check("altre note restano visibili", isAnnualNextHidden("Incassato da tabella"), false);
check("nota vuota visibile", isAnnualNextHidden(null), false);

check(
  "copia nascosta in storno NON è usa-e-getta (niente bonifica)",
  isDisposableRecurringMonth({
    status: "PENDING",
    paidAt: null,
    settledPeriod: null,
    note: ANNUAL_NEXT_HIDDEN_NOTE,
  }),
  false,
);
check(
  "PENDING visibile resta bonificabile se fuori intervallo",
  isDisposableRecurringMonth({
    status: "PENDING",
    paidAt: null,
    settledPeriod: null,
    note: null,
  }),
  true,
);

const supply = new Date(2026, 4, 12);
const nowInStorno = new Date(2026, 8, 1);
const nowFuoriStorno = new Date(2027, 5, 1);

check(
  "a 4 mesi dall'ingresso (storno 12) siamo ancora in storno",
  isWithinStornoPeriod({
    supplyStartDate: supply,
    stornoMonths: 12,
    now: nowInStorno,
  }),
  true,
);
check(
  "a 13 mesi dall'ingresso siamo fuori storno",
  isWithinStornoPeriod({
    supplyStartDate: supply,
    stornoMonths: 12,
    now: nowFuoriStorno,
  }),
  false,
);
check(
  "0 mesi storno → non nascondere la copia",
  isWithinStornoPeriod({
    supplyStartDate: supply,
    stornoMonths: 0,
    now: nowInStorno,
  }),
  false,
);

const paidInStorno = resolveStornoInfo({
  status: "PAGATO_DAL_FORNITORE",
  recurrence: "R",
  supplyStartDate: supply,
  stornoMonths: 12,
  collectionDate: new Date(2026, 8, 1),
  now: nowInStorno,
});
check(
  "annuale appena incassata in storno → riga rossa BLOCCA",
  paidInStorno.kind,
  "in_storno",
);
check(
  "annuale appena incassata in storno non è fuori storno",
  paidInStorno.isFuoriStorno,
  false,
);

const unpaidCopy = resolveStornoInfo({
  status: "PAGATO_DAL_FORNITORE",
  recurrence: "R",
  supplyStartDate: supply,
  stornoMonths: 12,
  collectionDate: null,
  now: nowFuoriStorno,
});
check(
  "copia anno successivo visibile fuori storno → Da incassare",
  unpaidCopy.kind,
  "da_pagare",
);

function annualContract(
  overrides: Partial<ContractForProvvigioneRow> = {},
): ContractForProvvigioneRow {
  const supply = new Date(2026, 4, 12);
  return {
    id: "c-annuale",
    clientId: "cl1",
    supplierId: "s1",
    status: "PAGATO_DAL_FORNITORE",
    paymentStatus: "Incassato",
    recurrence: "R",
    podPdr: "IT001E123",
    pod: "IT001E123",
    pdr: null,
    collectionDate: new Date(2026, 8, 1),
    commissionConfirmed: true,
    supplyStartDate: supply,
    insertionDate: new Date(2026, 3, 20),
    createdAt: new Date(2026, 3, 20),
    expiryDate: new Date(2027, 4, 12),
    durationMonths: 12,
    stornoEndDate: new Date(2027, 4, 12),
    operationType: "CAMBIO",
    collaboratorId: "u1",
    notes: null,
    agency: null,
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "Mario",
      lastName: "Rossi",
    },
    collaborator: { id: "u1", name: "Collab" },
    supplier: { id: "s1", name: "Etruria", stornoMonths: 12 },
    commission: {
      id: "cm1",
      expected: 80,
      received: 80,
      paid: 0,
      stornoDate: null,
      stornoAmount: null,
    },
    recurringMonths: [
      {
        period: "2027-05",
        status: "PENDING",
        amount: 80,
        note: ANNUAL_NEXT_HIDDEN_NOTE,
      },
    ],
    ...overrides,
  };
}

const maps = {
  latestMap: new Map([["c-annuale", true]]),
  earlyMap: new Map([["c-annuale", false]]),
};

const hiddenRows = expandContractsToProvvigioneRows([annualContract()], {
  expandMode: "all",
  statoFilter: "Tutti",
  now: nowInStorno,
  ...maps,
});
check(
  "in storno: solo la riga incassata, copia +12 nascosta",
  hiddenRows.map((r) => `${r.stato}:${r.competencePeriod ?? "anno1"}`).join("|"),
  "Incassato:anno1",
);
check(
  "in storno: riga incassata in rosso BLOCCA",
  hiddenRows[0]?.stornoRowClass.includes("bg-red-200") ?? false,
  true,
);

const daIncassareHidden = expandContractsToProvvigioneRows([annualContract()], {
  expandMode: "da-incassare",
  statoFilter: "Da incassare",
  now: nowInStorno,
  ...maps,
});
check(
  "in storno: Da incassare non mostra la copia nascosta",
  daIncassareHidden.length,
  0,
);

const visibleRows = expandContractsToProvvigioneRows(
  [
    annualContract({
      recurringMonths: [
        { period: "2027-05", status: "PENDING", amount: 80, note: null },
      ],
    }),
  ],
  {
    expandMode: "all",
    statoFilter: "Tutti",
    now: nowFuoriStorno,
    ...maps,
  },
);
check(
  "fuori storno: incassata + copia anno successivo",
  visibleRows.map((r) => `${r.stato}:${r.competencePeriod ?? "anno1"}`).join("|"),
  "Incassato:anno1|Da incassare:2027-05",
);

const copyRow = visibleRows.find((r) => r.competencePeriod === "2027-05");
check(
  "copia visibile è Da incassare (giallo), non eredita il rosso",
  copyRow?.stornoRowClass.includes("bg-amber-100") ?? false,
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche fallite (copia annuale +12).`);
  process.exit(1);
}
console.log("\n✅ Copia annuale +12: ok.");
