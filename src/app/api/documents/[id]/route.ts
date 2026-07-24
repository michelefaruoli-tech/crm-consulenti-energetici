import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canViewContract, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { contract: { select: { collaboratorId: true } } },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.contract) {
    const ok =
      hasPermission(session.role, "contracts.edit_all") ||
      canViewContract(session.role, session.id, doc.contract.collaboratorId);
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (!hasPermission(session.role, "documents.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!doc.contentBase64) {
    return NextResponse.json(
      { error: "File non disponibile (solo metadati)" },
      { status: 404 },
    );
  }

  const buf = Buffer.from(doc.contentBase64, "base64");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
