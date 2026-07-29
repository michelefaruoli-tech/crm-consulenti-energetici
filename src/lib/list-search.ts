import type { Prisma } from "@/generated/prisma/client";

/**
 * Filtro testo per liste contratti: cliente, CF/P.IVA, POD, n. contratto.
 * Usato da Dashboard, Contratti, Archivio, Provvigioni, Lavorazione.
 */
export function contractTextSearchWhere(
  q: string | null | undefined,
): Prisma.ContractWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { contractNumber: { contains: term, mode: "insensitive" } },
      { podPdr: { contains: term, mode: "insensitive" } },
      { pod: { contains: term, mode: "insensitive" } },
      { pdr: { contains: term, mode: "insensitive" } },
      { client: { firstName: { contains: term, mode: "insensitive" } } },
      { client: { lastName: { contains: term, mode: "insensitive" } } },
      { client: { companyName: { contains: term, mode: "insensitive" } } },
      { client: { fiscalCode: { contains: term, mode: "insensitive" } } },
      { client: { vatNumber: { contains: term, mode: "insensitive" } } },
      { client: { email: { contains: term, mode: "insensitive" } } },
      { client: { phone: { contains: term, mode: "insensitive" } } },
    ],
  };
}

/** Filtro testo per lista anagrafiche clienti. */
export function clientTextSearchWhere(
  q: string | null | undefined,
): Prisma.ClientWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  return {
    OR: [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { companyName: { contains: term, mode: "insensitive" } },
      { fiscalCode: { contains: term, mode: "insensitive" } },
      { vatNumber: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term, mode: "insensitive" } },
    ],
  };
}
