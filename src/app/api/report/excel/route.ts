import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { simplifiedProvvigioneStato } from "@/lib/provvigioni-stato";
import {
  buildReportContractWhere,
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
  const collaboratorId = sp.get("collaboratorId");
  const supplierId = sp.get("supplierId");
  const stato = resolveReportStato(sp.get("stato"));

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const contracts = await prisma.contract.findMany({
    where: buildReportContractWhere(
      { from, to, collaboratorId, supplierId, stato },
      visibility,
    ),
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { name: true } },
      commission: true,
    },
    orderBy: { insertionDate: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contratti");

  sheet.columns = [
    { header: "Numero", key: "number", width: 18 },
    { header: "Data inserimento", key: "insertion", width: 14 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Fornitore", key: "supplier", width: 20 },
    { header: "Collaboratore", key: "collaborator", width: 20 },
    { header: "Stato pratica", key: "status", width: 24 },
    { header: "Stato provvigione", key: "statoProv", width: 16 },
    { header: "Provv. prevista", key: "expected", width: 16 },
    { header: "Provv. ricevuta", key: "received", width: 16 },
    { header: "Provv. liquidata", key: "paid", width: 16 },
  ];

  for (const contract of contracts) {
    sheet.addRow({
      number: contract.contractNumber,
      insertion: contract.insertionDate
        ? contract.insertionDate.toISOString().slice(0, 10)
        : "",
      client: clientDisplayName(contract.client),
      supplier: contract.supplier.name,
      collaborator: contract.collaborator.name,
      status: CONTRACT_STATUS_LABELS[contract.status],
      statoProv: simplifiedProvvigioneStato(
        contract.status,
        Boolean(contract.collectionDate),
      ),
      expected: Number(contract.commission?.expected ?? 0),
      received: Number(contract.commission?.received ?? 0),
      paid: Number(contract.commission?.paid ?? 0),
    });
  }

  const meta = workbook.addWorksheet("Filtri");
  meta.addRow(["Dal", from ?? ""]);
  meta.addRow(["Al", to ?? ""]);
  meta.addRow(["Collaboratore ID", collaboratorId ?? "Tutti"]);
  meta.addRow(["Fornitore ID", supplierId ?? "Tutti"]);
  meta.addRow(["Stato provvigione", stato]);
  meta.addRow(["N° righe", contracts.length]);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="report-${stato.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.xlsx"`,
    },
  });
}
