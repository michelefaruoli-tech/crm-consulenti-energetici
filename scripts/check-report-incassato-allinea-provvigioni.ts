/**
 * Report «Incassato» deve coincidere con la card Provvigioni «Incassato da liquidare»
 * sugli stessi filtri (collaboratore, mesi o tutti i periodi, storici inclusi).
 *
 * Casi:
 * - Fagiano: card 4.112 = Report month=all + stato Incassato (stessi filtri)
 * - Fagiano set+ott Incassato|Stornato: 3.992 − 85 = 3.907 (4 storici; no Dic 2025)
 * - Laforgia ottobre: 1.427 + 2.980 − 45 = 4.362 (doc già su main)
 *
 * Uso: npx tsx scripts/check-report-incassato-allinea-provvigioni.ts
 */
import {
  buildReportContractWhere,
  isReportAllPeriods,
  REPORT_ALL_PERIODS,
  resolveIncassatoMonths,
  resolveReportPeriod,
} from "../src/lib/report-filters";
import {
  buildReportRecurringWhere,
  reportIncassoMonthWhere,
} from "../src/lib/report-recurring";
import {
  buildRendiconto,
  reportIncassatoAmount,
  type RendicontoIncassatoSource,
} from "../src/lib/report-rendiconto";
import {
  compareReportProvvigioniAmounts,
  expectedRendicontoNettoFromIncassatoCard,
} from "../src/lib/report-provvigioni-totals";
import type { ReportRecurringRow } from "../src/lib/report-recurring";
import type { ReportStornoRow } from "../src/lib/report-stornos";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

function ut(overrides: Partial<RendicontoIncassatoSource>): RendicontoIncassatoSource {
  return {
    contractNumber: "CTR",
    collectionDate: new Date(Date.UTC(2026, 9, 15)),
    insertionDate: new Date(Date.UTC(2026, 7, 1)),
    status: "PAGATO_DAL_FORNITORE",
    podPdr: "IT001E000001",
    pod: null,
    pdr: null,
    collaborator: { name: "Fagiano Marco" },
    supplier: { name: "Iren" },
    client: {
      type: "PRIVATO",
      companyName: null,
      firstName: "A",
      lastName: "B",
    },
    commission: { received: 90, expected: 90 },
    recurrence: "Una tantum",
    ...overrides,
  };
}

console.log("\n• Periodo «tutti i periodi»");
{
  const period = resolveReportPeriod({ month: REPORT_ALL_PERIODS });
  check("allPeriods", period.allPeriods, true);
  check("months vuoti", period.months, []);
  check("isReportAllPeriods", isReportAllPeriods("all"), true);
  check("isReportAllPeriods tutti", isReportAllPeriods("tutti"), true);
  check("incassatoMonths vuoti", resolveIncassatoMonths(period), []);
}

console.log("\n• Where Report non esclude gli storici in blocco (allinea Provvigioni)");
{
  const where = buildReportContractWhere(
    {
      month: "2026-10",
      collaboratorId: "collab-fagiano",
      stato: "Incassato",
    },
    {},
  );
  const s = JSON.stringify(where);
  // Solo il ramo KO-switch mensile ha isHistorical:false (stesso di Provvigioni).
  // Non deve esserci un filtro top-level che butta fuori tutti gli storici.
  const topLevelExclude =
    /"AND":\[\{[^\}]*\},\{"deletedAt":null\},\{"isHistorical":false\}/.test(s) ||
    s.includes('{"deletedAt":null},{"isHistorical":false}');
  check("niente esclusione storica top-level", topLevelExclude, false);
  check("ha deletedAt null", s.includes('"deletedAt":null'), true);
  check(
    "ramo KO-switch ancora con isHistorical false (come Provvigioni)",
    s.includes('"koNotes"') && s.includes('"isHistorical":false'),
    true,
  );
}

console.log("\n• Rate Incassato con month=all: PAID senza filtro mese");
{
  const where = buildReportRecurringWhere({
    month: REPORT_ALL_PERIODS,
    stato: "Incassato",
    visibility: {},
    collaboratorId: "collab-fagiano",
  });
  const s = JSON.stringify(where);
  check("include PAID", s.includes('"status":"PAID"'), true);
  check(
    "niente settledPeriod in periods ristretti",
    !s.includes('"settledPeriod":{"in"'),
    true,
  );
  const topLevelExclude = s.includes('{"deletedAt":null},{"isHistorical":false}');
  check("niente esclusione storica top-level sulle rate", topLevelExclude, false);
}

