/**
 * Documenti di liquidazione (Excel e PDF) generati dallo snapshot del ciclo.
 *
 * Lo snapshot è la fonte: il documento si rigenera identico anche dopo nuove
 * rettifiche, e nulla viene salvato come base64 nel database.
 *
 * Il rendiconto generico resta `/api/report/excel?collaboratorId=`: risponde a
 * un'altra domanda (contratti filtrati per periodo e stato) e non conosce le
 * rettifiche manuali di un ciclo.
 */

import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { periodLabel } from "@/lib/recurring";
import { PAYOUT_ADJUSTMENT_LABEL } from "@/lib/payout/adjustment-labels";
import type { PayoutReportSnapshot } from "@/lib/payout/totals";

/** Palette allineata ai report esistenti del CRM. */
const COLOR_HEADER = "FF334155";
const COLOR_TOTAL = "FF065F46";
const COLOR_ADJUST = "FFB45309";

function euro(n: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function styleHeaderRow(row: ExcelJS.Row, fill: string) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
}

function styleTotalRow(row: ExcelJS.Row, fill: string) {
  row.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
}

export function payoutReportFileBase(snapshot: PayoutReportSnapshot): string {
  const name = snapshot.collaboratorName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `liquidazione-${snapshot.period}-${name || "collaboratore"}-v${snapshot.version}`;
}

export async function buildPayoutReportXlsx(
  snapshot: PayoutReportSnapshot,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Energia";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Liquidazione");
  sheet.columns = [
    { width: 30 },
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 12 },
    { width: 14 },
  ];

  const title = sheet.addRow([`LIQUIDAZIONE PROVVIGIONI`]);
  title.font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  sheet.mergeCells(title.number, 1, title.number, 6);

  sheet.addRow([`Collaboratore`, snapshot.collaboratorName]);
  sheet.addRow([`Periodo`, periodLabel(snapshot.period)]);
  sheet.addRow([`Ciclo`, snapshot.runLabel]);
  sheet.addRow([`Versione report`, snapshot.version]);
  sheet.addRow([
    `Generato`,
    new Date(snapshot.generatedAt).toLocaleString("it-IT"),
  ]);
  sheet.addRow([]);

  const detailHeader = sheet.addRow([
    "Cliente",
    "POD/PDR",
    "Fornitore",
    "Fonte",
    "Competenza",
    "Importo €",
  ]);
  styleHeaderRow(detailHeader, COLOR_HEADER);

  for (const row of snapshot.rows) {
    const r = sheet.addRow([
      row.clientName,
      row.podPdr,
      row.supplierName,
      row.sourceName,
      row.period ? periodLabel(row.period) : "",
      row.amount,
    ]);
    r.getCell(6).numFmt = "#,##0.00";
  }
  if (snapshot.rows.length === 0) {
    sheet.addRow(["(nessuna riga importata)", "", "", "", "", 0]);
  }

  const importedRow = sheet.addRow([
    "Totale da rendiconti",
    `${snapshot.rows.length} righe`,
    "",
    "",
    "",
    snapshot.importedTotal,
  ]);
  styleTotalRow(importedRow, COLOR_HEADER);
  importedRow.getCell(6).numFmt = "#,##0.00";
  sheet.addRow([]);

  if (snapshot.adjustments.length > 0) {
    const adjHeader = sheet.addRow([
      "Rettifica",
      "Nota",
      "Inserita da",
      "Data",
      "",
      "Importo €",
    ]);
    styleHeaderRow(adjHeader, COLOR_ADJUST);
    for (const adj of snapshot.adjustments) {
      const r = sheet.addRow([
        PAYOUT_ADJUSTMENT_LABEL[adj.kind] ?? adj.kind,
        adj.note,
        adj.authorName,
        new Date(adj.createdAt).toLocaleDateString("it-IT"),
        "",
        adj.amount,
      ]);
      r.getCell(6).numFmt = "#,##0.00";
      if (adj.amount < 0) {
        r.getCell(6).font = { color: { argb: "FFB91C1C" }, bold: true };
      }
    }
    const adjTotal = sheet.addRow([
      "Totale rettifiche",
      `${snapshot.adjustments.length} voci`,
      "",
      "",
      "",
      snapshot.adjustmentsTotal,
    ]);
    styleTotalRow(adjTotal, COLOR_ADJUST);
    adjTotal.getCell(6).numFmt = "#,##0.00";
    sheet.addRow([]);
  }

  const netRow = sheet.addRow([
    "NETTO DA LIQUIDARE",
    "",
    "",
    "",
    "",
    snapshot.netTotal,
  ]);
  styleTotalRow(netRow, COLOR_TOTAL);
  netRow.getCell(6).numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function buildPayoutReportPdf(snapshot: PayoutReportSnapshot): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(16);
  doc.text("Liquidazione provvigioni", 40, 40);
  doc.setFontSize(10);
  doc.text(
    [
      `Collaboratore: ${snapshot.collaboratorName}`,
      `Periodo: ${periodLabel(snapshot.period)}`,
      `Ciclo: ${snapshot.runLabel} — versione report ${snapshot.version}`,
      `Generato: ${new Date(snapshot.generatedAt).toLocaleString("it-IT")}`,
    ].join("\n"),
    40,
    60,
  );

  autoTable(doc, {
    startY: 120,
    head: [
      ["Cliente", "POD/PDR", "Fornitore", "Fonte", "Competenza", "Importo"],
    ],
    body:
      snapshot.rows.length > 0
        ? snapshot.rows.map((row) => [
            row.clientName,
            row.podPdr,
            row.supplierName,
            row.sourceName,
            row.period ? periodLabel(row.period) : "",
            euro(row.amount),
          ])
        : [["(nessuna riga importata)", "", "", "", "", euro(0)]],
    foot: [
      [
        "Totale da rendiconti",
        `${snapshot.rows.length} righe`,
        "",
        "",
        "",
        euro(snapshot.importedTotal),
      ],
    ],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [51, 65, 85] },
    footStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: "bold" },
    columnStyles: { 5: { halign: "right" } },
  });

  type WithAutoTable = { lastAutoTable?: { finalY?: number } };
  const afterRows =
    (doc as unknown as WithAutoTable).lastAutoTable?.finalY ?? 160;

  if (snapshot.adjustments.length > 0) {
    autoTable(doc, {
      startY: afterRows + 24,
      head: [["Rettifica", "Nota", "Inserita da", "Data", "Importo"]],
      body: snapshot.adjustments.map((adj) => [
        PAYOUT_ADJUSTMENT_LABEL[adj.kind] ?? adj.kind,
        adj.note,
        adj.authorName,
        new Date(adj.createdAt).toLocaleDateString("it-IT"),
        euro(adj.amount),
      ]),
      foot: [
        [
          "Totale rettifiche",
          `${snapshot.adjustments.length} voci`,
          "",
          "",
          euro(snapshot.adjustmentsTotal),
        ],
      ],
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [180, 83, 9] },
      footStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: "bold" },
      columnStyles: { 4: { halign: "right" } },
    });
  }

  const afterAdjustments =
    (doc as unknown as WithAutoTable).lastAutoTable?.finalY ?? afterRows;

  autoTable(doc, {
    startY: afterAdjustments + 24,
    body: [["NETTO DA LIQUIDARE", euro(snapshot.netTotal)]],
    styles: { fontSize: 12, cellPadding: 6, fontStyle: "bold" },
    bodyStyles: { fillColor: [6, 95, 70], textColor: 255 },
    columnStyles: { 1: { halign: "right" } },
  });

  return Buffer.from(doc.output("arraybuffer"));
}
