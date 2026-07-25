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
  supplyStartDate?: string;
  paid?: boolean;
  paymentDate?: string;
  phone?: string;
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
  if (
    v.includes("BUSINESS") ||
    v.includes("AZIENDA") ||
    v === "BOX" ||
    v.includes("CORPORATE") ||
    v.includes("COORPORATE")
  ) {
    return "AZIENDA";
  }
  return "PRIVATO";
}

function parsePaidFlag(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (["sì", "si", "yes", "y", "1", "true", "pagato", "incassato", "ok"].includes(v)) {
    return true;
  }
  if (["no", "n", "0", "false", "ko", "non pagato", "da incassare"].includes(v)) {
    return false;
  }
  return null;
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
    dataFornitura: number;
    pagamento: number;
    dataPagamento: number;
    telefono: number;
    gettone: number;
    collab: number;
    note: number;
    consumi: number;
    storno: number;
    agenzia: number;
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

  /** Preferisce match esatto, poi includes (ordine = priorità). */
  function colPrefer(...names: string[]): number {
    for (const name of names) {
      for (let i = 1; i < headers.length; i++) {
        if ((headers[i] ?? "") === name) return i;
      }
    }
    for (const name of names) {
      for (let i = 1; i < headers.length; i++) {
        const h = headers[i] ?? "";
        if (h.includes(name)) return i;
      }
    }
    return -1;
  }

  const cols = {
    nome: colPrefer("nome"),
    cognome: colPrefer("cognome"),
    ragione: colPrefer("ragione sociale", "ragione", "azienda", "company"),
    tipo: colPrefer("tipo", "tipologia"),
    fornitore: colPrefer("fornitore", "supplier"),
    pod: colPrefer("pod/pdr", "pod", "pdr"),
    data: colPrefer("data inserimento", "inserimento", "caricato", "data"),
    dataFornitura: colPrefer(
      "data ingresso fornitura",
      "ingresso fornitura",
      "data fornitura",
      "esecutivo",
      "inizio fornitura",
    ),
    pagamento: colPrefer("pagamento", "pagato"),
    dataPagamento: colPrefer("data pagamento", "data incasso"),
    telefono: colPrefer("telefono", "cellulare", "phone"),
    gettone: colPrefer("gettone", "provvigione", "expected"),
    collab: colPrefer("collaboratore", "agente"),
    note: colPrefer("note", "note contratto"),
    consumi: colPrefer("consumi", "consumo", "kwh", "smc"),
    storno: colPrefer("mesi storno", "storno"),
    agenzia: colPrefer("agenzia"),
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
    const supplyRaw =
      data.cols.dataFornitura > 0 ? cell(row, data.cols.dataFornitura) : "";
    const pagamentoRaw =
      data.cols.pagamento > 0 ? cell(row, data.cols.pagamento) : "";
    const dataPagamentoRaw =
      data.cols.dataPagamento > 0 ? cell(row, data.cols.dataPagamento) : "";
    const telefono =
      data.cols.telefono > 0 ? cell(row, data.cols.telefono) : "";
    const gettoneRaw = data.cols.gettone > 0 ? cell(row, data.cols.gettone) : "";
    const collabRaw = data.cols.collab > 0 ? cell(row, data.cols.collab) : "";

    if (!firstName && !lastName && !companyName && !podPdr) continue;

    const messages: string[] = [];
    let status: "ok" | "warning" | "error" = "ok";
    let skip = false;

    const type = mapClientType(tipoRaw || (companyName ? "AZIENDA" : "PRIVATO"));
    const insertionDate = parseDate(dateRaw) ?? new Date();
    const supplyStartDate = parseDate(supplyRaw);
    const paymentDate = parseDate(dataPagamentoRaw);
    const paidFlag = parsePaidFlag(pagamentoRaw);
    const paid = paidFlag === true || (paidFlag == null && Boolean(paymentDate));
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
      supplyStartDate: supplyStartDate
        ? supplyStartDate.toISOString().slice(0, 10)
        : undefined,
      paid,
      paymentDate: paymentDate ? paymentDate.toISOString().slice(0, 10) : undefined,
      phone: telefono || undefined,
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
 * Import a lotti (barra di avanzamento).
 * FormData: campi file come anteprima + rowNumbers = JSON array di numeri riga Excel.
 */
export async function importHistoricalExcelBatchAction(
  formData: FormData,
): Promise<{
  error?: string;
  label?: string;
  batchImported: number;
  batchSkipped: number;
  batchSize: number;
  done: boolean;
}> {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.edit_all")) {
    return {
      error: "Solo admin/segreteria può importare lo storico",
      batchImported: 0,
      batchSkipped: 0,
      batchSize: 0,
      done: true,
    };
  }

  const loaded = await loadSheetFromForm(formData);
  if ("error" in loaded) {
    return {
      error: loaded.error,
      batchImported: 0,
      batchSkipped: 0,
      batchSize: 0,
      done: true,
    };
  }
  const data = loaded.data;

  let rowNumbers: number[] = [];
  try {
    const raw = String(formData.get("rowNumbers") ?? "[]");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      rowNumbers = parsed
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 2);
    }
  } catch {
    return {
      error: "Elenco righe non valido",
      batchImported: 0,
      batchSkipped: 0,
      batchSize: 0,
      done: true,
    };
  }

  if (rowNumbers.length === 0) {
    return {
      label: data.label,
      batchImported: 0,
      batchSkipped: 0,
      batchSize: 0,
      done: true,
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

  let batchImported = 0;
  let batchSkipped = 0;

  for (const rowNum of rowNumbers) {
    const ok = await importOneHistoricalRow({
      data,
      previewRow: {
        row: rowNum,
        status: "ok",
        messages: [],
        clientLabel: "",
        type: "PRIVATO",
        supplierName: "",
        podPdr: "",
        gettone: 0,
        collaboratorName: defaultName,
        collaboratorId: data.defaultCollabId,
        insertionDate: "",
        skip: false,
      },
      sessionId: session.id,
      users,
      defaultName,
    });
    if (ok) batchImported += 1;
    else batchSkipped += 1;
  }

  const finalize = String(formData.get("finalize") ?? "") === "1";
  if (finalize) {
    revalidatePath("/archivio");
    revalidatePath("/report");
    revalidatePath("/contratti");
    revalidatePath("/");
    revalidatePath("/provvigioni");
  }

  return {
    label: data.label,
    batchImported,
    batchSkipped,
    batchSize: rowNumbers.length,
    done: finalize,
  };
}

async function importOneHistoricalRow(opts: {
  data: ParsedSheet;
  previewRow: ArchivePreviewRow;
  sessionId: string;
  users: CollabUser[];
  defaultName: string;
}): Promise<boolean> {
  const { data, previewRow: p, sessionId, users, defaultName } = opts;
  const row = data.sheet.getRow(p.row);
  const firstName = data.cols.nome > 0 ? cell(row, data.cols.nome) : "";
  const lastName = data.cols.cognome > 0 ? cell(row, data.cols.cognome) : "";
  const companyName = data.cols.ragione > 0 ? cell(row, data.cols.ragione) : "";
  const tipoRaw = data.cols.tipo > 0 ? cell(row, data.cols.tipo) : "";
  const supplierName =
    (data.cols.fornitore > 0 ? cell(row, data.cols.fornitore) : "") || "Sconosciuto";
  const podPdr = data.cols.pod > 0 ? cell(row, data.cols.pod) : "";
  const dateRaw = data.cols.data > 0 ? cell(row, data.cols.data) : "";
  const supplyRaw =
    data.cols.dataFornitura > 0 ? cell(row, data.cols.dataFornitura) : "";
  const pagamentoRaw =
    data.cols.pagamento > 0 ? cell(row, data.cols.pagamento) : "";
  const dataPagamentoRaw =
    data.cols.dataPagamento > 0 ? cell(row, data.cols.dataPagamento) : "";
  const telefono = data.cols.telefono > 0 ? cell(row, data.cols.telefono) : "";
  const gettoneRaw = data.cols.gettone > 0 ? cell(row, data.cols.gettone) : "";
  const collabRaw = data.cols.collab > 0 ? cell(row, data.cols.collab) : "";
  const notes = data.cols.note > 0 ? cell(row, data.cols.note) : "";
  const consumiRaw = data.cols.consumi > 0 ? cell(row, data.cols.consumi) : "";
  const stornoRaw = data.cols.storno > 0 ? cell(row, data.cols.storno) : "";
  const agenzia = data.cols.agenzia > 0 ? cell(row, data.cols.agenzia) : "";

  if (!firstName && !lastName && !companyName && !podPdr) return false;

  const type = mapClientType(tipoRaw || (companyName ? "AZIENDA" : "PRIVATO"));
  const insertionDate = parseDate(dateRaw) ?? new Date();
  const paymentDate = parseDate(dataPagamentoRaw);
  const paidFlag = parsePaidFlag(pagamentoRaw);
  const paid = paidFlag === true || (paidFlag == null && Boolean(paymentDate));
  const expected =
    Number(String(gettoneRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || 0;
  const consumi =
    Number(String(consumiRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || null;
  const stornoMonths =
    Number(String(stornoRaw).replace(",", ".").replace(/[^\d.-]/g, "")) || null;
  const collab = resolveCollaborator(
    collabRaw,
    users,
    data.defaultCollabId,
    defaultName,
  );

  const podKey = normalizePodKey(podPdr);
  if (podKey && data.skipPodDuplicates) {
    const existing = await prisma.contract.findFirst({
      where: {
        deletedAt: null,
        OR: [{ podPdr: podPdr }, { podPdr: podKey }, { pod: podKey }, { pdr: podKey }],
      },
      select: { id: true },
    });
    if (existing) return false;
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
        phone: telefono || null,
        createdById: sessionId,
      },
    });
  } else if (telefono && !client.phone) {
    await prisma.client.update({
      where: { id: client.id },
      data: { phone: telefono },
    });
  }

  const contractNumber = await generateContractNumber();
  const op = normalizeOperationType("CAMBIO");
  const supplyFromFile = parseDate(supplyRaw);
  const supplyStartDate =
    supplyFromFile ?? computeSupplyStartDate(insertionDate, op);
  const collectionDate = paid ? paymentDate ?? insertionDate : null;

  let stornoEndDate: Date | null = null;
  if (stornoMonths && stornoMonths > 0 && supplyStartDate) {
    stornoEndDate = new Date(supplyStartDate);
    stornoEndDate.setMonth(stornoEndDate.getMonth() + stornoMonths);
  }

  const noteParts = [
    notes,
    stornoMonths && stornoMonths > 0 ? `Storno: ${stornoMonths} mesi` : "",
  ].filter(Boolean);

  const contract = await prisma.contract.create({
    data: {
      contractNumber,
      externalId: `hist-${data.label}-${p.row}-${Date.now()}`.slice(0, 80),
      clientId: client.id,
      collaboratorId: collab.id,
      createdById: sessionId,
      supplierId: supplier.id,
      status: "CHIUSO",
      podPdr: podPdr || null,
      insertionDate,
      supplyStartDate,
      operationType: op,
      paymentStatus: paid ? "Incassato" : "Da incassare",
      paymentDate: paid ? paymentDate ?? null : null,
      collectionDate,
      isHistorical: true,
      archiveLabel: data.label,
      commissionConfirmed: paid,
      commissionConfirmedAt: paid ? new Date() : null,
      notes: noteParts.join(" | ") || null,
      agency: agenzia || null,
      annualKwh: consumi,
      stornoEndDate,
    },
  });

  await prisma.commission.create({
    data: {
      contractId: contract.id,
      expected,
      received: paid ? expected : 0,
      paid: paid ? expected : 0,
      accrued: paid ? expected : 0,
    },
  });

  return true;
}

/**
 * Import Excel completo (compatibilità). Preferire i lotti con barra progresso.
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
      error: "Nessuna riga importabile.",
      label: data.label,
      imported: 0,
      skipped: preview.length,
    };
  }

  let imported = 0;
  let skipped = preview.length - importable.length;
  const BATCH = 30;
  for (let i = 0; i < importable.length; i += BATCH) {
    const slice = importable.slice(i, i + BATCH).map((r) => r.row);
    const fd = formData;
    fd.set("rowNumbers", JSON.stringify(slice));
    const batch = await importHistoricalExcelBatchAction(fd);
    if (batch.error) return { error: batch.error, imported, skipped, label: data.label };
    imported += batch.batchImported;
    skipped += batch.batchSkipped;
  }

  revalidatePath("/archivio");
  revalidatePath("/report");
  revalidatePath("/contratti");
  revalidatePath("/");
  revalidatePath("/provvigioni");
  return { imported, skipped, label: data.label };
}

