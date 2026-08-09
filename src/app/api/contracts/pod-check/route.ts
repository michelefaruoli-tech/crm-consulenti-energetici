import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { normalizePodKey } from "@/lib/storno-status";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const value = new URL(request.url).searchParams.get("value")?.trim() ?? "";
  const key = normalizePodKey(value);
  if (key.length < 6) return NextResponse.json({ matches: [] });

  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { pod: { in: [value, key], mode: "insensitive" } },
        { pdr: { in: [value, key], mode: "insensitive" } },
        { podPdr: { in: [value, key], mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      status: true,
      pod: true,
      pdr: true,
      podPdr: true,
      supplyStartDate: true,
      isHistorical: true,
      client: { select: { type: true, firstName: true, lastName: true, companyName: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    matches: rows
      .filter((row) => normalizePodKey(row.pod || row.pdr || row.podPdr) === key)
      .map((row) => ({
        id: row.id,
        client: clientDisplayName(row.client),
        supplier: row.supplier.name,
        status: row.status,
        supplyStartDate: row.supplyStartDate?.toISOString() ?? null,
        archived: row.isHistorical,
      })),
  });
}
