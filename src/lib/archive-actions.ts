"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { generateContractNumber } from "@/lib/utils";
import { computeSupplyStartDate, normalizeOperationType } from "@/lib/supply-dates";
import { normalizePodKey } from "@/lib/storno-status";

export type ArchivePreviewRow = {
  row: number;
  status: "ok" | "warning" | "error";
  messages: string[];
  clientLabel: string;
  type: "PRIVATO" | "AZIENDA";
  supplierName: string;
  podPdr: string;
  gettone: number;
  collaboratorName: string;
  collaboratorId: string;
  insertionDate: string;
  skip: boolean;
};

export type ArchivePreviewResult = {
  error?: string;
  label?: string;
  summary?: { ok: number; warning: number; error: number; total: number };
  rows?: ArchivePreviewRow[];
};

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

type CollabUser = { id: string; name: string; email: string };

function resolveCollaborator(
  raw: string,
  users: CollabUser[],
  defaultId: string,
  defaultName: string,
): { id: string; name: string; warning?: string } {
  const q = raw.trim();
  if (!q) {
    return { id: defaultId, name: defaultName, warning: "Collaboratore assente → default" };
  }
  const byEmail = users.find((u) => u.email.toLowerCase() === q.toLowerCase());
  if (byEmail) return { id: byEmail.id, name: byEmail.name };
  const byName = users.find((u) => u.name.toLowerCase() === q.toLowerCase());
  if (byName) return { id: byName.id, name: byName.name };
  const byIncludes = users.find(
    (u) =>
      u.name.toLowerCase().includes(q.toLowerCase()) ||
      q.toLowerCase().includes(u.name.toLowerCase()),
  );
  if (byIncludes) {
    return {
      id: byIncludes.id,
      name: byIncludes.name,
      warning: `Match parziale «${q}» → ${byIncludes.name}`,
    };
  }
  return {
    id: defaultId,
    name: defaultName,
    warning: `Collaboratore «${q}» non trovato → default ${defaultName}`,
  };
}

type ParsedSheet = {
  label: string;
  defaultCollabId: string;
  skipPodDuplicates: boolean;
  sheet: ExcelJS.Worksheet;
  headers: string[];
  cols: {
    nome: number;
    cognome: number;
    ragione: number;
    tipo: number;
    fornitore: number;
    pod: number;
    data: number;
    gettone: number;
    collab: number;
  };
};

async function loadSheetFromForm(formData: FormData): Promise<
  | { error: string }
  | { ok: true; data: ParsedSheet }
> {
  const label = String(formData.get("archiveLabel") ?? "").trim() || "Storico importato";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Seleziona un file Excel (.xlsx)" };
  }

  const defaultCollabId = String(formData.get("defaultCollaboratorId") ?? "").trim();
  if (!defaultCollabId) {
    return { error: "Scegli il collaboratore di default" };
  }

  const skipPodDuplicates = String(formData.get("skipPodDuplicates") ?? "") === "1";

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
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

  const cols = {
    nome: col("nome", "cliente"),
    cognome: col("cognome"),
    ragione: col("ragione", "azienda", "company"),
    tipo: col("tipo", "tipologia", "domestico", "business"),
    fornitore: col("fornitore", "supplier"),
    pod: col("pod", "pdr"),
    data: col("data", "inserimento", "incasso"),
    gettone: col("gettone", "provvigione", "importo", "expected"),
    collab: col("collaboratore", "agente"),
  };

  if (cols.nome < 0 && cols.cognome < 0 && cols.ragione < 0 && cols.pod < 0) {
    return {
      error:
        "Intestazioni non riconosciute. Serve almeno Nome/Cognome/Ragione sociale o POD/PDR nella riga 1.",
    };
  }

  return {
    ok: true,
    data: { label, defaultCollabId, skipPodDuplicates, sheet, headers, cols },
  };
}

