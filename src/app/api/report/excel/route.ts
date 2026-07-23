import ExcelJS from "exceljs";
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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contratti");

  sheet.columns = [
    { header: "Numero", key: "number", width: 18 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Fornitore", key: "supplier", width: 20 },
    { header: "Collaboratore", key: "collaborator", width: 20 },
    { header: "Stato", key: "status", width: 24 },
    { header: "Provv. prevista", key: "expected", width: 16 },
    { header: "Provv. ricevuta", key: "received", width: 16 },
    { header: "Provv. liquidata", key: "paid", width: 16 },
  ];

  for (const contract of contracts) {
    sheet.addRow({
      number: contract.contractNumber,
      client: clientDisplayName(contract.client),
      supplier: contract.supplier.name,
      collaborator: contract.collaborator.name,
      status: CONTRACT_STATUS_LABELS[contract.status],
      expected: Number(contract.commission?.expected ?? 0),
      received: Number(contract.commission?.received ?? 0),
      paid: Number(contract.commission?.paid ?? 0),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report-contratti-${Date.now()}.xlsx"`,
    },
  });
}
