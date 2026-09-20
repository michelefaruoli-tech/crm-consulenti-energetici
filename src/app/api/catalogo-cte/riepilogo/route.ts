import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mapDbOffer } from "@/lib/cte-ranking";
import { cteCatalogVisibilityWhere } from "@/lib/cte-scope";
import { buildCteSummaryPayload } from "@/lib/cte-summary-build";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
  }
  if (!hasPermission(session.role, "cte.catalog.view")) {
    return NextResponse.json({ ok: false, error: "Permesso negato" }, { status: 403 });
  }

  const visibility = await cteCatalogVisibilityWhere(session);
  const offers = await prisma.cteOffer.findMany({
    where: { ...visibility, active: true },
    include: {
      supplier: { select: { name: true } },
      priceBands: { orderBy: [{ sortOrder: "asc" }, { timeBand: "asc" }] },
    },
  });

  const payload = buildCteSummaryPayload(offers.map((o) => mapDbOffer(o)));
  return NextResponse.json({ ok: true, ...payload });
}
