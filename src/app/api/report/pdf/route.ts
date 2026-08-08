import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { simplifiedProvvigioneStato } from "@/lib/provvigioni-stato";
import {
  buildReportContractWhere,
  formatMonthsLabel,
  reportPeriodUsesCollectionDate,
  resolveReportPeriod,
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

  const period = resolveReportPeriod({ from, to, month });
  const periodLabel =
    period.months.length > 0
      ? formatMonthsLabel(period.months)
      : `${period.from} – ${period.to}`;

  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Report Contratti - CRM Energia", 14, 18);
  doc.setFontSize(10);
  doc.text(`Generato il ${new Date().toLocaleString("it-IT")}`, 14, 26);
  doc.text(
    `Filtri: ${stato} · ${periodLabel} · ${contracts.length} contratti`,
    14,
    32,
  );

  autoTable(doc, {
    startY: 38,
    head: [
      [
        "Numero",
        "Cliente",
        "Fornitore",
        "Collab.",
        "Stato prov.",
        "Prevista",
        "Ricevuta",
      ],
    ],
    body: contracts.map((contract) => [
      contract.contractNumber,
      clientDisplayName(contract.client),
      contract.supplier.name,
      contract.collaborator.name,
      simplifiedProvvigioneStato(
        contract.status,
        Boolean(contract.collectionDate),
        { hasStorno: Boolean(contract.commission?.stornoDate) },
      ),
      `€ ${Number(contract.commission?.expected ?? 0).toFixed(2)}`,
      `€ ${Number(contract.commission?.received ?? 0).toFixed(2)}`,
    ]),
    styles: { fontSize: 7 },
  });

  const pdf = doc.output("arraybuffer");

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${stato.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.pdf"`,
    },
  });
}
