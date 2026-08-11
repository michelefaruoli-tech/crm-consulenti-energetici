import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  loadReportRecurringPaid,
} from "@/lib/report-recurring";
import { loadReportStornos } from "@/lib/report-stornos";
import { buildRendiconto, formatEuro } from "@/lib/report-rendiconto";
import {
  parseReportExtras,
  sumReportExtras,
} from "@/lib/report-extras";
import {
  buildReportContractWhere,
  formatMonthsLabel,
  reportHasStato,
  reportPeriodUsesCollectionDate,
  resolveReportPeriod,
  resolveReportStati,
  resolveReportStato,
} from "@/lib/report-filters";

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

  const recurringRows = includeRecurring
    ? await loadReportRecurringPaid({
        from,
        to,
        month,
        collaboratorId,
        supplierId,
        visibility,
      })
    : [];

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

  const period = resolveReportPeriod({ from, to, month });
  const periodLabelText =
    period.months.length > 0
      ? formatMonthsLabel(period.months)
      : `${period.from} - ${period.to}`;

  const rendiconto = buildRendiconto({
    contracts,
    stornoRows,
    recurringRows,
    skipRecurring: !includeRecurring,
    onlyStornato,
  });

  const extras = parseReportExtras((k) => sp.get(k));
  const extrasSum = sumReportExtras(extras);
  const grandNetto = rendiconto.totNetto + extrasSum;

  const doc = new jsPDF();
  let y = 16;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Rendiconto Provvigioni", 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Periodo: ${periodLabelText}`, 14, y);
  y += 5;
  doc.text(`Stato: ${stato} · Generato ${new Date().toLocaleString("it-IT")}`, 14, y);
  y += 8;

  // Riepilogo: solo parziali per fornitore + storni/ricorrenti/voci + netto
  const summaryBody: string[][] = [];
  for (const s of rendiconto.incassatoBySupplier) {
    summaryBody.push([
      s.supplierName,
      String(s.count),
      formatEuro(s.subtotal),
    ]);
  }
  if (rendiconto.countStorni > 0 || rendiconto.totStorni !== 0) {
    summaryBody.push([
      "Storni",
      String(rendiconto.countStorni),
      formatEuro(rendiconto.totStorni),
    ]);
  }
  if (includeRecurring && rendiconto.countRicorrenti > 0) {
    summaryBody.push([
      "Rate ricorrenti (somma)",
      String(rendiconto.countRicorrenti),
      formatEuro(rendiconto.totRicorrenti),
    ]);
  }
  for (const e of extras) {
    summaryBody.push([
      e.tipologia,
      e.note || "-",
      formatEuro(e.amount),
    ]);
  }
  const nettoRowIndex = summaryBody.length;
  summaryBody.push([
    "TOTALE NETTO",
    String(
      rendiconto.countIncassato +
        rendiconto.countStorni +
        rendiconto.countRicorrenti +
        extras.length,
    ),
    formatEuro(grandNetto),
  ]);

  // Riepilogo
  autoTable(doc, {
    startY: y,
    head: [["Voce", "N° / Note", "Importo"]],
    body: summaryBody,
    styles: { fontSize: 9, textColor: [15, 23, 42] },
    headStyles: {
      fillColor: [6, 95, 70],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === nettoRowIndex) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [6, 95, 70];
        data.cell.styles.textColor = [255, 255, 255];
      }
      // Colonna importi: verde / rosso
      if (data.section === "body" && data.column.index === 2) {
        const raw = String(data.cell.raw ?? data.cell.text ?? "");
        const negative = raw.includes("-");
        if (data.row.index !== nettoRowIndex) {
          data.cell.styles.textColor = negative
            ? [185, 28, 28]
            : [4, 120, 87];
          data.cell.styles.fontStyle = "bold";
        } else {
          data.cell.styles.textColor = negative
            ? [254, 202, 202]
            : [167, 243, 208];
        }
      }
    },
  });

  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 10;

  // Dettaglio sotto il riepilogo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Dettaglio", 14, y);
  doc.setTextColor(0, 0, 0);
  y += 6;

  for (const block of rendiconto.months) {
    if (y > 250) {
      doc.addPage();
      y = 16;
    }

    if (rendiconto.months.length > 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(block.label, 14, y);
      y += 6;
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 94, 89);
    doc.text(
      `Incassato per fornitore (${block.countIncassato}) - ${formatEuro(block.subIncassato)}`,
      14,
      y,
    );
    doc.setTextColor(0, 0, 0);
    y += 4;

    if (block.incassatoBySupplier.length === 0) {
      autoTable(doc, {
        startY: y,
        head: [["N. contratto", "Cliente", "Fornitore", "Collab.", "Data", "Importo"]],
        body: [["-", "Nessuna riga", "", "", "", ""]],
        styles: { fontSize: 7 },
        headStyles: { fillColor: [20, 184, 166] },
        margin: { left: 14, right: 14 },
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    } else {
      for (const supplier of block.incassatoBySupplier) {
        if (y > 250) {
          doc.addPage();
          y = 16;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 118, 110);
        doc.text(
          `${supplier.supplierName} (${supplier.count}) - ${formatEuro(supplier.subtotal)}`,
          14,
          y,
        );
        doc.setTextColor(0, 0, 0);
        y += 2;
        autoTable(doc, {
          startY: y,
          head: [["N. contratto", "Cliente", "Collab.", "Data", "Importo"]],
          body: supplier.lines.map((l) => [
            l.contractNumber,
            l.clientName,
            l.collaboratorName,
            l.dateLabel,
            formatEuro(l.amount),
          ]),
          styles: { fontSize: 7, textColor: [15, 23, 42] },
          headStyles: {
            fillColor: [15, 118, 110],
            textColor: [255, 255, 255],
            fontStyle: "bold",
          },
          margin: { left: 14, right: 14 },
          foot: [
            [
              "Subtotale",
              supplier.supplierName,
              "",
              "",
              formatEuro(supplier.subtotal),
            ],
          ],
          // Fondo verde scuro + testo bianco = leggibile
          footStyles: {
            fillColor: [6, 95, 70],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 8,
          },
          didParseCell: (data) => {
            // Colonna Importo: positivi verde, negativi rosso
            if (data.column.index !== 4) return;
            if (data.section === "body") {
              const amount = supplier.lines[data.row.index]?.amount ?? 0;
              data.cell.styles.textColor =
                amount < 0 ? [185, 28, 28] : [4, 120, 87];
              data.cell.styles.fontStyle = "bold";
            }
            if (data.section === "foot") {
              data.cell.styles.textColor =
                supplier.subtotal < 0 ? [254, 202, 202] : [167, 243, 208];
            }
          },
        });
        y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
      }
    }

    if (y > 250) {
      doc.addPage();
      y = 16;
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(159, 18, 57);
    doc.text(`Storni (${block.countStorni}) - ${formatEuro(block.subStorni)}`, 14, y);
    doc.setTextColor(0, 0, 0);
    y += 2;

    autoTable(doc, {
      startY: y,
      head: [["N. contratto", "Cliente", "Fornitore", "Collab.", "Data", "Importo"]],
      body:
        block.storni.length === 0
          ? [["-", "Nessuno storno", "", "", "", ""]]
          : block.storni.map((l) => [
              l.contractNumber,
              l.clientName,
              l.supplierName,
              l.collaboratorName,
              l.dateLabel,
              formatEuro(l.amount),
            ]),
      styles: { fontSize: 7, textColor: [15, 23, 42] },
      headStyles: {
        fillColor: [153, 27, 27],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 5) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

    if (includeRecurring && block.ricorrenti.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 16;
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(107, 33, 168);
      doc.text(
        `Rate ricorrenti - somma ${formatEuro(block.subRicorrenti)} (${block.countRicorrenti} rate)`,
        14,
        y,
      );
      doc.setTextColor(0, 0, 0);
      y += 2;
      autoTable(doc, {
        startY: y,
        head: [["N. contratto", "Cliente", "Fornitore", "Collab.", "Competenza", "Importo"]],
        body: block.ricorrenti.map((l) => [
          l.contractNumber,
          l.clientName,
          l.supplierName,
          l.collaboratorName,
          l.dateLabel,
          formatEuro(l.amount),
        ]),
        styles: { fontSize: 7, textColor: [15, 23, 42] },
        headStyles: {
          fillColor: [88, 28, 135],
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        margin: { left: 14, right: 14 },
        foot: [
          [
            "Somma rate",
            "",
            "",
            "",
            `${block.countRicorrenti} rate`,
            formatEuro(block.subRicorrenti),
          ],
        ],
        footStyles: {
          fillColor: [88, 28, 135],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 8,
        },
        didParseCell: (data) => {
          if (data.section !== "body" || data.column.index !== 5) return;
          const amount = block.ricorrenti[data.row.index]?.amount ?? 0;
          data.cell.styles.textColor =
            amount < 0 ? [185, 28, 28] : [4, 120, 87];
          data.cell.styles.fontStyle = "bold";
        },
      });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
    }

    if (rendiconto.months.length > 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(
        `Subtotale netto ${block.label}: ${formatEuro(block.subNetto)}`,
        14,
        y,
      );
      y += 8;
    }
  }

  if (extras.length > 0) {
    if (y > 240) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(146, 64, 14);
    doc.text("Voci aggiuntive", 14, y);
    doc.setTextColor(0, 0, 0);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [["Tipologia", "Note", "Importo"]],
      body: extras.map((e) => [
        e.tipologia,
        e.note || "-",
        formatEuro(e.amount),
      ]),
      styles: { fontSize: 8, textColor: [15, 23, 42] },
      headStyles: {
        fillColor: [146, 64, 14],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section !== "body" || data.column.index !== 2) return;
        const amount = extras[data.row.index]?.amount ?? 0;
        data.cell.styles.textColor =
          amount < 0 ? [185, 28, 28] : [4, 120, 87];
        data.cell.styles.fontStyle = "bold";
      },
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
  }

  if (y > 270) {
    doc.addPage();
    y = 16;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`TOTALE NETTO: ${formatEuro(grandNetto)}`, 14, y);

  const pdf = doc.output("arraybuffer");
  const safePeriod =
    periodLabelText.replace(/[^\wàèéìòù+\-\s]/gi, "").slice(0, 40).trim() ||
    "periodo";

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rendiconto-${safePeriod.replace(/\s+/g, "-")}-${Date.now()}.pdf"`,
    },
  });
}
