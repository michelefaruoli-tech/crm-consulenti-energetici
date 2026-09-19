import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isAllowedAttachment } from "@/lib/attachment-config";
import { CTE_PDF_MAX_BYTES } from "@/lib/cte-form-schema";
import { detectListinoFromImageHash, detectListinoFromPdf } from "@/lib/cte-listino-detect";
import { listinoOfferToParseResult } from "@/lib/cte-listino-shared";
import { matchSupplierId, parseCtePdfText, type CtePdfParseResult } from "@/lib/cte-pdf-parse";
import { extractCtePdfText } from "@/lib/cte-pdf-text";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadUserVisibilityScope } from "@/lib/user-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function sniffPdf(buf: Buffer, filename: string, declared: string): boolean {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return true;
  }
  return /\.pdf$/i.test(filename) || declared === "application/pdf";
}

function sniffImage(buf: Buffer, filename: string, declared: string): boolean {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return true;
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true;
  }
  return /\.(png|jpe?g)$/i.test(filename) || /^image\/(png|jpe?g)$/i.test(declared);
}

async function loadSuppliers(session: { id: string; role: Parameters<typeof hasPermission>[0] }) {
  const scope = await loadUserVisibilityScope(session);
  const supplierWhere =
    scope.kind === "scoped" && scope.supplierIds.length > 0
      ? { id: { in: scope.supplierIds }, active: true }
      : scope.kind === "scoped"
        ? { id: "__none__" }
        : { active: true };
  return prisma.supplier.findMany({
    where: supplierWhere,
    select: { id: true, name: true, code: true },
  });
}

function listinoItems(
  parsedRows: CtePdfParseResult[],
  suppliers: Array<{ id: string; name: string; code?: string | null }>,
  filename: string,
) {
  return parsedRows.map((extracted) => {
    const match = matchSupplierId(extracted.supplierName, suppliers);
    return {
      filename,
      supplierId: match.supplierId,
      supplierMatchName: match.matchedName,
      extracted,
      textPreview: extracted.suggestedNotes ?? extracted.offerName ?? filename,
    };
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
  }
  if (!hasPermission(session.role, "cte.catalog.manage")) {
    return NextResponse.json({ ok: false, error: "Permesso negato" }, { status: 403 });
  }

  const form = await request.formData();
  const entry = form.get("pdfFile");
  if (!(entry instanceof Blob) || entry.size <= 0) {
    return NextResponse.json({ ok: false, error: "Carica un PDF o uno screenshot del listino" }, { status: 400 });
  }
  if (entry.size > CTE_PDF_MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File troppo grande (max ${CTE_PDF_MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 },
    );
  }

  const filename = entry instanceof File && entry.name ? entry.name : "cte.pdf";
  const buf = Buffer.from(await entry.arrayBuffer());
  const mime = entry.type || "application/pdf";
  const isPdf = sniffPdf(buf, filename, mime);
  const isImage = sniffImage(buf, filename, mime);
  if ((!isPdf && !isImage) || !isAllowedAttachment(filename, mime || (isImage ? "image/png" : "application/pdf"))) {
    return NextResponse.json(
      { ok: false, error: "Formato non valido: serve un PDF o un'immagine PNG/JPG" },
      { status: 400 },
    );
  }

  const suppliers = await loadSuppliers(session);

  if (isImage) {
    const hash = createHash("sha256").update(buf).digest("hex");
    const known = detectListinoFromImageHash(hash);
    if (known?.offers.length) {
      const extracted = known.offers.map((row) => listinoOfferToParseResult(row, known.layout));
      await writeAuditLog({
        userId: session.id,
        action: "PARSE_CTE_PDF",
        entity: "CteOffer",
        details: {
          filename,
          kind: known.kind,
          offers: extracted.map((e) => e.offerName),
        },
      }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        mode: "listino",
        filename,
        totalPages: 1,
        items: listinoItems(extracted, suppliers, filename),
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error:
          "Screenshot non riconosciuto. Usa le tabelle originali (Dolomiti, Enel Corporate) oppure i PDF CTE/SEV/Compara.",
      },
      { status: 422 },
    );
  }

  const pdfHash = createHash("sha256").update(buf).digest("hex");
  let text: string;
  let totalPages: number;
  try {
    const extracted = await extractCtePdfText(new Uint8Array(buf));
    text = extracted.text;
    totalPages = extracted.totalPages;
  } catch (e) {
    console.error("[catalogo-cte/parse-pdf]", e);
    const hashed = detectListinoFromPdf(pdfHash, "");
    if (!hashed?.offers.length) {
      return NextResponse.json(
        { ok: false, error: "Impossibile leggere il testo del PDF. Compila i campi a mano." },
        { status: 422 },
      );
    }
    text = "";
    totalPages = 1;
  }

  const knownPdf = detectListinoFromPdf(pdfHash, text);
  if (knownPdf?.offers.length) {
    const extracted = knownPdf.offers.map((row) => listinoOfferToParseResult(row, knownPdf.layout));
    await writeAuditLog({
      userId: session.id,
      action: "PARSE_CTE_PDF",
      entity: "CteOffer",
      details: {
        filename,
        kind: knownPdf.kind,
        pages: totalPages,
        offers: extracted.map((e) => e.offerName),
      },
    }).catch(() => undefined);
    return NextResponse.json({
      ok: true,
      mode: "listino",
      filename,
      totalPages,
      items: listinoItems(extracted, suppliers, filename),
    });
  }

  const parsed = parseCtePdfText(text);
  const match = matchSupplierId(parsed.supplierName, suppliers);

  await writeAuditLog({
    userId: session.id,
    action: "PARSE_CTE_PDF",
    entity: "CteOffer",
    details: {
      filename,
      pages: totalPages,
      layout: parsed.layout,
      offerName: parsed.offerName,
      textChars: parsed.textChars,
      filled: parsed.filledFieldLabels,
    },
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    mode: "single",
    filename,
    totalPages,
    supplierId: match.supplierId,
    supplierMatchName: match.matchedName,
    extracted: parsed,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 900),
  });
}