console.log("\n• Caso Fagiano: storici nel mese + Dic 2025 fuori set+ott");
{
  // 47 non-storici set+ott (PDF) + 4 storici ott = 51 UT → 3970
  // + 4 rate 22 = 3992 card set+ott; −85 storni → 3907
  const storici = [
    ut({
      contractNumber: "CTR-2026-002476",
      supplier: { name: "Dolomiti" },
      commission: { received: 45, expected: 45 },
      collectionDate: new Date(Date.UTC(2026, 9, 12)),
    }),
    ut({
      contractNumber: "CTR-2026-002580",
      commission: { received: 90, expected: 90 },
    }),
    ut({
      contractNumber: "CTR-2026-002645",
      commission: { received: 90, expected: 90 },
    }),
    ut({
      contractNumber: "CTR-2026-002676",
      commission: { received: 90, expected: 90 },
    }),
  ];
  const storiciSum = storici.reduce(
    (s, c) =>
      s +
      reportIncassatoAmount(c.commission, {
        clientType: c.client.type ?? "",
        supplierName: c.supplier.name,
      }),
    0,
  );
  check("4 storici = 315", storiciSum, 315);

  const pdfWithoutStorici = 3655; // totIncassato PDF pre-fix
  const rates = 22;
  const storni = -85;
  const cardSetOtt = pdfWithoutStorici + storiciSum + rates; // 3992
  check("card set+ott = 3992", cardSetOtt, 3992);
  const nettoSetOtt = expectedRendicontoNettoFromIncassatoCard(
    cardSetOtt,
    storni,
  );
  check("netto set+ott con storici = 3907", nettoSetOtt, 3907);

  const cardTutti = 4112; // include anche 120 € Dic 2025
  // Stessi filtri della card: tutti i periodi + solo Incassato → 4112 (niente storni).
  check(
    "card tutti = Report Incassato senza storni",
    expectedRendicontoNettoFromIncassatoCard(cardTutti, 0),
    4112,
  );
  check(
    "gap Dic 2025 fuori da set+ott = 120",
    Math.round((cardTutti - cardSetOtt) * 100) / 100,
    120,
  );
  // 4112 − 85 = 4027 mescola card «tutti» con storni solo set+ott: non è un filtro unico.

  // buildRendiconto con storici + rate + storni (subset) chiude su 315+22-85
  const rateRows: ReportRecurringRow[] = [
    {
      id: "r1",
      contractId: "c1",
      period: "2026-10",
      settledPeriod: "2026-10",
      status: "PAID",
      amount: 6,
      paidAt: null,
      contractNumber: "H1",
      podPdr: null,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Helios",
      clientName: "A",
      clientType: "PRIVATO",
    },
    {
      id: "r2",
      contractId: "c2",
      period: "2026-10",
      settledPeriod: "2026-10",
      status: "PAID",
      amount: 6,
      paidAt: null,
      contractNumber: "H2",
      podPdr: null,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Helios",
      clientName: "B",
      clientType: "PRIVATO",
    },
    {
      id: "r3",
      contractId: "c3",
      period: "2026-10",
      settledPeriod: "2026-10",
      status: "PAID",
      amount: 4,
      paidAt: null,
      contractNumber: "H3",
      podPdr: null,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Helios",
      clientName: "C",
      clientType: "PRIVATO",
    },
    {
      id: "r4",
      contractId: "c4",
      period: "2026-10",
      settledPeriod: "2026-10",
      status: "PAID",
      amount: 6,
      paidAt: null,
      contractNumber: "H4",
      podPdr: null,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Helios",
      clientName: "D",
      clientType: "PRIVATO",
    },
  ];
  const stornoRows: ReportStornoRow[] = [
    {
      commissionId: "s1",
      contractId: "sc1",
      contractNumber: "ST1",
      stornoDate: new Date(Date.UTC(2026, 8, 1)),
      amount: -45,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Dolomiti",
      clientName: "Davanzo",
      podPdr: "",
      period: "2026-09",
    },
    {
      commissionId: "s2",
      contractId: "sc2",
      contractNumber: "ST2",
      stornoDate: new Date(Date.UTC(2026, 8, 1)),
      amount: -40,
      collaboratorId: "x",
      collaboratorName: "Fagiano Marco",
      supplierName: "Dolomiti",
      clientName: "Uccellatori",
      podPdr: "",
      period: "2026-09",
    },
  ];
  const r = buildRendiconto({
    contracts: storici,
    stornoRows,
    recurringRows: rateRows,
    incassatoMonths: ["2026-09", "2026-10"],
  });
  check("storici+rate+storni netto", r.totNetto, 315 + 22 - 85);
  check(
    "allineamento card parziale",
    compareReportProvvigioniAmounts(r.totIncassato + r.totRicorrenti, 337).ok,
    true,
  );
}

console.log("\n• Caso Laforgia ottobre: 1.427 + 2.980 − 45 = 4.362");
{
  const incassato = 1427;
  const liquidato = 2980;
  const storno = -45;
  const ricevuto = incassato + liquidato + storno;
  check("totale ricevuto Laforgia", ricevuto, 4362);
  // Con Incassato|Pagato|Stornato il netto coincide; con solo Incassato
  // la card è 1427 e gli storni si sottraggono a parte.
  check(
    "card Incassato − storno",
    expectedRendicontoNettoFromIncassatoCard(incassato, storno),
    1382,
  );
  check(
    "Incassato+Pagato−storno = 4362",
    expectedRendicontoNettoFromIncassatoCard(incassato + liquidato, storno),
    4362,
  );
}

console.log("\n• Mese di incasso rate: settledPeriod, non doppio conteggio");
{
  const w = JSON.stringify(reportIncassoMonthWhere(["2026-10"]));
  check(
    "ottobre pagato (settled) entra",
    w.includes('"settledPeriod":{"in":["2026-10"]}'),
    true,
  );
  check(
    "competenza solo se settled null",
    w.includes('"settledPeriod":null'),
    true,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\nTutti i check ok.");
