import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

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

/** Condizioni di ricerca: anche “Cognome Nome” e “Nome Cognome”. */
function buildWhere(q: string): Prisma.ClientWhereInput {
  const tokens = q.split(/\s+/).filter(Boolean);
  const mode = "insensitive" as const;

  const or: Prisma.ClientWhereInput[] = [
    { firstName: { contains: q, mode } },
    { lastName: { contains: q, mode } },
    { companyName: { contains: q, mode } },
    { fiscalCode: { contains: q, mode } },
    { vatNumber: { contains: q, mode } },
    { email: { contains: q, mode } },
    { phone: { contains: q, mode } },
  ];

  for (const t of tokens) {
    if (t.length < 2) continue;
    or.push(
      { firstName: { contains: t, mode } },
      { lastName: { contains: t, mode } },
      { companyName: { contains: t, mode } },
      { fiscalCode: { contains: t, mode } },
      { vatNumber: { contains: t, mode } },
    );
  }

  // Due o più parole: prova cognome+nome e nome+cognome
  if (tokens.length >= 2) {
    const first = tokens[0]!;
    const rest = tokens.slice(1).join(" ");
    const last = tokens[tokens.length - 1]!;
    const head = tokens.slice(0, -1).join(" ");

    or.push(
      { AND: [{ lastName: { contains: first, mode } }, { firstName: { contains: rest, mode } }] },
      { AND: [{ firstName: { contains: first, mode } }, { lastName: { contains: rest, mode } }] },
      { AND: [{ lastName: { contains: head, mode } }, { firstName: { contains: last, mode } }] },
      { AND: [{ firstName: { contains: head, mode } }, { lastName: { contains: last, mode } }] },
    );
  }

  return { deletedAt: null, OR: or };
}

function clientLabel(c: {
  type: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
  phone?: string | null;
}): { label: string; sublabel: string } {
  const name = clientDisplayName(c);
  const cf = (c.fiscalCode || "").trim().toUpperCase();
  const vat = (c.vatNumber || "").trim();
  const phone = (c.phone || "").trim();

  const bits: string[] = [];
  if (cf) bits.push(`CF ${cf}`);
  else if (vat) bits.push(`P.IVA ${vat}`);
  else bits.push("CF non presente");
  if (phone) bits.push(`tel. ${phone}`);

  // Sempre: Cognome Nome · CF … (così si sceglie la persona giusta)
  return {
    label: `${name} · ${bits[0]}`,
    sublabel: bits.slice(1).join(" · "),
  };
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const id = (searchParams.get("id") ?? "").trim();

  // Carica un cliente completo per id (precompilazione form)
  if (id) {
    const c = await prisma.client.findFirst({
      where: { id, deletedAt: null },
    });
    if (!c) return NextResponse.json({ item: null }, { status: 404 });
    const { label, sublabel } = clientLabel(c);
    return NextResponse.json({
      item: {
        id: c.id,
        label,
        sublabel,
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
      },
    });
  }

  if (q.length < 2) return NextResponse.json({ items: [] });

  // Prendi più righe del necessario, poi deduplica (stesso nome+CF → una sola)
  const clients = await prisma.client.findMany({
    where: buildWhere(q),
    take: 80,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { updatedAt: "desc" }],
  });

  const seen = new Set<string>();
  const unique = [];
  for (const c of clients) {
    const key = personKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= 20) break;
  }

  return NextResponse.json({
    items: unique.map((c) => {
      const { label, sublabel } = clientLabel(c);
      return {
        id: c.id,
        label,
        sublabel,
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
