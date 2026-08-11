import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { simplifiedProvvigioneStato } from "@/lib/provvigioni-stato";
import { periodLabel } from "@/lib/recurring";
import {
  loadReportRecurringPaid,
  sumReportRecurring,
} from "@/lib/report-recurring";
import {
  loadReportStornos,
  sumReportStornos,
} from "@/lib/report-stornos";
import { buildRendiconto } from "@/lib/report-rendiconto";
import {
  parseReportExtras,
  sumReportExtras,
} from "@/lib/report-extras";
import {
  buildReportContractWhere,
  formatMonthsLabel,
  reportHasStato,
  reportPeriodUsesCollectionDate,
  reportPeriodUsesStornoDate,
  resolveReportPeriod,
  resolveReportStati,
  resolveReportStato,
} from "@/lib/report-filters";
import { isInFornitura } from "@/lib/supply-dates";

type ExcelRow = (string | number | null)[];

function styleHeader(row: ExcelJS.Row, fill: string) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fill },
  };
}

function styleSection(row: ExcelJS.Row, fill: string, color = "FF0F172A") {
  row.font = { bold: true, size: 12, color: { argb: color } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fill },
  };
}

function styleSubtotal(row: ExcelJS.Row, fill: string) {
  row.font = { bold: true };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fill },
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "reports.export")) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const month = sp.get("month");
  const collaboratorId = sp.get("collaboratorId");
  const supplierId = sp.get("supplierId");
  const stato = resolveReportStato(sp.get("stato"));
  const stati = resolveReportStati(sp.get("stato"));

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const contracts = await prisma.contract.findMany({
    where: buildReportContractWhere(
      { from, to, month, collaboratorId, supplierId, stato },
      visibility,
    ),
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { name: true } },
      commission: true,
    },
    orderBy: reportPeriodUsesCollectionDate(stato)
      ? { collectionDate: "desc" }
      : { insertionDate: "desc" },
  });

  const recurringRows = await loadReportRecurringPaid({
    from,
    to,
    month,
    collaboratorId,
    supplierId,
    visibility,
  });
  const recurringTotals = sumReportRecurring(recurringRows);

  const includeStornos =
    reportHasStato(stati, "Incassato") ||
    reportHasStato(stati, "Pagato") ||
    reportHasStato(stati, "Tutti") ||
    reportHasStato(stati, "Stornato");
  const includeRecurring =
    reportHasStato(stati, "Incassato") ||
    reportHasStato(stati, "Pagato") ||
    reportHasStato(stati, "Tutti");
  const onlyStornato =
    stati.length > 0 && stati.every((s) => s === "Stornato");

  const stornoRows = includeStornos
    ? await loadReportStornos({
        from,
        to,
        month,
        collaboratorId,
        supplierId,
        visibility,
      })
    : [];
  const stornoTotals = sumReportStornos(stornoRows);

  const period = resolveReportPeriod({ from, to, month });
  const periodLabelText =
    period.months.length > 0
      ? formatMonthsLabel(period.months)
      : `${period.from} – ${period.to}`;

  const rendiconto = buildRendiconto({
    contracts,
    stornoRows,
    recurringRows: includeRecurring ? recurringRows : [],
    skipRecurring: !includeRecurring,
    onlyStornato,
  });

  const extras = parseReportExtras((k) => sp.get(k));
  const extrasSum = sumReportExtras(extras);
  const grandNetto = rendiconto.totNetto + extrasSum;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Energia";
  workbook.created = new Date();

  // ─── Foglio 1: Rendiconto (Incassato + Storni + subtotali) ───
  const rend = workbook.addWorksheet("Rendiconto", {
    views: [{ state: "frozen", ySplit: 6 }],
  });
  rend.columns = [
    { width: 14 },
    { width: 16 },
    { width: 28 },
    { width: 18 },
    { width: 20 },
    { width: 14 },
    { width: 14 },
  ];

  const titleRow = rend.addRow([
    "RENDICONTO PROVVIGIONI",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  titleRow.font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  rend.mergeCells(1, 1, 1, 7);

  rend.addRow([`Periodo: ${periodLabelText}`]);
  rend.addRow([`Stato filtro: ${stato}`]);
  rend.addRow([`Generato: ${new Date().toLocaleString("it-IT")}`]);
  rend.addRow([]);

  const summaryHeader = rend.addRow([
    "RIEPILOGO",
    "N°",
    "Importo €",
    "",
    "",
    "",
    "",
  ]);
  styleHeader(summaryHeader, "FF0F766E");
  rend.addRow(["Incassato (una tantum)", rendiconto.countIncassato, rendiconto.totIncassato]);
  for (const s of rendiconto.incassatoBySupplier) {
    rend.addRow([`  └ ${s.supplierName}`, s.count, s.subtotal]);
  }
  rend.addRow(["Storni", rendiconto.countStorni, rendiconto.totStorni]).getCell(3).font = {
    color: { argb: "FFB91C1C" },
    bold: true,
  };
  if (includeRecurring) {
    rend.addRow([
      "Rate ricorrenti",
      rendiconto.countRicorrenti,
      rendiconto.totRicorrenti,
    ]);
  }
  for (const e of extras) {
    const r = rend.addRow([e.tipologia, e.note || "—", e.amount]);
    if (e.amount < 0) {
      r.getCell(3).font = { color: { argb: "FFB91C1C" } };
    }
  }
  const nettoRow = rend.addRow([
    "TOTALE NETTO",
    extras.length > 0
      ? `${rendiconto.countIncassato + rendiconto.countStorni + rendiconto.countRicorrenti} + ${extras.length} voci`
      : String(
          rendiconto.countIncassato +
            rendiconto.countStorni +
            rendiconto.countRicorrenti,
        ),
    grandNetto,
  ]);
  styleSubtotal(nettoRow, "FFD1FAE5");
  nettoRow.font = { bold: true, size: 12 };
  rend.addRow([]);

  const detailHeader = rend.addRow([
    "Sezione",
    "N. contratto",
    "Cliente",
    "Fornitore",
    "Collaboratore",
    "Data",
    "Importo €",
  ] as ExcelRow);
  styleHeader(detailHeader, "FF334155");

  for (const block of rendiconto.months) {
    if (rendiconto.months.length > 1) {
      const monthTitle = rend.addRow([
        block.label.toUpperCase(),
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      styleSection(monthTitle, "FFE0E7FF", "FF312E81");
      rend.mergeCells(monthTitle.number, 1, monthTitle.number, 7);
    }

    // Incassato — un blocco per fornitore
    const incTitle = rend.addRow([
      "INCASSATO (per fornitore)",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    styleSection(incTitle, "FFCCFBF1", "FF115E59");
    if (block.incassatoBySupplier.length === 0) {
      rend.addRow(["", "(nessuna riga)", "", "", "", "", ""]);
    } else {
      for (const supplier of block.incassatoBySupplier) {
        const supTitle = rend.addRow([
          `Fornitore: ${supplier.supplierName}`,
          `${supplier.count} contratti`,
          "",
          "",
          "",
          "",
          supplier.subtotal,
        ]);
        styleSection(supTitle, "FFE6FFFA", "FF0F766E");
        for (const line of supplier.lines) {
          rend.addRow([
            "Incassato",
            line.contractNumber,
            line.clientName,
            line.supplierName,
            line.collaboratorName,
            line.dateLabel,
            line.amount,
          ]);
        }
        const subSup = rend.addRow([
          `Subtotale ${supplier.supplierName}`,
          `${supplier.count} righe`,
          "",
          "",
          "",
          "",
          supplier.subtotal,
        ]);
        styleSubtotal(subSup, "FFF0FDFA");
      }
    }
    const subInc = rend.addRow([
      "Subtotale Incassato (tutti i fornitori)",
      `${block.countIncassato} righe`,
      "",
      "",
      "",
      "",
      block.subIncassato,
    ]);
    styleSubtotal(subInc, "FFECFDF5");
    subInc.font = { bold: true };

    // Storni
    const stoTitle = rend.addRow(["STORNI", "", "", "", "", "", ""]);
    styleSection(stoTitle, "FFFFE4E6", "FF9F1239");
    if (block.storni.length === 0) {
      rend.addRow(["", "(nessuno storno)", "", "", "", "", ""]);
    } else {
      for (const line of block.storni) {
        const r = rend.addRow([
          "Storno",
          line.contractNumber,
          line.clientName,
          line.supplierName,
          line.collaboratorName,
          line.dateLabel,
          line.amount,
        ]);
        r.getCell(7).font = { color: { argb: "FFB91C1C" } };
      }
    }
    const subSto = rend.addRow([
      "Subtotale Storni",
      `${block.countStorni} righe`,
      "",
      "",
      "",
      "",
      block.subStorni,
    ]);
    styleSubtotal(subSto, "FFFFF1F2");
    subSto.getCell(7).font = { bold: true, color: { argb: "FFB91C1C" } };

    // Ricorrenti (se presenti nel mese)
    if (includeRecurring && block.ricorrenti.length > 0) {
      const ricTitle = rend.addRow([
        "RATE RICORRENTI",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      styleSection(ricTitle, "FFF3E8FF", "FF6B21A8");
      for (const line of block.ricorrenti) {
        rend.addRow([
          "Ricorrente",
          line.contractNumber,
          line.clientName,
          line.supplierName,
          line.collaboratorName,
          line.dateLabel,
          line.amount,
        ]);
      }
      const subRic = rend.addRow([
        "Subtotale Ricorrenti",
        `${block.countRicorrenti} rate`,
        "",
        "",
        "",
        "",
        block.subRicorrenti,
      ]);
      styleSubtotal(subRic, "FFFAF5FF");
    }

    if (rendiconto.months.length > 1) {
      const subNet = rend.addRow([
        `Subtotale netto ${block.label}`,
        "",
        "",
        "",
        "",
        "",
        block.subNetto,
      ]);
      styleSubtotal(subNet, "FFFEF3C7");
      subNet.font = { bold: true };
    }

    rend.addRow([]);
  }

  if (extras.length > 0) {
    const extraTitle = rend.addRow([
      "VOCI AGGIUNTIVE",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    styleSection(extraTitle, "FFFEF3C7", "FF92400E");
    rend.mergeCells(extraTitle.number, 1, extraTitle.number, 7);
    const extraHead = rend.addRow([
      "Tipologia",
      "Note",
      "",
      "",
      "",
      "",
      "Importo €",
    ]);
    styleHeader(extraHead, "FFB45309");
    for (const e of extras) {
      const r = rend.addRow([
        e.tipologia,
        e.note || "",
        "",
        "",
        "",
        "",
        e.amount,
      ]);
      if (e.amount < 0) {
        r.getCell(7).font = { color: { argb: "FFB91C1C" } };
      }
    }
    const subEx = rend.addRow([
      "Subtotale voci aggiuntive",
      "",
      "",
      "",
      "",
      "",
      extrasSum,
    ]);
    styleSubtotal(subEx, "FFFFFBEB");
    rend.addRow([]);
  }

  const finalTot = rend.addRow([
    extras.length > 0
      ? "TOTALE NETTO (Incassato + Storni + Ricorrenti + voci aggiuntive)"
      : "TOTALE NETTO (Incassato + Storni + Ricorrenti)",
    "",
    "",
    "",
    "",
    "",
    grandNetto,
  ]);
  styleSubtotal(finalTot, "FFA7F3D0");
  finalTot.font = { bold: true, size: 13 };

  // Formato numeri colonna importo
  rend.getColumn(7).numFmt = '#,##0.00';

  // ─── Foglio 2: Contratti (dettaglio classico) ───
  const sheet = workbook.addWorksheet("Contratti");
  sheet.columns = [
    { header: "Numero", key: "number", width: 18 },
    { header: "Data inserimento", key: "insertion", width: 14 },
    { header: "Data incasso", key: "collection", width: 14 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Fornitore", key: "supplier", width: 20 },
    { header: "Collaboratore", key: "collaborator", width: 20 },
    { header: "Stato pratica", key: "status", width: 24 },
    { header: "Stato provvigione", key: "statoProv", width: 16 },
    { header: "Provv. prevista", key: "expected", width: 16 },
    { header: "Provv. ricevuta", key: "received", width: 16 },
    { header: "Provv. liquidata", key: "paid", width: 16 },
    { header: "Storno €", key: "storno", width: 12 },
    { header: "Data storno", key: "stornoDate", width: 14 },
  ];
  styleHeader(sheet.getRow(1), "FF334155");

  for (const contract of contracts) {
    const stornoAmt =
      contract.commission?.stornoAmount != null
        ? Number(contract.commission.stornoAmount)
        : 0;
    sheet.addRow({
      number: contract.contractNumber,
      insertion: contract.insertionDate
        ? contract.insertionDate.toISOString().slice(0, 10)
        : "",
      collection: contract.collectionDate
        ? contract.collectionDate.toISOString().slice(0, 10)
        : "",
      client: clientDisplayName(contract.client),
      supplier: contract.supplier.name,
      collaborator: contract.collaborator.name,
      status: CONTRACT_STATUS_LABELS[contract.status],
      statoProv: simplifiedProvvigioneStato(
        contract.status,
        Boolean(contract.collectionDate),
        {
          inFornitura: isInFornitura(contract.supplyStartDate),
          hasStorno: Boolean(contract.commission?.stornoDate),
        },
      ),
      expected: Number(contract.commission?.expected ?? 0),
      received: Number(contract.commission?.received ?? 0),
      paid: Number(contract.commission?.paid ?? 0),
      storno: stornoAmt,
      stornoDate: contract.commission?.stornoDate
        ? contract.commission.stornoDate.toISOString().slice(0, 10)
        : "",
    });
  }

  // ─── Foglio 3: Rate ricorrenti ───
  const sheet2 = workbook.addWorksheet("Rate ricorrenti");
  sheet2.columns = [
    { header: "Competenza", key: "competence", width: 14 },
    { header: "Rendiconto (bonifico)", key: "settled", width: 18 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "POD/PDR", key: "pod", width: 18 },
    { header: "Collaboratore", key: "collaborator", width: 18 },
    { header: "Fornitore", key: "supplier", width: 16 },
    { header: "Importo", key: "amount", width: 12 },
    { header: "N. contratto", key: "number", width: 16 },
  ];
  styleHeader(sheet2.getRow(1), "FF6B21A8");
  for (const r of recurringRows) {
    sheet2.addRow({
      competence: periodLabel(r.period),
      settled: r.settledPeriod ? periodLabel(r.settledPeriod) : "",
      client: r.clientName,
      tipo: r.clientType === "AZIENDA" ? "ALTRI USI" : "DOMESTICO",
      pod: r.podPdr ?? "",
      collaborator: r.collaboratorName,
      supplier: r.supplierName,
      amount: r.amount,
      number: r.contractNumber,
    });
  }

  // ─── Foglio 4: Storni (dettaglio dedicato) ───
  const sheet3 = workbook.addWorksheet("Storni");
  sheet3.columns = [
    { header: "Cliente", key: "client", width: 28 },
    { header: "Fornitore", key: "supplier", width: 18 },
    { header: "Collaboratore", key: "collaborator", width: 18 },
    { header: "Mese storno", key: "period", width: 12 },
    { header: "Data storno", key: "date", width: 14 },
    { header: "Importo (negativo)", key: "amount", width: 16 },
    { header: "N. contratto", key: "number", width: 16 },
  ];
  styleHeader(sheet3.getRow(1), "FF9F1239");
  for (const s of stornoRows) {
    const row = sheet3.addRow({
      client: s.clientName,
      supplier: s.supplierName,
      collaborator: s.collaboratorName,
      period: s.period,
      date: s.stornoDate.toISOString().slice(0, 10),
      amount: s.amount,
      number: s.contractNumber,
    });
    row.getCell("amount").font = { color: { argb: "FFB91C1C" } };
  }
  if (stornoRows.length > 0) {
    const tot = sheet3.addRow({
      client: "TOTALE STORNI",
      amount: stornoTotals.amount,
    });
    styleSubtotal(tot, "FFFFE4E6");
    tot.getCell("amount").font = { bold: true, color: { argb: "FFB91C1C" } };
  }

  // ─── Foglio 5: Filtri / meta ───
  const meta = workbook.addWorksheet("Filtri");
  meta.addRow(["Periodo", periodLabelText]);
  meta.addRow(["Dal", period.from]);
  meta.addRow(["Al", period.to]);
  meta.addRow(["Mesi (URL)", month ?? ""]);
  meta.addRow(["Collaboratore ID", collaboratorId ?? "Tutti"]);
  meta.addRow(["Fornitore ID", supplierId ?? "Tutti"]);
  meta.addRow(["Stato provvigione", stato]);
  meta.addRow([
    "Data periodo contratti",
    reportPeriodUsesStornoDate(stato)
      ? "stornoDate"
      : reportPeriodUsesCollectionDate(stato)
        ? "collectionDate (incasso)"
        : "insertionDate",
  ]);
  meta.addRow(["N° contratti filtro", contracts.length]);
  meta.addRow(["N° Incassato (rendiconto)", rendiconto.countIncassato]);
  meta.addRow(["Totale Incassato €", rendiconto.totIncassato]);
  meta.addRow(["N° storni", stornoTotals.count]);
  meta.addRow(["Totale storni €", stornoTotals.amount]);
  meta.addRow(["N° rate ricorrenti", recurringTotals.count]);
  meta.addRow(["Totale ricorrenti €", recurringTotals.amount]);
  meta.addRow(["N° voci aggiuntive", extras.length]);
  meta.addRow(["Totale voci aggiuntive €", extrasSum]);
  for (const e of extras) {
    meta.addRow([
      `Extra: ${e.tipologia}`,
      `${e.amount}${e.note ? ` — ${e.note}` : ""}`,
    ]);
  }
  meta.addRow(["TOTALE NETTO €", grandNetto]);

  const buffer = await workbook.xlsx.writeBuffer();
  const safePeriod = periodLabelText.replace(/[^\wàèéìòù+\-\s]/gi, "").slice(0, 40).trim() || "periodo";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rendiconto-${safePeriod.replace(/\s+/g, "-")}-${Date.now()}.xlsx"`,
    },
  });
}
