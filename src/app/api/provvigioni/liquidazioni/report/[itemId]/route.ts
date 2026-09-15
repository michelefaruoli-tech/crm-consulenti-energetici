import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  buildPayoutReportPdf,
  buildPayoutReportXlsx,
  payoutReportFileBase,
} from "@/lib/payout/report-doc";
import { parsePayoutSnapshot } from "@/lib/payout/totals";

/**
 * Scarica il report di liquidazione di un collaboratore.
 *
 * Il documento viene rigenerato dallo snapshot congelato: nessun file è
 * salvato nel database, e la versione resta riproducibile identica.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const session = await requireSession();

  const item = await prisma.payoutReportItem.findUnique({
    where: { id: itemId },
    select: { id: true, collaboratorId: true, snapshotJson: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Report non trovato" }, { status: 404 });
  }

  // Il Master vede tutto; un collaboratore soltanto il proprio report
  const canManage = hasPermission(session.role, "commissions.edit_gettone");
  if (!canManage && item.collaboratorId !== session.id) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 403 });
  }

  const snapshot = parsePayoutSnapshot(item.snapshotJson);
  if (!snapshot) {
    return NextResponse.json(
      { error: "Report non ancora generato" },
      { status: 409 },
    );
  }

  const base = payoutReportFileBase(snapshot);
  const formato = req.nextUrl.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";

  if (formato === "pdf") {
    const pdf = buildPayoutReportPdf(snapshot);
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
      },
    });
  }

  const xlsx = await buildPayoutReportXlsx(snapshot);
  return new NextResponse(xlsx as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
