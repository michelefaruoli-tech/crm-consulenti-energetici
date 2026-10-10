/**
 * Foglio Excel del rendiconto: una cornice per fornitore, mesi dentro.
 * Gli importi sono quelli già calcolati nelle schede.
 */
import ExcelJS from "exceljs";
import {
  rendicontoCountLabel,
  rendicontoSupplierCardHeading,
  reportClienteLabel,
  type RendicontoLine,
  type RendicontoMonthBlock,
  type RendicontoSupplierCardModel,
} from "@/lib/report-rendiconto";
import {
  RENDICONTO_SECTION_THEME,
  hexToArgb,
  rendicontoNettoSwatch,
  rendicontoSupplierTheme,
  type RendicontoSwatch,
} from "@/lib/rendiconto-supplier-theme";

export function paintBarRow(
  row: ExcelJS.Row,
  swatch: RendicontoSwatch,
  size = 12,
): void {
  const text = hexToArgb(swatch.text);
  const bar = hexToArgb(swatch.bar);
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size, color: { argb: text } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: bar },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

export function paintAmountOnBar(
  cell: ExcelJS.Cell,
  swatch: RendicontoSwatch,
  size = 11,
): void {
  cell.numFmt = "#,##0.00";
  cell.font = { bold: true, size, color: { argb: hexToArgb(swatch.text) } };
  cell.alignment = { vertical: "middle", horizontal: "right" };
}

export function frameBlock(
  sheet: ExcelJS.Worksheet,
  fromRow: number,
  toRow: number,
  cols: number,
  argb: string,
): void {
  const thick: ExcelJS.Border = { style: "medium", color: { argb } };
  const thin: ExcelJS.Border = { style: "thin", color: { argb: "FFE2E8F0" } };
  for (let r = fromRow; r <= toRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.border = {
        top: r === fromRow ? thick : thin,
        bottom: r === toRow ? thick : thin,
        left: c === 1 ? thick : thin,
        right: c === cols ? thick : thin,
      };
    }
  }
}

function paintWashRow(row: ExcelJS.Row, swatch: RendicontoSwatch): void {
  paintBarRow(
    row,
    { ...swatch, bar: swatch.wash, text: swatch.washText },
    11,
  );
}

function writeLines(
  sheet: ExcelJS.Worksheet,
  section: string,
  lines: RendicontoLine[],
  swatch: RendicontoSwatch,
): void {
  for (const line of lines) {
    const row = sheet.addRow([
      section,
      reportClienteLabel(line.clientName, line.podPdr),
      line.supplierName,
      line.collaboratorName,
      line.dateLabel,
      line.amount,
    ]);
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(6).font = {
      bold: true,
      color: { argb: line.amount < 0 ? "FFB91C1C" : "FF047857" },
    };
    const chip = row.getCell(3);
    chip.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: hexToArgb(swatch.bar) },
    };
    chip.font = { bold: true, color: { argb: hexToArgb(swatch.text) } };
  }
}

function writeSupplierCard(
  sheet: ExcelJS.Worksheet,
  card: RendicontoSupplierCardModel,
): void {
  const theme = rendicontoSupplierTheme(card.supplierName);
  const heading = rendicontoSupplierCardHeading(card);
  const title = sheet.addRow([
    heading.title,
    "",
    "",
    "",
    "",
    heading.amount,
  ]);
  sheet.mergeCells(title.number, 1, title.number, 5);
  paintBarRow(title, theme, 12);
  paintAmountOnBar(title.getCell(6), theme, 12);
  const start = title.number;

  for (const month of card.months) {
    const monthRow = sheet.addRow([
      `${month.label}  ·  ${rendicontoCountLabel(month.count)}`,
      "",
      "",
      "",
      "",
      month.subtotal,
    ]);
    sheet.mergeCells(monthRow.number, 1, monthRow.number, 5);
    paintWashRow(monthRow, theme);
    paintAmountOnBar(
      monthRow.getCell(6),
      { ...theme, bar: theme.wash, text: theme.washText },
      11,
    );
    writeLines(sheet, "Incassato", month.lines, theme);
  }

  for (const month of card.storniMonths) {
    const label =
      month.count === 1 ? "1 storno" : `${month.count} storni`;
    const monthRow = sheet.addRow([
      `Storni  ·  ${month.label}  ·  ${label}`,
      "",
      "",
      "",
      "",
      month.subtotal,
    ]);
    sheet.mergeCells(monthRow.number, 1, monthRow.number, 5);
    paintWashRow(monthRow, RENDICONTO_SECTION_THEME.storni);
    paintAmountOnBar(
      monthRow.getCell(6),
      {
        ...RENDICONTO_SECTION_THEME.storni,
        bar: RENDICONTO_SECTION_THEME.storni.wash,
        text: RENDICONTO_SECTION_THEME.storni.washText,
      },
      11,
    );
    writeLines(sheet, "Storno", month.lines, theme);
  }

  if (card.ricorrenti.length > 0) {
    const monthRow = sheet.addRow([
      `Rate ricorrenti  ·  ${rendicontoCountLabel(card.ricorrentiCount)}`,
      "",
      "",
      "",
      "",
      card.ricorrentiSubtotal,
    ]);
    sheet.mergeCells(monthRow.number, 1, monthRow.number, 5);
    paintWashRow(monthRow, RENDICONTO_SECTION_THEME.ricorrenti);
    paintAmountOnBar(
      monthRow.getCell(6),
      {
        ...RENDICONTO_SECTION_THEME.ricorrenti,
        bar: RENDICONTO_SECTION_THEME.ricorrenti.wash,
        text: RENDICONTO_SECTION_THEME.ricorrenti.washText,
      },
      11,
    );
    writeLines(sheet, "Ricorrente", card.ricorrenti, theme);
  }

  const foot = sheet.addRow([
    heading.foot,
    "",
    "",
    "",
    "",
    heading.amount,
  ]);
  sheet.mergeCells(foot.number, 1, foot.number, 5);
  paintBarRow(foot, theme, 11);
  paintAmountOnBar(foot.getCell(6), theme, 11);
  frameBlock(sheet, start, foot.number, 6, hexToArgb(theme.frame));
  sheet.addRow([]);
}

export function writeRendicontoSupplierCards(
  sheet: ExcelJS.Worksheet,
  cards: RendicontoSupplierCardModel[],
  months: RendicontoMonthBlock[],
): void {
  if (cards.length === 0) {
    const empty = sheet.addRow(["Nessuna riga nel periodo"]);
    frameBlock(sheet, empty.number, empty.number, 6, "FF94A3B8");
    sheet.addRow([]);
  } else {
    for (const card of cards) writeSupplierCard(sheet, card);
  }

  if (months.length > 1) {
    const title = sheet.addRow(["Subtotali netti per mese"]);
    sheet.mergeCells(title.number, 1, title.number, 6);
    paintBarRow(title, RENDICONTO_SECTION_THEME.dettaglio, 12);
    const start = title.number;
    let end = title.number;
    for (const block of months) {
      const tone = rendicontoNettoSwatch(block.subNetto);
      const row = sheet.addRow([
        `Subtotale netto ${block.label}`,
        "",
        "",
        "",
        "",
        block.subNetto,
      ]);
      sheet.mergeCells(row.number, 1, row.number, 5);
      paintBarRow(row, tone, 11);
      paintAmountOnBar(row.getCell(6), tone, 11);
      end = row.number;
    }
    frameBlock(sheet, start, end, 6, hexToArgb(RENDICONTO_SECTION_THEME.dettaglio.frame));
    sheet.addRow([]);
  }
}
