import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";

function fold(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Chiave deduplica: stesso nome + stesso CF/P.IVA → stessa persona.
 * CF/P.IVA diversi → omonimi distinti (restano entrambi in elenco).
 */
function personKey(c: {
  type: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
}): string {
  const cf = fold(c.fiscalCode).replace(/\s+/g, "");
  const vat = fold(c.vatNumber).replace(/\s+/g, "");
  const idCode = cf || vat || "";
  if (c.type === "AZIENDA") {
    return `az|${fold(c.companyName)}|${idCode}`;
  }
  return `pr|${fold(c.lastName)}|${fold(c.firstName)}|${idCode}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  // Prendi più righe del necessario, poi deduplica (stesso nome+CF → una sola)
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
    take: 50,
    orderBy: { updatedAt: "desc" },
  });

  const seen = new Set<string>();
  const unique = [];
  for (const c of clients) {
    const key = personKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= 15) break;
  }

  // Se ci sono omonimi (stesso nome, CF diverso), mostra il CF nell'etichetta
  const nameCount = new Map<string, number>();
  for (const c of unique) {
    const nameKey =
      c.type === "AZIENDA"
        ? `az|${fold(c.companyName)}`
        : `pr|${fold(c.lastName)}|${fold(c.firstName)}`;
    nameCount.set(nameKey, (nameCount.get(nameKey) ?? 0) + 1);
  }

  return NextResponse.json({
    items: unique.map((c) => {
      const nameKey =
        c.type === "AZIENDA"
          ? `az|${fold(c.companyName)}`
          : `pr|${fold(c.lastName)}|${fold(c.firstName)}`;
      const hasHomonyms = (nameCount.get(nameKey) ?? 0) > 1;
      const code = (c.fiscalCode || c.vatNumber || "").trim();
      let label = clientDisplayName(c);
      if (hasHomonyms && code) {
        label = `${label} · CF ${code}`;
      }
      return {
        id: c.id,
        label,
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
      };
    }),
  });
}
