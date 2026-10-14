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
import {
  preservedMonthlySwitchPeriod,
  preservedSwitchMonthPlan,
  recurringWindow,
} from "../src/lib/recurring-window";
import {
  buildProvvigioniContractWhere,
  provvigioneStatoWhere,
} from "../src/lib/provvigioni-filters";
import {
  expandContractsToProvvigioneRows,
  type ContractForProvvigioneRow,
} from "../src/lib/provvigioni-rows";
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

console.log("\n• Switch 1 ottobre: ultimo mese settembre resta");
{
  const window = recurringWindow(
    {
      insertionDate: new Date(2026, 0, 1),
      supplyStartDate: new Date(2026, 0, 1),
      operationType: "SWITCH",
      status: "KO",
      expiryDate: new Date(2026, 8, 30),
    },
    now,
  );
  const note = "KO: nuovo contratto stesso POD in fornitura dal 01/10/2026";
  check("finestra fino a settembre", window.end, "2026-09");
  check(
    "periodo preservato",
    preservedMonthlySwitchPeriod({
      status: "KO",
      recurrence: "M",
      koNotes: note,
      window,
      lastGenerated: "2026-09",
    }),
    "2026-09",
  );
  check(
    "KO vero senza nota switch non preserva",
    preservedMonthlySwitchPeriod({
      status: "KO",
      recurrence: "M",
      koNotes: "KO: pratica fallita",
      window,
      lastGenerated: "2026-09",
    }),
    null,
  );
  check(
    "ANNULLATO non preserva",
    preservedMonthlySwitchPeriod({
      status: "ANNULLATO",
      recurrence: "M",
      koNotes: note,
      window,
      lastGenerated: "2026-09",
    }),
    null,
  );
  check(
    "mese oltre il pagato non si anticipa",
    preservedMonthlySwitchPeriod({
      status: "KO",
      recurrence: "M",
      koNotes: note,
      window: { start: "2026-01", end: "2026-10" },
      lastGenerated: "2026-09",
    }),
    null,
  );
  check(
    "rata assente: crea MISSING",
    preservedSwitchMonthPlan(undefined, "2026-09", "2026-10"),
    { kind: "create", status: "MISSING" },
  );
  check(
    "CLOSED nudo: riapre",
    preservedSwitchMonthPlan(
      { status: "CLOSED", paidAt: null, settledPeriod: null, note: null },
      "2026-09",
      "2026-10",
    ),
    { kind: "reopen", status: "MISSING" },
  );
  check(
    "PAID non torna indietro",
    preservedSwitchMonthPlan(
      { status: "PAID", paidAt: new Date(2026, 9, 1), settledPeriod: "2026-10", note: null },
      "2026-09",
      "2026-10",
    ),
    { kind: "keep" },
  );
  check(
    "LIQUIDATED non torna indietro",
    preservedSwitchMonthPlan(
      { status: "LIQUIDATED", paidAt: new Date(2026, 8, 1), settledPeriod: "2026-09", note: null },
      "2026-09",
      "2026-10",
    ),
    { kind: "keep" },
  );
}

console.log("\n• Lista: switch KO e liquidato con rata PAID restano in Incassato");
{
  const daIncassare = JSON.stringify(provvigioneStatoWhere("Da incassare"));
  check("Da incassare esclude ancora BOZZA", daIncassare.includes("BOZZA"), true);
  check("Da incassare cita ancora KO", daIncassare.includes("KO"), true);
  const incassato = JSON.stringify(provvigioneStatoWhere("Incassato"));
  check(
    "Incassato include il contratto liquidato con rata PAID",
    incassato.includes("PROVVIGIONE_LIQUIDATA"),
    true,
  );
  check(
    "Incassato include la nota switch",
    incassato.includes("KO: nuovo contratto stesso POD"),
    true,
  );
  const list = JSON.stringify(
    buildProvvigioniContractWhere({
      canViewAll: true,
      sessionUserId: "u1",
      stato: "Incassato",
    }),
  );
  check(
    "elenco senza filtro KO tiene lo switch",
    list.includes("KO: nuovo contratto stesso POD"),
    true,
  );

  const base: ContractForProvvigioneRow = {
    id: "c-ko",
    clientId: "cl1",
    supplierId: "s1",
    status: "KO",
    paymentStatus: null,
    recurrence: "M",
    podPdr: "IT001E111",
    pod: "IT001E111",
    pdr: null,
    collectionDate: null,
    commissionConfirmed: true,
    supplyStartDate: new Date(2026, 0, 1),
    insertionDate: new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    expiryDate: new Date(2026, 8, 30),
    durationMonths: null,
    stornoEndDate: null,
    operationType: "SWITCH",
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
    supplier: { id: "s1", name: "Helios", stornoMonths: 0 },
    commission: {
      id: "cm1",
      expected: 4,
      received: null,
      paid: null,
      stornoDate: null,
      stornoAmount: null,
    },
    recurringMonths: [
      { period: "2026-09", status: "PAID", amount: 4, settledPeriod: "2026-10" },
    ],
  };
  const koRows = expandContractsToProvvigioneRows([base], {
    expandMode: null,
    statoFilter: "Incassato",
    effectiveCompetence: "2026-09",
    now,
    latestMap: new Map([["c-ko", true]]),
    earlyMap: new Map([["c-ko", false]]),
  });
  check("KO switch con rata PAID resta in Incassato", koRows.length, 1);
  check("stato riga = Incassato da liquidare", koRows[0]?.stato, "Incassato da liquidare");

  const liquidatedRows = expandContractsToProvvigioneRows(
    [{ ...base, id: "c-liq", status: "PROVVIGIONE_LIQUIDATA" }],
    {
      expandMode: null,
      statoFilter: "Incassato",
      effectiveCompetence: "2026-09",
      now,
      latestMap: new Map([["c-liq", true]]),
      earlyMap: new Map([["c-liq", false]]),
    },
  );
  check("contratto liquidato con rata PAID resta in Incassato", liquidatedRows.length, 1);
  check(
    "stato riga liquidato+PAID",
    liquidatedRows[0]?.stato,
    "Incassato da liquidare",
  );

  const waiting = expandContractsToProvvigioneRows(
    [{ ...base, id: "c-attesa", status: "IN_ATTESA_PAGAMENTO", recurrence: "M" }],
    {
      expandMode: "incassato",
      statoFilter: "Incassato",
      now,
      latestMap: new Map([["c-attesa", true]]),
      earlyMap: new Map([["c-attesa", false]]),
    },
  );
  check("In attesa con rata PAID resta in Incassato", waiting.length, 1);
  check("stato riga in attesa+PAID", waiting[0]?.stato, "Incassato da liquidare");

  const ut = expandContractsToProvvigioneRows(
    [{ ...base, id: "c-ut", status: "IN_ATTESA_PAGAMENTO", recurrence: "UT" }],
    {
      expandMode: "incassato",
      statoFilter: "Incassato",
      now,
      latestMap: new Map([["c-ut", true]]),
      earlyMap: new Map([["c-ut", false]]),
    },
  );
  check("UT con rata PAID di settembre resta in Incassato", ut.length, 1);
  check("competenza UT", ut[0]?.competencePeriod, "2026-09");
  check(
    "Incassato include In attesa con rata PAID",
    incassato.includes('"status":"IN_ATTESA_PAGAMENTO"') &&
      incassato.includes('"status":"PAID"'),
    true,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion fallite`);
  process.exit(1);
}
console.log("\nTutti i check ok.\n");