async function buildPreviewRows(
  data: ParsedSheet,
  sessionId: string,
): Promise<{ rows: ArchivePreviewRow[]; users: CollabUser[]; defaultName: string }> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
    },
    select: { id: true, name: true, email: true },
  });
  const defaultUser = users.find((u) => u.id === data.defaultCollabId);
  const defaultName = defaultUser?.name ?? "Default";

  // Preload POD esistenti (normalizzati) per warning rapidi
  const existingPods = await prisma.contract.findMany({
    where: { deletedAt: null, podPdr: { not: null } },
    select: { podPdr: true, contractNumber: true, isHistorical: true },
    take: 8000,
  });
  const podMap = new Map<string, { contractNumber: string; isHistorical: boolean }>();
  for (const c of existingPods) {
    const key = normalizePodKey(c.podPdr);
    if (key && !podMap.has(key)) {
      podMap.set(key, {
        contractNumber: c.contractNumber,
        isHistorical: c.isHistorical,
      });
    }
  }

  const rows: ArchivePreviewRow[] = [];
  const seenInFile = new Set<string>();

  for (let r = 2; r <= data.sheet.rowCount; r++) {
    const row = data.sheet.getRow(r);
    const firstName = data.cols.nome > 0 ? cell(row, data.cols.nome) : "";
    const lastName = data.cols.cognome > 0 ? cell(row, data.cols.cognome) : "";
    const companyName = data.cols.ragione > 0 ? cell(row, data.cols.ragione) : "";
    const tipoRaw = data.cols.tipo > 0 ? cell(row, data.cols.tipo) : "";
    const supplierName =
      (data.cols.fornitore > 0 ? cell(row, data.cols.fornitore) : "") || "Sconosciuto";
    const podPdr = data.cols.pod > 0 ? cell(row, data.cols.pod) : "";
    const dateRaw = data.cols.data > 0 ? cell(row, data.cols.data) : "";
    const gettoneRaw = data.cols.gettone > 0 ? cell(row, data.cols.gettone) : "";
    const collabRaw = data.cols.collab > 0 ? cell(row, data.cols.collab) : "";

    if (!firstName && !lastName && !companyName && !podPdr) continue;

    const messages: string[] = [];
    let status: "ok" | "warning" | "error" = "ok";
    let skip = false;

    const type = mapClientType(tipoRaw || (companyName ? "AZIENDA" : "PRIVATO"));
    const insertionDate = parseDate(dateRaw) ?? new Date();
    const gettone =
      Number(String(gettoneRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || 0;

    if (type === "PRIVATO" && !firstName && !lastName) {
      status = "error";
      messages.push("Manca nome/cognome per cliente privato");
      skip = true;
    }
    if (type === "AZIENDA" && !companyName && !firstName) {
      status = "error";
      messages.push("Manca ragione sociale");
      skip = true;
    }

    const collab = resolveCollaborator(collabRaw, users, data.defaultCollabId, defaultName);
    if (collab.warning) {
      if (status === "ok") status = "warning";
      messages.push(collab.warning);
    }

    const podKey = normalizePodKey(podPdr);
    if (podKey) {
      if (seenInFile.has(podKey)) {
        if (status !== "error") status = "warning";
        messages.push("POD/PDR duplicato nello stesso file");
        if (data.skipPodDuplicates) skip = true;
      } else {
        seenInFile.add(podKey);
      }
      const hit = podMap.get(podKey);
      if (hit) {
        if (status !== "error") status = "warning";
        messages.push(
          `POD già in CRM (${hit.contractNumber}${hit.isHistorical ? ", storico" : ""})`,
        );
        if (data.skipPodDuplicates) skip = true;
      }
    } else {
      if (status !== "error") status = "warning";
      messages.push("POD/PDR assente");
    }

    if (gettone === 0) {
      if (status !== "error") status = "warning";
      messages.push("Gettone 0");
    }

    const clientLabel =
      type === "AZIENDA"
        ? companyName || firstName || "—"
        : [firstName, lastName].filter(Boolean).join(" ") || "—";

    rows.push({
      row: r,
      status: skip && status === "ok" ? "warning" : status,
      messages,
      clientLabel,
      type,
      supplierName,
      podPdr,
      gettone,
      collaboratorName: collab.name,
      collaboratorId: collab.id,
      insertionDate: insertionDate.toISOString().slice(0, 10),
      skip,
    });
  }

  void sessionId;
  return { rows, users, defaultName };
}

/**
 * Anteprima import (nessuna scrittura DB).
 */
export async function previewHistoricalExcelAction(
  formData: FormData,
): Promise<ArchivePreviewResult> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    return { error: "Solo admin/segreteria può importare lo storico" };
  }

  const loaded = await loadSheetFromForm(formData);
  if ("error" in loaded) return { error: loaded.error };

  const { rows } = await buildPreviewRows(loaded.data, session.id);
  const summary = {
    ok: rows.filter((r) => r.status === "ok" && !r.skip).length,
    warning: rows.filter((r) => r.status === "warning" && !r.skip).length,
    error: rows.filter((r) => r.status === "error" || r.skip).length,
    total: rows.length,
  };

  return { label: loaded.data.label, rows, summary };
}

/**
 * Import Excel contratti già pagati → archivio storico (dopo anteprima).
 * Colonne: Nome, Cognome, Ragione sociale, Tipo, Fornitore, POD/PDR, Data, Gettone, Collaboratore
 */
