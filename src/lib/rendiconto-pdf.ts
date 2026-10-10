/**
 * PDF del rendiconto. I totali arrivano già calcolati: qui si disegnano
 * solo barre, cornici e tabelle.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  buildRendicontoSummaryRows,
  buildRendicontoSupplierCards,
  formatEuro,
  rendicontoCountLabel,
  rendicontoSupplierCardHeading,
  reportClienteLabel,
  type RendicontoLine,
  type RendicontoSummary,
  type RendicontoSupplierCardModel,
} from "@/lib/report-rendiconto";
import type { ReportExtraLine } from "@/lib/report-extras";
import {
  RENDICONTO_SECTION_THEME,
  hexToRgb,
  rendicontoNettoSwatch,
  rendicontoSummarySwatch,
  rendicontoSupplierTheme,
  type RendicontoSwatch,
} from "@/lib/rendiconto-supplier-theme";

export type RendicontoPdfModel = {
  periodLabel: string;
  statoLabel: string;
  generatedAtLabel: string;
  rendiconto: RendicontoSummary;
  extras: ReportExtraLine[];
  grandNetto: number;
  includeRecurring: boolean;
  includeStornos: boolean;
  collectedHeading: string;
};

const LEFT = 14;
const WIDTH = 182;
const PAGE_BOTTOM = 280;
const MARGIN = { left: LEFT, right: 14, top: 16, bottom: 16 };

type JsWithTable = jsPDF & { lastAutoTable?: { finalY?: number } };

function tableEnd(doc: jsPDF, fallback: number): number {
  const finalY = (doc as JsWithTable).lastAutoTable?.finalY;
  return (finalY ?? fallback) + 5;
}

function need(doc: jsPDF, y: number, height: number): number {
  if (y + height <= PAGE_BOTTOM) return y;
  doc.addPage();
  return 16;
}

function drawBand(
  doc: jsPDF,
  y: number,
  swatch: RendicontoSwatch,
  left: string,
  right?: string,
): number {
  const [fillR, fillG, fillB] = hexToRgb(swatch.bar);
  const [frameR, frameG, frameB] = hexToRgb(swatch.frame);
  const [textR, textG, textB] = hexToRgb(swatch.text);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const leftW = doc.getTextWidth(left);
  doc.setFontSize(9);
  const rightW = right ? doc.getTextWidth(right) : 0;
  const twoLines = Boolean(right) && leftW + rightW > WIDTH - 12;
  const height = twoLines ? 14 : 9;
  y = need(doc, y, height);
  doc.setFillColor(fillR, fillG, fillB);
  doc.setDrawColor(frameR, frameG, frameB);
  doc.setLineWidth(0.45);
  doc.roundedRect(LEFT, y, WIDTH, height, 1.2, 1.2, "FD");
  doc.setTextColor(textR, textG, textB);
  if (twoLines && right) {
    doc.setFontSize(10);
    doc.text(left, LEFT + 3, y + 5.5);
    doc.setFontSize(9);
    doc.text(right, LEFT + 3, y + 11);
  } else {
    doc.setFontSize(10);
    doc.text(left, LEFT + 3, y + 6);
    if (right) {
      doc.setFontSize(9);
      doc.text(right, LEFT + WIDTH - 3, y + 6, { align: "right" });
    }
  }
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.2);
  return y + height + 4;
}

type CardColumn = {
  header: string;
  width: number;
  align?: "left" | "right";
  value: (line: RendicontoLine) => string;
  amount?: boolean;
};

function drawLinesCard(
  doc: jsPDF,
  y: number,
  swatch: RendicontoSwatch,
  title: string,
  lines: RendicontoLine[],
  columns: CardColumn[],
  foot: { label: string; amount: number } | null,
  options?: { columnHead?: boolean },
): number {
  const [barR, barG, barB] = hexToRgb(swatch.bar);
  const [textR, textG, textB] = hexToRgb(swatch.text);
  const [washR, washG, washB] = hexToRgb(swatch.wash);
  const [washTextR, washTextG, washTextB] = hexToRgb(swatch.washText);
  const amountIndex = columns.findIndex((column) => column.amount);
  const columnStyles: Record<number, { cellWidth: number; halign?: "left" | "right" }> = {};
  columns.forEach((column, index) => {
    columnStyles[index] = {
      cellWidth: column.width,
      halign: column.align ?? (column.amount ? "right" : "left"),
    };
  });

  autoTable(doc, {
    startY: y,
    margin: MARGIN,
    tableWidth: WIDTH,
    theme: "grid",
    showHead: "everyPage",
    showFoot: foot ? "lastPage" : "never",
    rowPageBreak: "avoid",
    tableLineWidth: 0.5,
    tableLineColor: hexToRgb(swatch.frame),
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: "linebreak",
      cellPadding: 1.5,
      valign: "middle",
    },
    columnStyles,
    head:
      options?.columnHead === false
        ? [
            [
              {
                content: title,
                colSpan: columns.length,
                styles: { halign: "left" },
              },
            ],
          ]
        : [
            [
              {
                content: title,
                colSpan: columns.length,
                styles: { halign: "left" },
              },
            ],
            columns.map((column) => column.header),
          ],
    body: lines.map((line) => columns.map((column) => column.value(line))),
    foot: foot
      ? [
          [
            {
              content: foot.label,
              colSpan: Math.max(1, columns.length - 1),
              styles: { halign: "left" },
            },
            {
              content: formatEuro(foot.amount),
              styles: { halign: "right" },
            },
          ],
        ]
      : undefined,
    didParseCell: (data) => {
      if (data.section === "head" && data.row.index === 0) {
        data.cell.styles.fillColor = [barR, barG, barB];
        data.cell.styles.textColor = [textR, textG, textB];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 10;
        data.cell.styles.halign = "left";
        data.cell.styles.minCellHeight = 8;
      }
      if (data.section === "head" && data.row.index === 1) {
        data.cell.styles.fillColor = [washR, washG, washB];
        data.cell.styles.textColor = [washTextR, washTextG, washTextB];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 8;
      }
      if (data.section === "foot") {
        data.cell.styles.fillColor = [barR, barG, barB];
        data.cell.styles.textColor = [textR, textG, textB];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 8;
      }
      if (data.section === "body" && data.column.index === amountIndex) {
        const amount = lines[data.row.index]?.amount ?? 0;
        data.cell.styles.textColor = amount < 0 ? [185, 28, 28] : [4, 120, 87];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "right";
      }
    },
  });

  return tableEnd(doc, y);
}

function drawMessageCard(
  doc: jsPDF,
  y: number,
  swatch: RendicontoSwatch,
  title: string,
  message: string,
): number {
  return drawLinesCard(
    doc,
    y,
    swatch,
    title,
    [
      {
        kind: "incassato",
        month: "",
        contractNumber: "",
        clientName: message,
        podPdr: "",
        supplierName: "",
        collaboratorName: "",
        amount: 0,
        dateLabel: "",
      },
    ],
    [
      {
        header: "",
        width: WIDTH,
        value: (line) => line.clientName,
      },
    ],
    null,
    { columnHead: false },
  );
}

const LINE_COLUMNS: CardColumn[] = [
  {
    header: "Cliente",
    width: 86,
    value: (line) => reportClienteLabel(line.clientName, line.podPdr),
  },
  {
    header: "Collab.",
    width: 38,
    value: (line) => line.collaboratorName,
  },
  {
    header: "Data",
    width: 34,
    value: (line) => line.dateLabel,
  },
  {
    header: "Importo",
    width: 24,
    amount: true,
    value: (line) => formatEuro(line.amount),
  },
];

type BodyMark = "month" | "storno" | "ricorrente" | "line";

/** Una sola tabella incorniciata: barra fornitore, poi i mesi dentro. */
function drawSupplierCard(doc: jsPDF, y: number, card: RendicontoSupplierCardModel): number {
  const swatch = rendicontoSupplierTheme(card.supplierName);
  const bar = rendicontoSupplierCardHeading(card);
  const body: (string | { content: string; colSpan?: number; styles?: { halign: "left" | "right" } })[][] = [];
  const marks: BodyMark[] = [];
  const amounts: number[] = [];

  function pushSection(mark: BodyMark, label: string, amount: number) {
    body.push([
      { content: label, colSpan: 3, styles: { halign: "left" } },
      { content: formatEuro(amount), styles: { halign: "right" } },
    ]);
    marks.push(mark);
    amounts.push(amount);
  }

  function pushLines(lines: RendicontoLine[]) {
    for (const line of lines) {
      body.push(LINE_COLUMNS.map((column) => column.value(line)));
      marks.push("line");
      amounts.push(line.amount);
    }
  }

  for (const month of card.months) {
    pushSection(
      "month",
      `${month.label}  ·  ${rendicontoCountLabel(month.count)}`,
      month.subtotal,
    );
    pushLines(month.lines);
  }
  for (const month of card.storniMonths) {
    pushSection(
      "storno",
      `Storni  ·  ${month.label}  ·  ${month.count === 1 ? "1 storno" : `${month.count} storni`}`,
      month.subtotal,
    );
    pushLines(month.lines);
  }
  if (card.ricorrenti.length > 0) {
    pushSection(
      "ricorrente",
      `Rate ricorrenti  ·  ${rendicontoCountLabel(card.ricorrentiCount)}`,
      card.ricorrentiSubtotal,
    );
    pushLines(card.ricorrenti);
  }

  const columnStyles: Record<number, { cellWidth: number; halign?: "left" | "right" }> = {};
  LINE_COLUMNS.forEach((column, index) => {
    columnStyles[index] = {
      cellWidth: column.width,
      halign: column.amount ? "right" : "left",
    };
  });

  autoTable(doc, {
    startY: y,
    margin: MARGIN,
    tableWidth: WIDTH,
    theme: "grid",
    showHead: "everyPage",
    showFoot: "lastPage",
    rowPageBreak: "avoid",
    tableLineWidth: 0.6,
    tableLineColor: hexToRgb(swatch.frame),
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: "linebreak",
      cellPadding: 1.5,
      valign: "middle",
    },
    columnStyles,
    head: [
      [{ content: bar.title, colSpan: 4, styles: { halign: "left" } }],
      LINE_COLUMNS.map((column) => column.header),
    ],
    body,
    foot: [
      [
        { content: bar.foot, colSpan: 3, styles: { halign: "left" } },
        { content: formatEuro(bar.amount), styles: { halign: "right" } },
      ],
    ],
    didParseCell: (data) => {
      if (data.section === "head" && data.row.index === 0) {
        data.cell.styles.fillColor = hexToRgb(swatch.bar);
        data.cell.styles.textColor = hexToRgb(swatch.text);
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 10;
        data.cell.styles.halign = "left";
        data.cell.styles.minCellHeight = 8;
      }
      if (data.section === "head" && data.row.index === 1) {
        data.cell.styles.fillColor = hexToRgb(swatch.wash);
        data.cell.styles.textColor = hexToRgb(swatch.washText);
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section === "foot") {
        data.cell.styles.fillColor = hexToRgb(swatch.bar);
        data.cell.styles.textColor = hexToRgb(swatch.text);
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section !== "body") return;
      const mark = marks[data.row.index];
      if (mark === "month" || mark === "storno" || mark === "ricorrente") {
        const tone =
          mark === "month"
            ? swatch
            : mark === "storno"
              ? RENDICONTO_SECTION_THEME.storni
              : RENDICONTO_SECTION_THEME.ricorrenti;
        data.cell.styles.fillColor = hexToRgb(tone.wash);
        data.cell.styles.textColor = hexToRgb(tone.washText);
        data.cell.styles.fontStyle = "bold";
        return;
      }
      if (data.column.index === 3) {
        const amount = amounts[data.row.index] ?? 0;
        data.cell.styles.textColor = amount < 0 ? [185, 28, 28] : [4, 120, 87];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "right";
      }
    },
  });

  return tableEnd(doc, y);
}

