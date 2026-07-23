import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const clients = await prisma.client.findMany({
    where: {
      deletedAt: null,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
        { fiscalCode: { contains: q, mode: "insensitive" } },
        { vatNumber: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 15,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    items: clients.map((c) => ({
      id: c.id,
      label: clientDisplayName(c),
      type: c.type,
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      fiscalCode: c.fiscalCode,
      vatNumber: c.vatNumber,
      phone: c.phone,
      email: c.email,
      pec: c.pec,
      iban: c.iban,
      street: c.street ?? c.address,
      streetNumber: c.streetNumber,
      zipCode: c.zipCode,
      city: c.city,
      province: c.province,
      region: c.region,
      legalFirstName: c.legalFirstName,
      legalLastName: c.legalLastName,
      legalFiscalCode: c.legalFiscalCode,
      sdiCode: c.sdiCode,
      classification: c.classification,
    })),
  });
}
