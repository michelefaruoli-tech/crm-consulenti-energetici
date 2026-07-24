import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { analyzeDocuments } from "@/lib/ocr/analyze";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE =
  (Number(process.env.MAX_DOCUMENT_SIZE_MB) || 10) * 1024 * 1024;
const MAX_FILES = Number(process.env.MAX_DOCUMENTS_PER_ANALYSIS) || 6;

const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function sniffMime(buf: Buffer, filename: string, declared: string): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return declared || "application/octet-stream";
}

/** Analizza documenti (CI + bolletta) e restituisce JSON strutturato. Non salva il contratto. */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
    }
    if (
      !hasPermission(session.role, "contracts.create") &&
      !hasPermission(session.role, "contracts.edit_all")
    ) {
      return NextResponse.json({ ok: false, error: "Permesso negato" }, { status: 403 });
    }

    const form = await request.formData();
    const files = form.getAll("files");
    const roles = form.getAll("roles");

    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun documento caricato" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { ok: false, error: `Massimo ${MAX_FILES} documenti per analisi` },
        { status: 400 },
      );
    }

    const inputs: Array<{
      filename: string;
      mimeType: string;
      base64: string;
      role: "identity" | "bill" | "other";
    }> = [];

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (!(entry instanceof Blob)) continue;
      if (entry.size <= 0) continue;
      if (entry.size > MAX_SIZE) {
        return NextResponse.json(
          {
            ok: false,
            error: `File troppo grande (max ${Math.round(MAX_SIZE / 1024 / 1024)} MB)`,
          },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await entry.arrayBuffer());
      const filename =
        entry instanceof File && entry.name ? entry.name : `documento-${i + 1}`;
      const mime = sniffMime(buf, filename, entry.type || "");
      if (!ALLOWED.has(mime) && !ALLOWED.has(mime.replace("image/jpg", "image/jpeg"))) {
        return NextResponse.json(
          { ok: false, error: `Formato non supportato: ${filename}. Usa PDF, JPG o PNG.` },
          { status: 400 },
        );
      }
      const roleRaw = String(roles[i] ?? "other");
      const role =
        roleRaw === "identity" || roleRaw === "bill" ? roleRaw : "other";
      inputs.push({
        filename,
        mimeType: mime === "image/jpg" ? "image/jpeg" : mime,
        base64: buf.toString("base64"),
        role,
      });
    }

    if (inputs.length === 0) {
      return NextResponse.json({ ok: false, error: "Nessun file valido" }, { status: 400 });
    }

    // Mistral OCR (a pagamento): solo Admin e solo se spunta la casella
    const wantMistral =
      String(form.get("useMistralOcr") ?? "").toLowerCase() === "true" ||
      String(form.get("useMistralOcr") ?? "") === "1" ||
      String(form.get("useMistralOcr") ?? "") === "on";
    const useMistralOcr = wantMistral && session.role === "ADMIN";

    const { extracted, provider } = await analyzeDocuments(inputs, { useMistralOcr });

    await writeAuditLog({
      userId: session.id,
      action: "OCR_ANALYZE",
      entity: "Document",
      details: {
        fileCount: inputs.length,
        roles: inputs.map((f) => f.role),
        provider,
        useMistralOcr,
        warningCount: extracted.warnings.length,
      },
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, extracted, provider, useMistralOcr });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Errore durante l'analisi documenti";
    console.error("[ocr/analyze]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