export function buildRendicontoPdfBytes(
  model: RendicontoPdfModel,
  options?: { compress?: boolean },
): Uint8Array {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: options?.compress ?? true,
  });
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Rendiconto Provvigioni", LEFT, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Periodo: ${model.periodLabel}`, LEFT, y);
  y += 5;
  doc.text(
    `Stato: ${model.statoLabel}  ·  Generato ${model.generatedAtLabel}`,
    LEFT,
    y,
  );
  y += 7;

  const summaryRows = buildRendicontoSummaryRows({
    rendiconto: model.rendiconto,
    extras: model.extras,
    includeRecurring: model.includeRecurring,
    grandNetto: model.grandNetto,
  });

  autoTable(doc, {
    startY: y,
    margin: MARGIN,
    tableWidth: WIDTH,
    theme: "grid",
    showHead: "firstPage",
    rowPageBreak: "avoid",
    tableLineWidth: 0.5,
    tableLineColor: hexToRgb(RENDICONTO_SECTION_THEME.dettaglio.frame),
    styles: {
      font: "helvetica",
      fontSize: 9,
      overflow: "linebreak",
      cellPadding: 1.8,
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 102 },
      1: { cellWidth: 40 },
      2: { cellWidth: 40, halign: "right" },
    },
    head: [["Voce", "N° / Note", "Importo"]],
    body: summaryRows.map((row) => [row.label, row.note, formatEuro(row.amount)]),
    headStyles: {
      fillColor: hexToRgb(RENDICONTO_SECTION_THEME.dettaglio.bar),
      textColor: hexToRgb(RENDICONTO_SECTION_THEME.dettaglio.text),
      fontStyle: "bold",
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = summaryRows[data.row.index];
      if (!row) return;
      const swatch = rendicontoSummarySwatch(row);
      data.cell.styles.fillColor = hexToRgb(swatch.bar);
      data.cell.styles.textColor = hexToRgb(swatch.text);
      data.cell.styles.fontStyle = "bold";
      if (data.column.index === 2) data.cell.styles.halign = "right";
    },
  });
  y = tableEnd(doc, y);

  const cards = buildRendicontoSupplierCards(model.rendiconto, {
    includeStornos: model.includeStornos,
    includeRecurring: model.includeRecurring,
  });

  y = drawBand(
    doc,
    y,
    RENDICONTO_SECTION_THEME.dettaglio,
    model.collectedHeading,
  );

  if (cards.length === 0) {
    y = drawMessageCard(
      doc,
      y,
      RENDICONTO_SECTION_THEME.extra,
      "Dettaglio",
      "Nessuna riga nel periodo",
    );
  } else {
    for (const card of cards) {
      y = drawSupplierCard(doc, y, card);
    }
  }

  if (model.rendiconto.months.length > 1) {
    y = drawBand(doc, y, RENDICONTO_SECTION_THEME.dettaglio, "Subtotali netti per mese");
    autoTable(doc, {
      startY: y,
      margin: MARGIN,
      tableWidth: WIDTH,
      theme: "grid",
      tableLineWidth: 0.4,
      tableLineColor: hexToRgb(RENDICONTO_SECTION_THEME.dettaglio.frame),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 1.6 },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 62, halign: "right" },
      },
      body: model.rendiconto.months.map((block) => [
        `Subtotale netto ${block.label}`,
        formatEuro(block.subNetto),
      ]),
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const block = model.rendiconto.months[data.row.index];
        const tone = rendicontoNettoSwatch(block?.subNetto ?? 0);
        data.cell.styles.fillColor = hexToRgb(tone.bar);
        data.cell.styles.textColor = hexToRgb(tone.text);
        data.cell.styles.fontStyle = "bold";
        if (data.column.index === 1) data.cell.styles.halign = "right";
      },
    });
    y = tableEnd(doc, y);
  }

  drawBand(
    doc,
    y,
    rendicontoNettoSwatch(model.grandNetto),
    "TOTALE NETTO",
    formatEuro(model.grandNetto),
  );

  return new Uint8Array(doc.output("arraybuffer"));
}
