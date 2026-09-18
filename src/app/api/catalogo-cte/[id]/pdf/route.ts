import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCanManageCteOffer } from "@/lib/cte-scope";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Fase 1: PDF solo ADMIN/BACKOFFICE (cte.catalog.manage), non a tutti i viewer.
  if (!hasPermission(session.role, "cte.catalog.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const offer = await prisma.cteOffer.findUnique({
    where: { id },
    select: {
      offerName: true,
      supplierId: true,
      active: true,
      pdfFilename: true,
      pdfMimeType: true,
      pdfContentBase64: true,
    },
  });

  if (!offer || !offer.active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await userCanManageCteOffer(session, offer.supplierId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!offer.pdfContentBase64) {
    return NextResponse.json({ error: "PDF non allegato" }, { status: 404 });
  }

  const buf = Buffer.from(offer.pdfContentBase64, "base64");
  const filename = (offer.pdfFilename || `${offer.offerName}.pdf`).replace(/"/g, "");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": offer.pdfMimeType || "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
