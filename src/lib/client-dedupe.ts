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
      await prisma.contract.updateMany({
        where: { clientId: src.id },
        data: { clientId: keeper.id },
      });
      await prisma.document.updateMany({
        where: { clientId: src.id },
        data: { clientId: keeper.id },
      });

      await prisma.client.update({
        where: { id: keeper.id },
        data: {
          companyName: mergeField(keeper.companyName, src.companyName),
          firstName: mergeField(keeper.firstName, src.firstName),
          lastName: mergeField(keeper.lastName, src.lastName),
          fiscalCode: mergeField(keeper.fiscalCode, src.fiscalCode),
          vatNumber: mergeField(keeper.vatNumber, src.vatNumber),
          phone: mergeField(keeper.phone, src.phone),
          email: mergeField(keeper.email, src.email),
          pec: mergeField(keeper.pec, src.pec),
          iban: mergeField(keeper.iban, src.iban),
          address: mergeField(keeper.address, src.address),
          street: mergeField(keeper.street, src.street),
          streetNumber: mergeField(keeper.streetNumber, src.streetNumber),
          zipCode: mergeField(keeper.zipCode, src.zipCode),
          city: mergeField(keeper.city, src.city),
          province: mergeField(keeper.province, src.province),
          region: mergeField(keeper.region, src.region),
          notes: mergeField(keeper.notes, src.notes),
        },
      });

      keeper.companyName = mergeField(keeper.companyName, src.companyName);
      keeper.fiscalCode = mergeField(keeper.fiscalCode, src.fiscalCode);
      keeper.vatNumber = mergeField(keeper.vatNumber, src.vatNumber);
      keeper._count.contracts += src._count.contracts;

      await prisma.client.update({
        where: { id: src.id },
        data: {
          deletedAt: new Date(),
          notes: `[UNITO in ${keeper.id}] ${src.notes ?? ""}`.slice(0, 2000),
        },
      });
      clientsRemoved++;
    }
    mergedGroups++;
  }

  return { mergedGroups, clientsRemoved };
}
