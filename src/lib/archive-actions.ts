"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateContractNumber } from "@/lib/utils";
import { computeSupplyStartDate, normalizeOperationType } from "@/lib/supply-dates";

function cell(row: ExcelJS.Row, index: number): string {
  const v = row.getCell(index).value;
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
      return epoch;
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapClientType(value: string): "PRIVATO" | "AZIENDA" {
  const v = value.toUpperCase();
  if (v.includes("BUSINESS") || v.includes("AZIENDA") || v === "BOX") return "AZIENDA";
  return "PRIVATO";
}

/**
 * Import Excel contratti già pagati → archivio storico.
 * Colonne attese (riga 1 header, flessibile):
 * Cliente/Nome, Cognome, Ragione sociale, Tipo, Fornitore, POD/PDR, Data, Gettone, Collaboratore
 */
export async function importHistoricalExcelAction(
  formData: FormData,
): Promise<{ error?: string; imported?: number; label?: string }> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    return { error: "Solo admin/segreteria può importare lo storico" };
  }

  const label = String(formData.get("archiveLabel") ?? "").trim() || "Storico importato";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Seleziona un file Excel (.xlsx)" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  // exceljs types accept Buffer in runtime
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: "Foglio Excel vuoto" };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((c, col) => {
    headers[col] = String(c.value ?? "")
      .trim()
      .toLowerCase();
  });

  function col(...names: string[]): number {
    for (let i = 1; i < headers.length; i++) {
      const h = headers[i] ?? "";
      if (names.some((n) => h.includes(n))) return i;
    }
    return -1;
  }

  const cNome = col("nome", "cliente");
  const cCognome = col("cognome");
  const cRagione = col("ragione", "azienda", "company");
  const cTipo = col("tipo", "tipologia", "domestico", "business");
  const cFornitore = col("fornitore", "supplier");
  const cPod = col("pod", "pdr");
  const cData = col("data", "inserimento", "incasso");
  const cGettone = col("gettone", "provvigione", "importo", "expected");
  const cCollab = col("collaboratore", "agente");

  let imported = 0;
  const defaultCollabId = session.id;

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const firstName = cNome > 0 ? cell(row, cNome) : "";
    const lastName = cCognome > 0 ? cell(row, cCognome) : "";
    const companyName = cRagione > 0 ? cell(row, cRagione) : "";
    const tipoRaw = cTipo > 0 ? cell(row, cTipo) : "";
    const supplierName = cFornitore > 0 ? cell(row, cFornitore) : "Sconosciuto";
    const podPdr = cPod > 0 ? cell(row, cPod) : "";
    const dateRaw = cData > 0 ? cell(row, cData) : "";
    const gettoneRaw = cGettone > 0 ? cell(row, cGettone) : "";
    const collabName = cCollab > 0 ? cell(row, cCollab) : "";

    if (!firstName && !lastName && !companyName && !podPdr) continue;

    const type = mapClientType(tipoRaw || (companyName ? "AZIENDA" : "PRIVATO"));
    const insertionDate = parseDate(dateRaw) ?? new Date();
    const expected = Number(String(gettoneRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || 0;

    let collaboratorId = defaultCollabId;
    if (collabName) {
      const user = await prisma.user.findFirst({
        where: { name: { equals: collabName, mode: "insensitive" }, active: true },
      });
      if (user) collaboratorId = user.id;
    }

    const supplierCode =
      supplierName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 40) || "SCONOSCIUTO";

    let supplier = await prisma.supplier.findFirst({
      where: { OR: [{ code: supplierCode }, { name: { equals: supplierName, mode: "insensitive" } }] },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: supplierName || "Sconosciuto", code: `${supplierCode}_${Date.now()}` },
      });
    }

    const client = await prisma.client.create({
      data: {
        type,
        firstName: type === "PRIVATO" ? firstName || null : null,
        lastName: type === "PRIVATO" ? lastName || null : null,
        companyName: type === "AZIENDA" ? companyName || firstName || null : companyName || null,
        createdById: session.id,
      },
    });

    const contractNumber = await generateContractNumber();
    const op = normalizeOperationType("CAMBIO");
    const supplyStartDate = computeSupplyStartDate(insertionDate, op);

    const contract = await prisma.contract.create({
      data: {
        contractNumber,
        externalId: `hist-${label}-${r}-${Date.now()}`.slice(0, 80),
        clientId: client.id,
        collaboratorId,
        supplierId: supplier.id,
        status: "CHIUSO",
        podPdr: podPdr || null,
        insertionDate,
        supplyStartDate,
        operationType: op,
        paymentStatus: "Incassato",
        collectionDate: insertionDate,
        isHistorical: true,
        archiveLabel: label,
        commissionConfirmed: true,
        commissionConfirmedAt: new Date(),
      },
    });

    await prisma.commission.create({
      data: {
        contractId: contract.id,
        expected,
        received: expected,
        paid: expected,
        accrued: expected,
      },
    });

    imported += 1;
  }

  revalidatePath("/archivio");
  revalidatePath("/report");
  revalidatePath("/contratti");
  return { imported, label };
}
