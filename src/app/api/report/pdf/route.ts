import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";

export async function GET() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "reports.export")) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const contracts = await prisma.contract.findMany({
    where: canViewAll ? {} : { collaboratorId: session.id },
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { name: true } },
      commission: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("Report Contratti - CRM Energia", 14, 18);
  doc.setFontSize(10);
  doc.text(`Generato il ${new Date().toLocaleString("it-IT")}`, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [["Numero", "Cliente", "Fornitore", "Stato", "Prevista", "Ricevuta"]],
    body: contracts.map((contract) => [
      contract.contractNumber,
      clientDisplayName(contract.client),
      contract.supplier.name,
      CONTRACT_STATUS_LABELS[contract.status],
      `€ ${Number(contract.commission?.expected ?? 0).toFixed(2)}`,
      `€ ${Number(contract.commission?.received ?? 0).toFixed(2)}`,
    ]),
    styles: { fontSize: 8 },
  });

  const pdf = doc.output("arraybuffer");

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-contratti-${Date.now()}.pdf"`,
    },
  });
}
