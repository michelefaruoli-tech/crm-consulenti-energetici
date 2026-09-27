/**
 * P1.1 B6 — blocco finanziario + timeline scheda contratto.
 * Uso: npx tsx scripts/check-contract-commission-finance.ts
 *
 * Verifica aggregati puri (UT liquidato, M PAID+LIQUIDATED, R PENDING,
 * storno, D5 adjustments fuori dai totali). Nessun DB.
 */
import {
  buildContractFinanceAdjustments,
  buildContractFinanceTimeline,
  buildContractFinanceTotals,
  type ContractFinanceInput,
} from "../src/lib/contract-commission-finance";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

function baseUt(
  overrides: Partial<ContractFinanceInput> = {},
): ContractFinanceInput {
  return {
    recurrenceKind: "UT",
    contractStatus: "PROVVIGIONE_LIQUIDATA",
    collectionDate: new Date("2026-06-15T12:00:00Z"),
    commission: {
      expected: 100,
      received: 100,
      paid: 100,
      stornoAmount: 0,
      stornoDate: null,
    },
    recurringMonths: [],
    commissionEntries: [
      {
        id: "e1",
        type: "paid",
        amount: 100,
        note: "Liquidazione",
        createdAt: new Date("2026-07-01T12:00:00Z"),
      },
    ],
    payoutRows: [],
    adjustments: [],
    ...overrides,
  };
}

console.log("\n• UT liquidato");
{
  const t = buildContractFinanceTotals(baseUt());
  check("attese", t.attese, 100);
  check("incassato", t.incassato, 100);
  check("daIncassare", t.daIncassare, 0);
  check("daLiquidare", t.daLiquidare, 0);
  check("liquidato", t.liquidato, 100);
  check("storno", t.stornatoRettificato, 0);
  const timeline = buildContractFinanceTimeline(baseUt());
  check("timeline ha riga UT", timeline.some((r) => r.kind === "UT"), true);
  check("stato Liquidato", timeline[0]?.stato, "Liquidato");
}

console.log("\n• M: PAID + LIQUIDATED + PENDING");
{
  const input: ContractFinanceInput = {
    recurrenceKind: "M",
    contractStatus: "IN_FORNITURA",
    collectionDate: null,
    commission: {
      expected: 10,
      received: 0,
      paid: 0,
      stornoAmount: 0,
      stornoDate: null,
    },
    recurringMonths: [
      {
        id: "m1",
        period: "2026-04",
        status: "LIQUIDATED",
        amount: 10,
        paidAt: new Date("2026-06-01"),
        settledPeriod: "2026-06",
        note: null,
      },
      {
        id: "m2",
        period: "2026-05",
        status: "PAID",
        amount: 10,
        paidAt: new Date("2026-07-01"),
        settledPeriod: "2026-07",
        note: null,
      },
      {
        id: "m3",
        period: "2026-06",
        status: "PENDING",
        amount: 10,
        paidAt: null,
        settledPeriod: null,
        note: null,
      },
      {
        id: "m4",
        period: "2026-03",
        status: "CLOSED",
        amount: 10,
        paidAt: null,
        settledPeriod: null,
        note: "chiuso",
      },
    ],
    commissionEntries: [],
    payoutRows: [
      {
        id: "p1",
        period: "2026-05",
        amount: 10,
        recurringMonthId: "m2",
        matchStatus: "APPLIED",
        appliedAt: new Date("2026-07-02"),
        note: null,
        runId: "run-1",
        sourceName: "Helios",
      },
    ],
    adjustments: [],
  };
  const t = buildContractFinanceTotals(input);
  check("attese (no CLOSED)", t.attese, 30);
  check("incassato PAID+LIQ", t.incassato, 20);
  check("daIncassare PENDING", t.daIncassare, 10);
  check("daLiquidare solo PAID", t.daLiquidare, 10);
  check("liquidato", t.liquidato, 10);

  const timeline = buildContractFinanceTimeline(input);
  check("3 righe (no CLOSED)", timeline.length, 3);
  const paidRow = timeline.find((r) => r.id === "rm-m2");
  check("fonte Helios su PAID", paidRow?.fonte, "Helios");
  check(
    "link ciclo liquidazione",
    paidRow?.href,
    "/provvigioni/liquidazioni/run-1",
  );
  check("stato PAID", paidRow?.stato, "Incassato da liquidare");
  check(
    "stato LIQUIDATED",
    timeline.find((r) => r.id === "rm-m1")?.stato,
    "Liquidato",
  );
}

console.log("\n• R orfano (PENDING) + storno gettone");
{
  const input: ContractFinanceInput = {
    recurrenceKind: "R",
    contractStatus: "IN_FORNITURA",
    collectionDate: new Date("2025-01-10"),
    commission: {
      expected: 50,
      received: 50,
      paid: 0,
      stornoAmount: -20,
      stornoDate: new Date("2026-03-01"),
    },
    recurringMonths: [
      {
        id: "r1",
        period: "2026-01",
        status: "PENDING",
        amount: 50,
        paidAt: null,
        settledPeriod: null,
        note: "orfano",
      },
    ],
    commissionEntries: [],
    payoutRows: [],
    adjustments: [],
  };
  const t = buildContractFinanceTotals(input);
  check("attese R", t.attese, 50);
  check("daIncassare R", t.daIncassare, 50);
  check("incassato R rate", t.incassato, 0);
  check("storno assoluto", t.stornatoRettificato, 20);
  const timeline = buildContractFinanceTimeline(input);
  check(
    "riga storno in timeline",
    timeline.some((r) => r.id === "commission-storno"),
    true,
  );
}

console.log("\n• D5: PayoutAdjustment fuori dai totali, sezione dedicata");
{
  const input = baseUt({
    adjustments: [
      {
        id: "a1",
        kind: "RETTIFICA",
        amount: -15,
        note: "Correzione importo",
        voidedAt: null,
        createdAt: new Date("2026-08-01"),
        runId: "run-adj",
        runPeriod: "2026-08",
      },
      {
        id: "a2",
        kind: "STORNO",
        amount: -5,
        note: "Annullato",
        voidedAt: new Date("2026-08-02"),
        createdAt: new Date("2026-08-01"),
        runId: "run-adj",
        runPeriod: "2026-08",
      },
    ],
  });
  const t = buildContractFinanceTotals(input);
  check("totali invariati con adj", t.liquidato, 100);
  check("storno Commission non da adj", t.stornatoRettificato, 0);
  const adj = buildContractFinanceAdjustments(input);
  check("2 adjustment", adj.length, 2);
  check("label RETTIFICA", adj[0]?.kindLabel, "Rettifica");
  check("voided flag", adj.find((a) => a.id === "a2")?.voided, true);
  check(
    "href ciclo",
    adj[0]?.href,
    "/provvigioni/liquidazioni/run-adj",
  );
  const timeline = buildContractFinanceTimeline(input);
  check(
    "adj non in timeline rate",
    timeline.every((r) => !r.id.startsWith("adj")),
    true,
  );
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assertion(i) fallite\n`);
  process.exit(1);
}
console.log("\nOK — check-contract-commission-finance\n");
