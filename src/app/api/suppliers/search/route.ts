import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ items: [] });

  const suppliers = await prisma.supplier.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 15,
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    items: suppliers.map((s) => ({ id: s.id, label: s.name, code: s.code })),
  });
}
