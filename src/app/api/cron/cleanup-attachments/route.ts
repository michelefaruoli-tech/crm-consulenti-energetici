import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { attachmentConfig } from "@/lib/attachment-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pulizia contenuto Base64 allegati vecchi già inviati (metadati restano).
 * Vercel Cron: Authorization Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = attachmentConfig.retentionDays;
  if (!days || days <= 0) {
    return NextResponse.json({ ok: true, cleared: 0, message: "Retention disabilitata" });
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const docs = await prisma.document.findMany({
    where: {
      contentBase64: { not: null },
      contentClearedAt: null,
      deletedAt: null,
      uploadedAt: { lt: cutoff },
      contract: {
        emailStatus: "SENT",
        status: { in: ["COMPLETATO", "ATTIVATO", "KO", "CHIUSO"] },
      },
    },
    select: { id: true, filename: true, contractId: true },
    take: 100,
  });

  let cleared = 0;
  const now = new Date();
  for (const d of docs) {
    await prisma.document.update({
      where: { id: d.id },
      data: {
        contentBase64: null,
        contentClearedAt: now,
        contentClearedReason: `RETENTION_${days}D`,
        storageProvider: "cleared",
      },
    });
    cleared++;
  }

  return NextResponse.json({
    ok: true,
    cleared,
    days,
    message: `Puliti ${cleared} contenuti allegati (metadati conservati)`,
  });
}
