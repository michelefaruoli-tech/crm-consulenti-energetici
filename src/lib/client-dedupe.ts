import { prisma } from "@/lib/prisma";

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normTax(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

type ClientRow = {
  id: string;
  type: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  fiscalCode: string | null;
  vatNumber: string | null;
  phone: string | null;
  email: string | null;
  pec: string | null;
  iban: string | null;
  address: string | null;
  street: string | null;
  streetNumber: string | null;
  zipCode: string | null;
  city: string | null;
  province: string | null;
  region: string | null;
  notes: string | null;
  createdAt: Date;
  _count: { contracts: number };
};

/**
 * Chiave di unione:
 * - Business: ragione sociale + P.IVA (se c’è) oppure CF, altrimenti solo nome
 * - Privato: cognome+nome + CF se c’è, altrimenti solo nome
 * Omonimi con CF/P.IVA diversi → NON unire.
 */
export function clientMergeKey(c: {
  type: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
}): string | null {
  const vat = normTax(c.vatNumber);
  const cf = normTax(c.fiscalCode);
  if (c.type === "AZIENDA") {
    const name = norm(c.companyName);
    if (!name || name.length < 2) return null;
    if (vat) return `A|${name}|VAT:${vat}`;
    if (cf) return `A|${name}|CF:${cf}`;
    return `A|${name}|NOME`;
  }
  const cognome = norm(c.lastName);
  const nome = norm(c.firstName);
  if (!cognome && !nome) return null;
  const person = `${cognome}|${nome}`;
  if (cf) return `P|${person}|CF:${cf}`;
  return `P|${person}|NOME`;
}

function pickKeeper(group: ClientRow[]): ClientRow {
  return [...group].sort((a, b) => {
    if (b._count.contracts !== a._count.contracts) {
      return b._count.contracts - a._count.contracts;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0]!;
}

function mergeField(keeper: string | null, other: string | null): string | null {
  if (keeper?.trim()) return keeper;
  if (other?.trim()) return other;
  return keeper ?? other;
}

export type MergeClientIntoResult = {
  contractsMoved: number;
  documentsMoved: number;
  agendaMoved: number;
  keeperId: string;
  sourceId: string;
};

type MergeClientFields = {
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  fiscalCode: string | null;
  vatNumber: string | null;
  phone: string | null;
  email: string | null;
  pec: string | null;
  iban: string | null;
  address: string | null;
  street: string | null;
  streetNumber: string | null;
  zipCode: string | null;
  city: string | null;
  province: string | null;
  region: string | null;
  notes: string | null;
};

/**
 * Unisce `sourceId` sotto `keeperId`: sposta contratti/documenti/agenda,
 * completa i campi vuoti del keeper, soft-delete della fonte.
 * Neon HTTP: niente `$transaction` / `updateMany` — solo `$executeRawUnsafe`.
 */
export async function mergeClientIntoKeeper(
  sourceId: string,
  keeperId: string,
): Promise<MergeClientIntoResult> {
  if (sourceId === keeperId) {
    throw new Error("Seleziona un’anagrafica diversa da quella corrente");
  }

  const [source, keeper] = await Promise.all([
    prisma.client.findFirst({
      where: { id: sourceId, deletedAt: null },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        fiscalCode: true,
        vatNumber: true,
        phone: true,
        email: true,
        pec: true,
        iban: true,
        address: true,
        street: true,
        streetNumber: true,
        zipCode: true,
        city: true,
        province: true,
        region: true,
        notes: true,
        _count: {
          select: {
            contracts: { where: { deletedAt: null } },
            documents: true,
            agendaItems: true,
          },
        },
      },
    }),
    prisma.client.findFirst({
      where: { id: keeperId, deletedAt: null },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        fiscalCode: true,
        vatNumber: true,
        phone: true,
        email: true,
        pec: true,
        iban: true,
        address: true,
        street: true,
        streetNumber: true,
        zipCode: true,
        city: true,
        province: true,
        region: true,
        notes: true,
      },
    }),
  ]);

  if (!source) throw new Error("Anagrafica da unire non trovata");
  if (!keeper) throw new Error("Anagrafica di destinazione non trovata");

  const contractsMoved = source._count.contracts;
  const documentsMoved = source._count.documents;
  const agendaMoved = source._count.agendaItems;

  // SQL grezzo: Prisma avvolge updateMany in una transazione, non supportata
  // dall'adapter Neon HTTP.
  await prisma.$executeRawUnsafe(
    `UPDATE "Contract" SET "clientId" = $1 WHERE "clientId" = $2`,
    keeper.id,
    source.id,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "Document" SET "clientId" = $1 WHERE "clientId" = $2`,
    keeper.id,
    source.id,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "AgendaItem" SET "clientId" = $1 WHERE "clientId" = $2`,
    keeper.id,
    source.id,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "ClientHistory" SET "clientId" = $1 WHERE "clientId" = $2`,
    keeper.id,
    source.id,
  );

  const patched: MergeClientFields = {
    companyName: mergeField(keeper.companyName, source.companyName),
    firstName: mergeField(keeper.firstName, source.firstName),
    lastName: mergeField(keeper.lastName, source.lastName),
    fiscalCode: mergeField(keeper.fiscalCode, source.fiscalCode),
    vatNumber: mergeField(keeper.vatNumber, source.vatNumber),
    phone: mergeField(keeper.phone, source.phone),
    email: mergeField(keeper.email, source.email),
    pec: mergeField(keeper.pec, source.pec),
    iban: mergeField(keeper.iban, source.iban),
    address: mergeField(keeper.address, source.address),
    street: mergeField(keeper.street, source.street),
    streetNumber: mergeField(keeper.streetNumber, source.streetNumber),
    zipCode: mergeField(keeper.zipCode, source.zipCode),
    city: mergeField(keeper.city, source.city),
    province: mergeField(keeper.province, source.province),
    region: mergeField(keeper.region, source.region),
    notes: mergeField(keeper.notes, source.notes),
  };

  await prisma.client.update({
    where: { id: keeper.id },
    data: patched,
  });

  await prisma.client.update({
    where: { id: source.id },
    data: {
      deletedAt: new Date(),
      notes: `[UNITO in ${keeper.id}] ${source.notes ?? ""}`.slice(0, 2000),
    },
  });

  return {
    contractsMoved,
    documentsMoved,
    agendaMoved,
    keeperId: keeper.id,
    sourceId: source.id,
  };
}

/**
 * Unisce anagrafiche duplicate.
 * Sposta contratti/documenti sul keeper e soft-delete le altre.
 */
export async function mergeDuplicateClientsOnce(): Promise<{
  mergedGroups: number;
  clientsRemoved: number;
}> {
  const clients = await prisma.client.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      type: true,
      companyName: true,
      firstName: true,
      lastName: true,
      fiscalCode: true,
      vatNumber: true,
      phone: true,
      email: true,
      pec: true,
      iban: true,
      address: true,
      street: true,
      streetNumber: true,
      zipCode: true,
      city: true,
      province: true,
      region: true,
      notes: true,
      createdAt: true,
      _count: {
        select: { contracts: { where: { deletedAt: null } } },
      },
    },
    take: 5000,
  });

  const groups = new Map<string, ClientRow[]>();
  for (const c of clients) {
    const key = clientMergeKey(c);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  let mergedGroups = 0;
  let clientsRemoved = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const cfs = [
      ...new Set(
        group.map((g) => normTax(g.fiscalCode)).filter((x) => x.length >= 8),
      ),
    ];
    const vats = [
      ...new Set(
        group.map((g) => normTax(g.vatNumber)).filter((x) => x.length >= 8),
      ),
    ];
    if (cfs.length > 1 || vats.length > 1) continue;

    const keeper = pickKeeper(group);
    const sources = group.filter((g) => g.id !== keeper.id);
    if (!sources.length) continue;

    for (const src of sources) {
      const result = await mergeClientIntoKeeper(src.id, keeper.id);
      keeper.companyName = mergeField(keeper.companyName, src.companyName);
      keeper.fiscalCode = mergeField(keeper.fiscalCode, src.fiscalCode);
      keeper.vatNumber = mergeField(keeper.vatNumber, src.vatNumber);
      keeper._count.contracts += result.contractsMoved;
      clientsRemoved++;
    }
    mergedGroups++;
  }

  return { mergedGroups, clientsRemoved };
}
