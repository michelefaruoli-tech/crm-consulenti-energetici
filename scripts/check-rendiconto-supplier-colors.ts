/**
 * Colori, cornice per fornitore e ordine alfabetico del rendiconto.
 * Non usa il database: stessi totali di buildRendiconto, solo presentazione.
 *
 * Uso: npx tsx scripts/check-rendiconto-supplier-colors.ts
 * Anteprima: RENDICONTO_PREVIEW_DIR=/opt/cursor/artifacts npx tsx scripts/check-rendiconto-supplier-colors.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RendicontoSchede } from "../src/components/report/rendiconto-schede";
import { buildRendicontoPdfBytes } from "../src/lib/rendiconto-pdf";
import { writeRendicontoSupplierCards } from "../src/lib/rendiconto-excel";
import {
  RENDICONTO_FALLBACK_THEMES,
  RENDICONTO_SECTION_THEME,
  hexToRgb,
  namedRendicontoThemes,
  rendicontoSupplierTheme,
  type RendicontoSwatch,
} from "../src/lib/rendiconto-supplier-theme";
import {
  buildRendiconto,
  buildRendicontoSupplierCards,
  compareRendicontoLines,
  groupLinesBySupplier,
  rendicontoCollectedHeading,
  rendicontoSupplierCardHeading,
  type RendicontoIncassatoSource,
  type RendicontoLine,
} from "../src/lib/report-rendiconto";
import type { ReportRecurringRow } from "../src/lib/report-recurring";
import type { ReportStornoRow } from "../src/lib/report-stornos";

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (!ok) failures++;
  console.log(`   ${ok ? "ok " : "KO "} ${label}${detail ? `: ${detail}` : ""}`);
}

function same(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? undefined : `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
}

function relLum(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const left = relLum(a);
  const right = relLum(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertSwatch(swatch: RendicontoSwatch): void {
  const barText = contrast(swatch.bar, swatch.text);
  const washText = contrast(swatch.wash, swatch.washText);
  check(
    `${swatch.id} contrasto barra ${barText.toFixed(2)}`,
    barText >= 4.5,
  );
  check(
    `${swatch.id} contrasto wash ${washText.toFixed(2)}`,
    washText >= 4.5,
  );
  const lightBar = relLum(swatch.bar) > 0.4;
  const lightText = relLum(swatch.text) > 0.4;
  check(`${swatch.id} testo leggibile sulla barra`, lightBar !== lightText);
}

function contract(opts: {
  number: string;
  supplier: string;
  lastName: string;
  firstName?: string;
  companyName?: string;
  type?: "PRIVATO" | "AZIENDA";
  amount: number;
  year: number;
  month: number;
  day: number;
  pod?: string;
}): RendicontoIncassatoSource {
  return {
    contractNumber: opts.number,
    collectionDate: new Date(Date.UTC(opts.year, opts.month - 1, opts.day)),
    insertionDate: new Date(Date.UTC(opts.year, opts.month - 1, 1)),
    status: "INCASSATO",
    podPdr: opts.pod ?? `POD-${opts.number}`,
    pod: null,
    pdr: null,
    collaborator: { name: "Anna Collab" },
    supplier: { name: opts.supplier },
    client: {
      type: opts.type ?? "PRIVATO",
      companyName: opts.companyName ?? null,
      firstName: opts.firstName ?? "",
      lastName: opts.lastName,
    },
    commission: { received: 0, expected: opts.amount },
    recurrence: null,
  };
}

function storno(opts: {
  number: string;
  supplier: string;
  clientName: string;
  amount: number;
  period: string;
  pod?: string;
}): ReportStornoRow {
  const [year, month, day] = [opts.period.slice(0, 4), opts.period.slice(5, 7), "15"];
  return {
    commissionId: `c-${opts.number}`,
    contractId: `k-${opts.number}`,
    contractNumber: opts.number,
    stornoDate: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
    amount: opts.amount,
    collaboratorId: "collab-1",
    collaboratorName: "Anna Collab",
    supplierName: opts.supplier,
    clientName: opts.clientName,
    podPdr: opts.pod ?? `POD-${opts.number}`,
    period: opts.period,
  };
}

function recurring(opts: {
  number: string;
  supplier: string;
  clientName: string;
  amount: number;
  period: string;
}): ReportRecurringRow {
  return {
    id: `r-${opts.number}-${opts.period}`,
    contractId: `k-${opts.number}`,
    period: opts.period,
    settledPeriod: opts.period,
    amount: opts.amount,
    paidAt: new Date(Date.UTC(2026, 8, 1)),
    contractNumber: opts.number,
    podPdr: `POD-${opts.number}`,
    collaboratorId: "collab-1",
    collaboratorName: "Anna Collab",
    supplierName: opts.supplier,
    clientName: opts.clientName,
    clientType: "PRIVATO",
  };
}

function line(partial: Partial<RendicontoLine> & Pick<RendicontoLine, "clientName">): RendicontoLine {
  return {
    kind: "incassato",
    month: "2026-09",
    contractNumber: partial.contractNumber ?? "1",
    clientName: partial.clientName,
    podPdr: partial.podPdr ?? "",
    supplierName: partial.supplierName ?? "Iren",
    collaboratorName: "Anna",
    amount: partial.amount ?? 10,
    dateLabel: partial.dateLabel ?? "2026-09-01",
  };
}

console.log("— colori stabili —");
const plenitudeBar = rendicontoSupplierTheme("Plenitude").bar;
for (const name of ["Plenitude", "Eni", "Eni Plenitude", "ENI", "eni gas"]) {
  same(`${name} → plenitude`, rendicontoSupplierTheme(name).id, "plenitude");
  same(`${name} stessa barra`, rendicontoSupplierTheme(name).bar, plenitudeBar);
}
for (const name of ["Enel", "Enel Energia", "ENEL BOX"]) {
  same(`${name} → enel`, rendicontoSupplierTheme(name).id, "enel");
}
check(
  "Enel diverso da Iren e Plenitude",
  rendicontoSupplierTheme("Enel").id !== rendicontoSupplierTheme("Iren").id &&
    rendicontoSupplierTheme("Enel").bar !== rendicontoSupplierTheme("Plenitude").bar,
);
same("SEV Iren", rendicontoSupplierTheme("SEV Iren").id, "iren");
same("Sorgenia Business", rendicontoSupplierTheme("Sorgenia Business").id, "sorgenia");
same("Etruria Energy", rendicontoSupplierTheme("Etruria Energy").id, "etruria");
same("Sinergy", rendicontoSupplierTheme("Sinergy").id, "sinergy");
same("Synergy Luce", rendicontoSupplierTheme("Synergy Luce").id, "sinergy");
same("Helios", rendicontoSupplierTheme("Helios").id, "helios");
same("Edison Energia", rendicontoSupplierTheme("Edison Energia").id, "edison");
same("Dolomiti Energia", rendicontoSupplierTheme("Dolomiti Energia").id, "dolomiti");
same("Duferco Energia", rendicontoSupplierTheme("Duferco Energia").id, "duferco");
same("Acea Energia", rendicontoSupplierTheme("Acea Energia").id, "acea");
same("Engie", rendicontoSupplierTheme("Engie").id, "engie");
for (const name of ["Foo Energia", "Energia Srl", "Genio"]) {
  const id = rendicontoSupplierTheme(name).id;
  check(`${name} non è Enel/Plenitude`, id !== "enel" && id !== "plenitude", id);
}
same("(senza fornitore)", rendicontoSupplierTheme("(senza fornitore)").id, "senza");
same("vuoto", rendicontoSupplierTheme("").id, "senza");
same("null", rendicontoSupplierTheme(null).id, "senza");
const unionA = rendicontoSupplierTheme("Union Gas");
const unionB = rendicontoSupplierTheme("Union Gas");
same("Union Gas stabile", unionA.id, unionB.id);
check("Union Gas è un colore di riserva", unionA.id.startsWith("altro-"), unionA.id);

const named = namedRendicontoThemes();
const namedBars = new Set(named.map((swatch) => swatch.bar));
same("barre nominate tutte diverse", namedBars.size, named.length);
for (const swatch of RENDICONTO_FALLBACK_THEMES) {
  check(`riserva ${swatch.id} non riusa una barra nota`, !namedBars.has(swatch.bar));
}
for (const swatch of [
  ...named,
  ...RENDICONTO_FALLBACK_THEMES,
  ...Object.values(RENDICONTO_SECTION_THEME),
  rendicontoSupplierTheme(""),
]) {
  assertSwatch(swatch);
}

console.log("— ordine alfabetico —");
const messy = [
  line({ clientName: "zeta", contractNumber: "9" }),
  line({ clientName: "MARIO", contractNumber: "2", podPdr: "B" }),
  line({ clientName: "mario", contractNumber: "1", podPdr: "A" }),
  line({ clientName: "alfa", contractNumber: "3" }),
];
const before = messy.map((row) => row.clientName);
const grouped = groupLinesBySupplier(messy);
same("l’array di partenza non cambia", messy.map((row) => row.clientName), before);
same(
  "nominativi A→Z senza distinguere maiuscole",
  grouped[0]?.lines.map((row) => `${row.clientName}|${row.podPdr}`),
  ["alfa|", "mario|A", "MARIO|B", "zeta|"],
);
check(
  "MARIO e mario sono equivalenti",
  compareRendicontoLines(
    line({ clientName: "MARIO" }),
    line({ clientName: "mario" }),
  ) === 0,
);

console.log("— schede: un fornitore, mesi dentro —");
const plenitudeContracts = Array.from({ length: 24 }, (_, index) => {
  const n = 24 - index;
  return contract({
    number: `P${String(n).padStart(2, "0")}`,
    supplier: "Plenitude",
    lastName: `Cliente ${String(n).padStart(2, "0")}`,
    amount: 10,
    year: 2026,
    month: 10,
    day: 2,
  });
});
const rendiconto = buildRendiconto({
  contracts: [
    contract({
      number: "E1",
      supplier: "Enel Energia",
      lastName: "Bianchi",
      amount: 390,
      year: 2026,
      month: 9,
      day: 3,
    }),
    contract({
      number: "I2",
      supplier: "Iren",
      lastName: "zeta",
      amount: 50,
      year: 2026,
      month: 9,
      day: 4,
    }),
    contract({
      number: "I1",
      supplier: "Iren",
      lastName: "ALFA",
      amount: 100,
      year: 2026,
      month: 9,
      day: 5,
    }),
    contract({
      number: "I3",
      supplier: "Iren",
      lastName: "MARIO",
      firstName: "",
      amount: 40,
      year: 2026,
      month: 10,
      day: 6,
      pod: "POD-B",
    }),
    contract({
      number: "I4",
      supplier: "Iren",
      lastName: "mario",
      amount: 80,
      year: 2026,
      month: 10,
      day: 7,
      pod: "POD-A",
    }),
    contract({
      number: "PL",
      supplier: "Plenitude",
      lastName: "",
      companyName:
        "Agenzia Commerciale Molto Lunga Per Verificare Lo Scorrimento Del Testo",
      type: "AZIENDA",
      amount: 50,
      year: 2026,
      month: 10,
      day: 8,
    }),
    ...plenitudeContracts,
  ],
  stornoRows: [
    storno({
      number: "IS",
      supplier: "Iren",
      clientName: "Neri",
      amount: -30,
      period: "2026-10",
    }),
    storno({
      number: "AS",
      supplier: "Acea Energia",
      clientName: "Verdi Storno",
      amount: -15,
      period: "2026-09",
    }),
  ],
  recurringRows: [
    recurring({
      number: "ER",
      supplier: "Enel Energia",
      clientName: "Verdi",
      amount: 12,
      period: "2026-09",
    }),
  ],
  incassatoMonths: ["2026-09", "2026-10"],
});

const cards = buildRendicontoSupplierCards(rendiconto, {
  includeStornos: true,
  includeRecurring: true,
});
same(
  "fornitori in ordine alfabetico",
  cards.map((card) => card.supplierName),
  ["Acea Energia", "Enel Energia", "Iren", "Plenitude"].sort((a, b) =>
    a.localeCompare(b, "it", { sensitivity: "base" }),
  ),
);
const iren = cards.find((card) => card.supplierName === "Iren");
const enel = cards.find((card) => card.supplierName === "Enel Energia");
const plenitude = cards.find((card) => card.supplierName === "Plenitude");
const acea = cards.find((card) => card.supplierName === "Acea Energia");
check("una sola scheda Iren", cards.filter((card) => card.supplierName === "Iren").length === 1);
same(
  "mesi Iren in ordine cronologico",
  iren?.months.map((month) => month.month),
  ["2026-09", "2026-10"],
);
same(
  "nomi Iren di settembre",
  iren?.months[0]?.lines.map((row) => row.clientName),
  ["ALFA", "zeta"],
);
same(
  "nomi Iren di ottobre",
  iren?.months[1]?.lines.map((row) => `${row.clientName}|${row.podPdr}`),
  ["mario|POD-A", "MARIO|POD-B"],
);
const officialIren = rendiconto.incassatoBySupplier.find((row) => row.supplierName === "Iren");
same("subtotale Iren ufficiale", iren?.incassatoSubtotal, officialIren?.subtotal);
same(
  "subtotale Iren = somma dei mesi",
  iren?.incassatoSubtotal,
  (iren?.months ?? []).reduce((sum, month) => sum + month.subtotal, 0),
);
same("conteggio Iren", iren?.incassatoCount, 4);
same("storni Iren nella stessa scheda", iren?.storniSubtotal, -30);
same("totale storni invariato", rendiconto.totStorni, -45);
same("Acea è solo storno", acea?.months.length, 0);
same("importo barra Acea", rendicontoSupplierCardHeading(acea!).amount, -15);
same("Enel non assorbe la rata", rendicontoSupplierCardHeading(enel!).amount, 390);
same("ricorrente Enel dentro la scheda", enel?.ricorrentiSubtotal, 12);
same("Plenitude 25 righe", plenitude?.incassatoCount, 25);
same(
  "Plenitude subtotale ufficiale",
  plenitude?.incassatoSubtotal,
    rendiconto.incassatoBySupplier.find((row) => row.supplierName === "Plenitude")?.subtotal,
);
const longName = plenitude?.months[0]?.lines[0]?.clientName ?? "";
check(
  "il nominativo lungo resta primo in Plenitude",
  longName.startsWith("Agenzia Commerciale"),
  longName,
);

same("Da incassare", rendicontoCollectedHeading(["Da incassare"]), "Da incassare per fornitore");
same("Incassato", rendicontoCollectedHeading(["Incassato"]), "Incassato per fornitore");
same("Tutti", rendicontoCollectedHeading(["Tutti"]), "Incassato per fornitore");
same(
  "Da incassare + Incassato",
  rendicontoCollectedHeading(["Da incassare", "Incassato"]),
  "Incassato per fornitore",
);

console.log("— excel: cornice per fornitore —");
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Rendiconto");
writeRendicontoSupplierCards(sheet, cards, rendiconto.months);
const rows: string[] = [];
sheet.eachRow((row) => {
  rows.push(String(row.getCell(1).value ?? ""));
});
function blockBetween(start: string, end: string): string[] {
  const from = rows.findIndex((value) => value === start);
  const to = rows.findIndex((value, index) => index > from && value === end);
  return rows.slice(from, to + 1);
}
const irenHeading = rendicontoSupplierCardHeading(iren!);
const irenBlock = blockBetween(irenHeading.title, irenHeading.foot);
check("blocco Iren trovato", irenBlock.length > 2, irenBlock[0]);
check(
  "settembre e ottobre stanno dentro Iren",
  irenBlock.some((value) => value.startsWith("Settembre 2026")) &&
    irenBlock.some((value) => value.startsWith("Ottobre 2026")) &&
    irenBlock.some((value) => value.startsWith("Storni")),
);
check(
  "nessun altro fornitore dentro Iren",
  !irenBlock.some((value) => value.startsWith("Enel") || value.startsWith("Plenitude") || value.startsWith("Eni")),
);
const septemberNet = sheet.getRows(1, sheet.rowCount)?.find((row) =>
  String(row?.getCell(1).value ?? "").startsWith("Subtotale netto Settembre 2026"),
);
const septemberBlock = rendiconto.months.find((month) => month.month === "2026-09");
same(
  "subtotale netto settembre invariato",
  Number(septemberNet?.getCell(6).value),
  septemberBlock?.subNetto,
);

console.log("— pdf e anteprima —");
const pdf = buildRendicontoPdfBytes(
  {
    periodLabel: "Settembre 2026 + Ottobre 2026",
    statoLabel: "Incassato",
    generatedAtLabel: "10/10/2026, 12:00:00",
    rendiconto,
    extras: [{ tipologia: "Acconti precedenti", amount: 0, note: "" }],
    grandNetto: rendiconto.totNetto,
    includeRecurring: true,
    includeStornos: true,
    collectedHeading: "Incassato per fornitore",
  },
  { compress: false },
);
const pdfText = Buffer.from(pdf).toString("latin1");
check("pdf", pdfText.startsWith("%PDF"));
for (const name of ["Plenitude", "Iren", "Enel"]) {
  check(`pdf contiene ${name}`, pdfText.includes(name));
}
const subtotalHits = pdfText.split("Subtotale Plenitude").length - 1;
check(
  "il subtotale Plenitude non si ripete a metà tabella",
  subtotalHits === 1,
  `occorrenze ${subtotalHits}`,
);

const html = renderToStaticMarkup(
  createElement(RendicontoSchede, {
    rendiconto,
    includeStornos: true,
    includeRecurring: true,
  }),
);
const htmlFold = html.toLowerCase();
check("html Enel", html.includes("Enel Energia"));
check("html Iren", html.includes(">Iren<") || html.includes("Iren"));
check("html Plenitude", html.includes("Plenitude"));
for (const hex of ["#166534", "#c2410c", "#f5c518"]) {
  check(`html colore ${hex}`, htmlFold.includes(hex));
}
const articles = html.split("<article").slice(1);
same("un riquadro html per fornitore", articles.length, cards.length);
const irenHtml = articles.find((article) => article.includes(">Iren<")) ?? "";
check(
  "mesi dentro il riquadro Iren",
  irenHtml.includes("Settembre 2026") && irenHtml.includes("Ottobre 2026"),
);
check(
  "ordine alfabetico nel riquadro Iren",
  irenHtml.indexOf("ALFA") !== -1 &&
    irenHtml.indexOf("ALFA") < irenHtml.indexOf("zeta"),
);

const previewDir = process.env.RENDICONTO_PREVIEW_DIR;
if (previewDir) {
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(join(previewDir, "rendiconto-sample.pdf"), pdf);
  const page = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Rendiconto per fornitore</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #0f172a; font-family: ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 72rem; margin: 0 auto; padding: 1.5rem; }
    .space-y-4 > * + * { margin-top: 1rem; }
    .space-y-2 > * + * { margin-top: 0.5rem; }
    article, section { background: white; }
    .rounded-2xl { border-radius: 1rem; }
    .rounded-xl { border-radius: 0.75rem; }
    .rounded-lg { border-radius: 0.5rem; }
    .rounded-md { border-radius: 0.375rem; }
    .border-2 { border-width: 2px; border-style: solid; }
    .border { border-width: 1px; border-style: solid; }
    .border-slate-300 { border-color: #cbd5e1; }
    .shadow-sm { box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); }
    .overflow-hidden { overflow: hidden; }
    .overflow-x-auto { overflow-x: auto; }
    .px-4 { padding-left: 1rem; padding-right: 1rem; }
    .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
    .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
    .py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
    .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
    .py-1\\.5, .py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
    .py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
    .p-3 { padding: 0.75rem; }
    .flex { display: flex; }
    .flex-wrap { flex-wrap: wrap; }
    .items-baseline { align-items: baseline; }
    .justify-between { justify-content: space-between; }
    .gap-2 { gap: 0.5rem; }
    .text-sm { font-size: 0.875rem; }
    .text-xs { font-size: 0.75rem; }
    .text-base { font-size: 1rem; }
    .font-semibold { font-weight: 600; }
    .font-medium { font-weight: 500; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .uppercase { text-transform: uppercase; letter-spacing: 0.04em; }
    .text-slate-500 { color: #64748b; }
    .text-slate-600 { color: #475569; }
    .text-slate-700 { color: #334155; }
    .text-slate-900 { color: #0f172a; }
    .text-rose-700 { color: #be123c; }
    .text-emerald-800 { color: #065f46; }
    .whitespace-nowrap { white-space: nowrap; }
    .w-full { width: 100%; }
    .min-w-\\[36rem\\] { min-width: 36rem; }
    table { border-collapse: collapse; }
    .border-b { border-bottom: 1px solid #e2e8f0; }
    .border-t { border-top: 1px solid #f1f5f9; }
    .ml-2 { margin-left: 0.5rem; }
    h2, h3, h4, p { margin: 0; }
    ul { list-style: none; margin: 0; padding: 0; }
  </style>
</head>
<body><main>${html}</main></body>
</html>`;
  writeFileSync(join(previewDir, "rendiconto-schede.html"), page);
  console.log(`   anteprima in ${previewDir}`);
}

if (failures > 0) {
  console.error(`\n${failures} controlli falliti`);
  process.exit(1);
}
console.log("\nRendiconto colori e layout: ok");
