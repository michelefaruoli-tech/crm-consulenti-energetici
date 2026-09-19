import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isAllowedAttachment } from "@/lib/attachment-config";
import { CTE_PDF_MAX_BYTES } from "@/lib/cte-form-schema";
import { matchSupplierId, parseCtePdfText } from "@/lib/cte-pdf-parse";
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
    return NextResponse.json({ ok: false, error: "Carica un PDF della CTE" }, { status: 400 });
  }
  if (entry.size > CTE_PDF_MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `PDF troppo grande (max ${CTE_PDF_MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 },
    );
  }

  const filename = entry instanceof File && entry.name ? entry.name : "cte.pdf";
  const buf = Buffer.from(await entry.arrayBuffer());
  const mime = entry.type || "application/pdf";
  if (!sniffPdf(buf, filename, mime) || !isAllowedAttachment(filename, mime || "application/pdf")) {
    return NextResponse.json({ ok: false, error: "Formato non valido: serve un PDF" }, { status: 400 });
  }

  let text: string;
  let totalPages: number;
  try {
    const extracted = await extractCtePdfText(new Uint8Array(buf));
    text = extracted.text;
    totalPages = extracted.totalPages;
  } catch (e) {
    console.error("[catalogo-cte/parse-pdf]", e);
    return NextResponse.json(
      { ok: false, error: "Impossibile leggere il testo del PDF. Compila i campi a mano." },
      { status: 422 },
    );
  }

  const parsed = parseCtePdfText(text);

  const scope = await loadUserVisibilityScope(session);
  const supplierWhere =
    scope.kind === "scoped" && scope.supplierIds.length > 0
      ? { id: { in: scope.supplierIds }, active: true }
      : scope.kind === "scoped"
        ? { id: "__none__" }
        : { active: true };

  const suppliers = await prisma.supplier.findMany({
    where: supplierWhere,
    select: { id: true, name: true, code: true },
  });
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
    filename,
    totalPages,
    supplierId: match.supplierId,
    supplierMatchName: match.matchedName,
    extracted: parsed,
    textPreview: text.replace(/\s+/g, " ").trim().slice(0, 900),
  });
}
