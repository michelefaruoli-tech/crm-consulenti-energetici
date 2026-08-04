import type { Prisma } from "@/generated/prisma/client";

/** Spezza la query in pezzi (es. «Mario Rossi» → Mario, Rossi). */
function searchTokens(q: string): string[] {
  return q
    .trim()
    .split(/[\s,;|/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

/**
 * Condizioni OR su un singolo pezzo di testo (cliente + contratto).
 * Include note, POD, telefono, CF, indirizzo, fornitore, collaboratore, …
 */
function contractFieldsOr(term: string): Prisma.ContractWhereInput[] {
  return [
    { contractNumber: { contains: term, mode: "insensitive" } },
    { podPdr: { contains: term, mode: "insensitive" } },
    { pod: { contains: term, mode: "insensitive" } },
    { pdr: { contains: term, mode: "insensitive" } },
    { notes: { contains: term, mode: "insensitive" } },
    { masterNotes: { contains: term, mode: "insensitive" } },
    { internalNotes: { contains: term, mode: "insensitive" } },
    { workNotes: { contains: term, mode: "insensitive" } },
    { koNotes: { contains: term, mode: "insensitive" } },
    { koReason: { contains: term, mode: "insensitive" } },
    { archiveLabel: { contains: term, mode: "insensitive" } },
    { paymentStatus: { contains: term, mode: "insensitive" } },
    { recurrence: { contains: term, mode: "insensitive" } },
    { operationType: { contains: term, mode: "insensitive" } },
    { client: { firstName: { contains: term, mode: "insensitive" } } },
    { client: { lastName: { contains: term, mode: "insensitive" } } },
    { client: { companyName: { contains: term, mode: "insensitive" } } },
    { client: { fiscalCode: { contains: term, mode: "insensitive" } } },
    { client: { vatNumber: { contains: term, mode: "insensitive" } } },
    { client: { email: { contains: term, mode: "insensitive" } } },
    { client: { phone: { contains: term, mode: "insensitive" } } },
    { client: { address: { contains: term, mode: "insensitive" } } },
    { client: { notes: { contains: term, mode: "insensitive" } } },
    { supplier: { name: { contains: term, mode: "insensitive" } } },
    { collaborator: { name: { contains: term, mode: "insensitive" } } },
  ];
}

function clientFieldsOr(term: string): Prisma.ClientWhereInput[] {
  return [
    { firstName: { contains: term, mode: "insensitive" } },
    { lastName: { contains: term, mode: "insensitive" } },
    { companyName: { contains: term, mode: "insensitive" } },
    { fiscalCode: { contains: term, mode: "insensitive" } },
    { vatNumber: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
    { phone: { contains: term, mode: "insensitive" } },
    { address: { contains: term, mode: "insensitive" } },
    { notes: { contains: term, mode: "insensitive" } },
    {
      contracts: {
        some: {
          deletedAt: null,
          OR: [
            { notes: { contains: term, mode: "insensitive" } },
            { podPdr: { contains: term, mode: "insensitive" } },
            { pod: { contains: term, mode: "insensitive" } },
            { pdr: { contains: term, mode: "insensitive" } },
            { contractNumber: { contains: term, mode: "insensitive" } },
            { masterNotes: { contains: term, mode: "insensitive" } },
            { internalNotes: { contains: term, mode: "insensitive" } },
          ],
        },
      },
    },
  ];
}

/**
 * Filtro testo per liste contratti: nome, cognome, CF/P.IVA, POD, telefono,
 * note (contratto e cliente), fornitore, collaboratore, n. contratto, indirizzo.
 *
 * Con più parole (es. «Mario Rossi») ogni pezzo deve matchare almeno un campo
 * (AND tra pezzi, OR tra campi).
 */
export function contractTextSearchWhere(
  q: string | null | undefined,
): Prisma.ContractWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;

  const tokens = searchTokens(term);
  if (tokens.length === 0) return undefined;

  // Un solo pezzo: OR su tutti i campi (include codice nelle note)
  if (tokens.length === 1) {
    return { OR: contractFieldsOr(tokens[0]!) };
  }

  // Più pezzi: ciascuno deve trovare qualcosa (es. nome + cognome, o cognome + POD)
  return {
    AND: tokens.map((t) => ({ OR: contractFieldsOr(t) })),
  };
}

/** Filtro testo per lista anagrafiche clienti (+ note/POD dei contratti collegati). */
export function clientTextSearchWhere(
  q: string | null | undefined,
): Prisma.ClientWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;

  const tokens = searchTokens(term);
  if (tokens.length === 0) return undefined;

  if (tokens.length === 1) {
    return { OR: clientFieldsOr(tokens[0]!) };
  }

  return {
    AND: tokens.map((t) => ({ OR: clientFieldsOr(t) })),
  };
}
