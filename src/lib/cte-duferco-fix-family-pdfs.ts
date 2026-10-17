import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { DUFERCO_FIX_FAMILY_GAS_PDF_FILES } from "@/lib/cte-duferco-fix-family-listino";
import { matchSupplierId } from "@/lib/cte-pdf-parse";

const GAS_PDF_DIR = join(process.cwd(), "public", "cte", "duferco-fix-family");

/** Allega i PDF gas da `public/cte/duferco-fix-family/` alle CTE upsertate (idempotente). */
export async function attachDufercoFixFamilyGasPdfs(
  prisma: PrismaClient,
  suppliers: Array<{ id: string; name: string; code?: string | null }>,
): Promise<number> {
  const match = matchSupplierId("Duferco Energia", suppliers);
  if (!match.supplierId) return 0;
  let attached = 0;
  const now = new Date();
  for (const row of DUFERCO_FIX_FAMILY_GAS_PDF_FILES) {
    const path = join(GAS_PDF_DIR, row.filename);
    if (!existsSync(path)) continue;
    const offer = await prisma.cteOffer.findFirst({
      where: {
        supplierId: match.supplierId,
        offerName: row.offerName,
        utility: row.utility,
        category: "RESIDENZIALE",
      },
      select: { id: true },
    });
    if (!offer) continue;
    const buffer = readFileSync(path);
    await prisma.cteOffer.update({
      where: { id: offer.id },
      data: {
        pdfFilename: row.filename,
        pdfMimeType: "application/pdf",
        pdfContentBase64: buffer.toString("base64"),
        pdfStorageKey: `public://cte/duferco-fix-family/${row.filename}`,
        pdfUploadedAt: now,
      },
    });
    attached += 1;
  }
  return attached;
}