export async function importHistoricalExcelAction(
  formData: FormData,
): Promise<{ error?: string; imported?: number; skipped?: number; label?: string }> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    return { error: "Solo admin/segreteria può importare lo storico" };
  }

  const loaded = await loadSheetFromForm(formData);
  if ("error" in loaded) return { error: loaded.error };
  const data = loaded.data;

  const { rows: preview } = await buildPreviewRows(data, session.id);
  const importable = preview.filter((r) => !r.skip && r.status !== "error");
  if (importable.length === 0) {
    return {
      error: "Nessuna riga importabile. Controlla errori/doppioni nell’anteprima.",
      label: data.label,
      imported: 0,
      skipped: preview.length,
    };
  }

  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
    },
    select: { id: true, name: true, email: true },
  });
  const defaultUser = users.find((u) => u.id === data.defaultCollabId);
  const defaultName = defaultUser?.name ?? "Default";

  let imported = 0;
  let skipped = preview.length - importable.length;

  for (const p of importable) {
    const row = data.sheet.getRow(p.row);
    const firstName = data.cols.nome > 0 ? cell(row, data.cols.nome) : "";
    const lastName = data.cols.cognome > 0 ? cell(row, data.cols.cognome) : "";
    const companyName = data.cols.ragione > 0 ? cell(row, data.cols.ragione) : "";
    const tipoRaw = data.cols.tipo > 0 ? cell(row, data.cols.tipo) : "";
    const supplierName =
      (data.cols.fornitore > 0 ? cell(row, data.cols.fornitore) : "") || "Sconosciuto";
    const podPdr = data.cols.pod > 0 ? cell(row, data.cols.pod) : "";
    const dateRaw = data.cols.data > 0 ? cell(row, data.cols.data) : "";
    const gettoneRaw = data.cols.gettone > 0 ? cell(row, data.cols.gettone) : "";
    const collabRaw = data.cols.collab > 0 ? cell(row, data.cols.collab) : "";

    const type = mapClientType(tipoRaw || (companyName ? "AZIENDA" : "PRIVATO"));
    const insertionDate = parseDate(dateRaw) ?? new Date();
    const expected =
      Number(String(gettoneRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || 0;
    const collab = resolveCollaborator(
      collabRaw,
      users,
      data.defaultCollabId,
      defaultName,
    );

    // Re-check POD al commit (race / skip)
    const podKey = normalizePodKey(podPdr);
    if (podKey && data.skipPodDuplicates) {
      const existing = await prisma.contract.findFirst({
        where: {
          deletedAt: null,
          OR: [{ podPdr: podPdr }, { podPdr: podKey }, { pod: podKey }, { pdr: podKey }],
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
    }

    const supplierCode =
      supplierName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 40) || "SCONOSCIUTO";

    let supplier = await prisma.supplier.findFirst({
      where: {
        OR: [{ code: supplierCode }, { name: { equals: supplierName, mode: "insensitive" } }],
      },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: supplierName || "Sconosciuto",
          code: `${supplierCode}_${Date.now()}`.slice(0, 50),
        },
      });
    }

    // Riusa cliente se possibile (evita anagrafiche duplicate)
    let client =
      type === "PRIVATO" && (firstName || lastName)
        ? await prisma.client.findFirst({
            where: {
              deletedAt: null,
              type: "PRIVATO",
              firstName: firstName || null,
              lastName: lastName || null,
            },
          })
        : type === "AZIENDA" && (companyName || firstName)
          ? await prisma.client.findFirst({
              where: {
                deletedAt: null,
                type: "AZIENDA",
                companyName: companyName || firstName || undefined,
              },
            })
          : null;

    if (!client) {
      client = await prisma.client.create({
        data: {
          type,
          firstName: type === "PRIVATO" ? firstName || null : null,
          lastName: type === "PRIVATO" ? lastName || null : null,
          companyName:
            type === "AZIENDA" ? companyName || firstName || null : companyName || null,
          createdById: session.id,
        },
      });
    }

    const contractNumber = await generateContractNumber();
    const op = normalizeOperationType("CAMBIO");
    const supplyStartDate = computeSupplyStartDate(insertionDate, op);

    const contract = await prisma.contract.create({
      data: {
        contractNumber,
        externalId: `hist-${data.label}-${p.row}-${Date.now()}`.slice(0, 80),
        clientId: client.id,
        collaboratorId: collab.id,
        createdById: session.id,
        supplierId: supplier.id,
        status: "CHIUSO",
        podPdr: podPdr || null,
        insertionDate,
        supplyStartDate,
        operationType: op,
        paymentStatus: "Incassato",
        collectionDate: insertionDate,
        isHistorical: true,
        archiveLabel: data.label,
        commissionConfirmed: true,
        commissionConfirmedAt: new Date(),
      },
    });

    // Sempre commission (anche gettone 0)
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
  return { imported, skipped, label: data.label };
}
