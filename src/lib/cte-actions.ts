"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isAllowedAttachment } from "@/lib/attachment-config";
import { CTE_PDF_MAX_BYTES, parseCteFormData } from "@/lib/cte-form-schema";
import { userCanManageCteOffer } from "@/lib/cte-scope";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type CteActionResult = { ok: true; id?: string } | { ok: false; error: string };

function assertManagePermission(role: Parameters<typeof hasPermission>[0]): void {
  if (!hasPermission(role, "cte.catalog.manage")) {
    throw new Error("Permesso negato");
  }
}

async function readOptionalPdf(formData: FormData): Promise<{
  pdfFilename: string | null;
  pdfMimeType: string | null;
  pdfContentBase64: string | null;
  pdfStorageKey: string | null;
  pdfUploadedAt: Date | null;
  error?: string;
}> {
  const file = formData.get("pdfFile");
  if (!file || typeof file === "string") {
    return {
      pdfFilename: null,
      pdfMimeType: null,
      pdfContentBase64: null,
      pdfStorageKey: null,
      pdfUploadedAt: null,
    };
  }
  if (!(file instanceof File) || file.size <= 0) {
    return {
      pdfFilename: null,
      pdfMimeType: null,
      pdfContentBase64: null,
      pdfStorageKey: null,
      pdfUploadedAt: null,
    };
  }
  if (file.size > CTE_PDF_MAX_BYTES) {
    return {
      pdfFilename: null,
      pdfMimeType: null,
      pdfContentBase64: null,
      pdfStorageKey: null,
      pdfUploadedAt: null,
      error: `PDF troppo grande (max ${CTE_PDF_MAX_BYTES / (1024 * 1024)} MB)`,
    };
  }
  const mime = file.type || "application/pdf";
  if (!isAllowedAttachment(file.name, mime)) {
    return {
      pdfFilename: null,
      pdfMimeType: null,
      pdfContentBase64: null,
      pdfStorageKey: null,
      pdfUploadedAt: null,
      error: "Formato PDF non consentito",
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  return {
    pdfFilename: file.name,
    pdfMimeType: mime,
    pdfContentBase64: buffer.toString("base64"),
    pdfStorageKey: `db://cte-${now.getTime()}`,
    pdfUploadedAt: now,
  };
}

function offerDataFromParsed(parsed: ReturnType<typeof parseCteFormData>) {
  return {
    supplierId: parsed.supplierId,
    utility: parsed.utility,
    category: parsed.category,
    commercialSegment: parsed.commercialSegment?.trim() || null,
    offerName: parsed.offerName.trim(),
    priceKind: parsed.priceKind,
    powerKwMin: parsed.powerKwMin,
    powerKwMax: parsed.powerKwMax,
    annualConsumptionMin: parsed.annualConsumptionMin,
    annualConsumptionMax: parsed.annualConsumptionMax,
    referenceConsumption: parsed.referenceConsumption,
    networkLosses: parsed.networkLosses,
    ccvAnnual: parsed.ccvAnnual,
    ccvMonthly: parsed.ccvMonthly,
    spread: parsed.spread,
    validFrom: parsed.validFrom,
    validTo: parsed.validTo,
    notes: parsed.notes?.trim() || null,
    extractionStatus: "manual" as const,
  };
}

async function replacePriceBands(
  cteOfferId: string,
  bands: ReturnType<typeof parseCteFormData>["bands"],
): Promise<void> {
  const existing = await prisma.ctePriceBand.findMany({
    where: { cteOfferId },
    select: { id: true },
  });
  for (const band of existing) {
    await prisma.ctePriceBand.delete({ where: { id: band.id } });
  }
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    await prisma.ctePriceBand.create({
      data: {
        cteOfferId,
        timeBand: band.timeBand,
        energyPrice: band.energyPrice,
        sortOrder: i,
      },
    });
  }
}

export async function createCteOfferAction(formData: FormData): Promise<CteActionResult> {
  const session = await requireSession();
  assertManagePermission(session.role);

  let parsed;
  try {
    parsed = parseCteFormData(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Dati non validi" };
  }

  if (!(await userCanManageCteOffer(session, parsed.supplierId))) {
    return { ok: false, error: "Fornitore fuori dal tuo scope" };
  }

  const pdf = await readOptionalPdf(formData);
  if (pdf.error) return { ok: false, error: pdf.error };

  const offer = await prisma.cteOffer.create({
    data: {
      ...offerDataFromParsed(parsed),
      pdfFilename: pdf.pdfFilename,
      pdfMimeType: pdf.pdfMimeType,
      pdfContentBase64: pdf.pdfContentBase64,
      pdfStorageKey: pdf.pdfStorageKey,
      pdfUploadedAt: pdf.pdfUploadedAt,
    },
  });

  await replacePriceBands(offer.id, parsed.bands);

  await writeAuditLog({
    userId: session.id,
    action: "CREATE_CTE_OFFER",
    entity: "CteOffer",
    entityId: offer.id,
    details: { offerName: offer.offerName, supplierId: offer.supplierId },
  });

  revalidatePath("/catalogo-cte");
  return { ok: true, id: offer.id };
}

export async function updateCteOfferAction(formData: FormData): Promise<CteActionResult> {
  const session = await requireSession();
  assertManagePermission(session.role);

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "ID mancante" };

  const existing = await prisma.cteOffer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Offerta non trovata" };

  if (!(await userCanManageCteOffer(session, existing.supplierId))) {
    return { ok: false, error: "Permesso negato" };
  }

  let parsed;
  try {
    parsed = parseCteFormData(formData);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Dati non validi" };
  }

  if (!(await userCanManageCteOffer(session, parsed.supplierId))) {
    return { ok: false, error: "Fornitore fuori dal tuo scope" };
  }

  const removePdf = String(formData.get("removePdf") ?? "") === "1";
  const pdf = await readOptionalPdf(formData);
  if (pdf.error) return { ok: false, error: pdf.error };

  const pdfPatch =
    pdf.pdfContentBase64 != null
      ? {
          pdfFilename: pdf.pdfFilename,
          pdfMimeType: pdf.pdfMimeType,
          pdfContentBase64: pdf.pdfContentBase64,
          pdfStorageKey: pdf.pdfStorageKey,
          pdfUploadedAt: pdf.pdfUploadedAt,
        }
      : removePdf
        ? {
            pdfFilename: null,
            pdfMimeType: null,
            pdfContentBase64: null,
            pdfStorageKey: null,
            pdfUploadedAt: null,
          }
        : {};

  await prisma.cteOffer.update({
    where: { id },
    data: {
      ...offerDataFromParsed(parsed),
      ...pdfPatch,
    },
  });

  await replacePriceBands(id, parsed.bands);

  await writeAuditLog({
    userId: session.id,
    action: "UPDATE_CTE_OFFER",
    entity: "CteOffer",
    entityId: id,
    details: { offerName: parsed.offerName },
  });

  revalidatePath("/catalogo-cte");
  revalidatePath(`/catalogo-cte/${id}`);
  return { ok: true, id };
}

export async function deactivateCteOfferAction(formData: FormData): Promise<CteActionResult> {
  const session = await requireSession();
  assertManagePermission(session.role);

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "ID mancante" };

  const existing = await prisma.cteOffer.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Offerta non trovata" };
  if (!(await userCanManageCteOffer(session, existing.supplierId))) {
    return { ok: false, error: "Permesso negato" };
  }

  await prisma.cteOffer.update({
    where: { id },
    data: { active: false },
  });

  await writeAuditLog({
    userId: session.id,
    action: "DEACTIVATE_CTE_OFFER",
    entity: "CteOffer",
    entityId: id,
    details: { offerName: existing.offerName },
  });

  revalidatePath("/catalogo-cte");
  return { ok: true };
}
