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

function identityFieldsOr(
  term: string,
  mode: "insensitive",
): Prisma.ClientWhereInput[] {
  return [
    { firstName: { contains: term, mode } },
    { lastName: { contains: term, mode } },
    { companyName: { contains: term, mode } },
    { fiscalCode: { contains: term, mode } },
    { vatNumber: { contains: term, mode } },
    { email: { contains: term, mode } },
    { phone: { contains: term, mode } },
  ];
}

/**
 * Condizioni di ricerca.
 * - 1 parola (es. «Rossi» o CF): OR su i campi anagrafica
 * - 2+ token (es. «Rossi Mario»): ogni token deve matchare (AND),
 *   così non escono tutti i Rossi + tutti i Mario mescolati
 */
function buildWhere(q: string): Prisma.ClientWhereInput {
  const tokens = q.split(/\s+/).filter(Boolean);
  const mode = "insensitive" as const;

  if (tokens.length <= 1) {
    const t = tokens[0] ?? q;
    return { deletedAt: null, OR: identityFieldsOr(t, mode) };
  }

  const meaningful = tokens.filter((t) => t.length >= 2);
  if (meaningful.length === 0) {
    return { deletedAt: null, OR: identityFieldsOr(q, mode) };
  }

  // Ogni pezzo deve trovare qualcosa (nome+cognome, cognome+CF, …)
  const andTokens: Prisma.ClientWhereInput[] = meaningful.map((t) => ({
    OR: identityFieldsOr(t, mode),
  }));

  // Match anche su stringa intera (ragione sociale / CF con spazi)
  return {
    deletedAt: null,
    OR: [
      { companyName: { contains: q, mode } },
      { fiscalCode: { contains: q.replace(/\s+/g, ""), mode } },
      { AND: andTokens },
    ],
  };
}

/** Punteggio: privilegia chi ha cognome+nome che combaciano con i token. */
function matchScore(
  c: {
    type: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    fiscalCode?: string | null;
    vatNumber?: string | null;
  },
  q: string,
): number {
  const tokens = q
    .split(/\s+/)
    .map(fold)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;

  const first = fold(c.firstName);
  const last = fold(c.lastName);
  const company = fold(c.companyName);
  const cf = fold(c.fiscalCode).replace(/\s+/g, "");
  const vat = fold(c.vatNumber).replace(/\s+/g, "");

  let score = 0;

  if (tokens.length >= 2) {
    const a = tokens[0]!;
    const b = tokens[tokens.length - 1]!;
    // Cognome Nome
    if (last.includes(a) && first.includes(b)) score += 100;
    // Nome Cognome
    if (first.includes(a) && last.includes(b)) score += 90;
    // Tutti i token nel cognome+nome
    if (tokens.every((t) => last.includes(t) || first.includes(t))) score += 40;
  } else {
    const t = tokens[0]!;
    if (last === t || first === t || company === t) score += 80;
    else if (last.startsWith(t) || first.startsWith(t)) score += 50;
    else if (last.includes(t) || first.includes(t)) score += 30;
  }

  if (tokens.some((t) => cf.includes(t.replace(/\s+/g, "")) || vat.includes(t))) {
    score += 60;
  }
  if (company && tokens.every((t) => company.includes(t))) score += 50;

  return score;
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

  // Prendi più righe del necessario, poi ordina per pertinenza e deduplica
  const clients = await prisma.client.findMany({
    where: buildWhere(q),
    take: 80,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { updatedAt: "desc" }],
  });

  clients.sort((a, b) => matchScore(b, q) - matchScore(a, q));

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
