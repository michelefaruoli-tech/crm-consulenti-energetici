import type { Prisma } from "@/generated/prisma/client";

/** Apostrofi tipografici / varianti → trattati come lo stesso segno. */
const APOSTROPHE_RE = /[''\u2019\u2018\u02BC\u0060\u00B4]/g;

/** Spezza la query in pezzi (es. «Mario Rossi» → Mario, Rossi). L'apostrofo non spezza. */
function searchTokens(q: string): string[] {
  return q
    .trim()
    .split(/[\s,;|/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

/**
 * Varianti per cognomi italiani con apostrofo (D'Angelo, Dell'Acqua, …).
 * Così «dangelo», «D angelo» e «D'angelo» trovano lo stesso record.
 */
export function searchTermVariants(term: string): string[] {
  const raw = term.trim();
  if (!raw) return [];

  const normalized = raw.replace(APOSTROPHE_RE, "'");
  const stripped = normalized.replace(/'/g, "");
  const spaced = normalized.replace(/'/g, " ").replace(/\s+/g, " ").trim();

  const variants = new Set<string>();
  for (const v of [raw, normalized, stripped, spaced]) {
    if (v) variants.add(v);
  }

  // Utente scrive senza apostrofo → prova inserimenti tipici (D'|L'|De'|Del'|Dell')
  if (!APOSTROPHE_RE.test(raw) && !normalized.includes("'") && stripped.length >= 3) {
    const s = stripped;
    variants.add(`${s[0]}'${s.slice(1)}`);
    if (s.length >= 4) variants.add(`${s.slice(0, 2)}'${s.slice(2)}`);
    if (s.length >= 5) variants.add(`${s.slice(0, 3)}'${s.slice(3)}`);
    if (s.length >= 6) variants.add(`${s.slice(0, 4)}'${s.slice(4)}`);
  }

  return [...variants];
}

/**
 * Condizioni OR su un singolo pezzo di testo (cliente + contratto).
 * Include note, POD, telefono, CF, indirizzo, fornitore, collaboratore, …
 */
function contractFieldsOr(term: string): Prisma.ContractWhereInput[] {
  const terms = searchTermVariants(term);
  return terms.flatMap((t) => [
    { contractNumber: { contains: t, mode: "insensitive" as const } },
    { podPdr: { contains: t, mode: "insensitive" as const } },
    { pod: { contains: t, mode: "insensitive" as const } },
    { pdr: { contains: t, mode: "insensitive" as const } },
    { notes: { contains: t, mode: "insensitive" as const } },
    { masterNotes: { contains: t, mode: "insensitive" as const } },
    { internalNotes: { contains: t, mode: "insensitive" as const } },
    { workNotes: { contains: t, mode: "insensitive" as const } },
    { koNotes: { contains: t, mode: "insensitive" as const } },
    { koReason: { contains: t, mode: "insensitive" as const } },
    { archiveLabel: { contains: t, mode: "insensitive" as const } },
    { paymentStatus: { contains: t, mode: "insensitive" as const } },
    { recurrence: { contains: t, mode: "insensitive" as const } },
    { operationType: { contains: t, mode: "insensitive" as const } },
    { client: { firstName: { contains: t, mode: "insensitive" as const } } },
    { client: { lastName: { contains: t, mode: "insensitive" as const } } },
    { client: { companyName: { contains: t, mode: "insensitive" as const } } },
    { client: { fiscalCode: { contains: t, mode: "insensitive" as const } } },
    { client: { vatNumber: { contains: t, mode: "insensitive" as const } } },
    { client: { email: { contains: t, mode: "insensitive" as const } } },
    { client: { phone: { contains: t, mode: "insensitive" as const } } },
    { client: { address: { contains: t, mode: "insensitive" as const } } },
    { client: { notes: { contains: t, mode: "insensitive" as const } } },
    { supplier: { name: { contains: t, mode: "insensitive" as const } } },
    { collaborator: { name: { contains: t, mode: "insensitive" as const } } },
  ]);
}

function clientFieldsOr(term: string): Prisma.ClientWhereInput[] {
  const terms = searchTermVariants(term);
  return terms.flatMap((t) => [
    { firstName: { contains: t, mode: "insensitive" as const } },
    { lastName: { contains: t, mode: "insensitive" as const } },
    { companyName: { contains: t, mode: "insensitive" as const } },
    { fiscalCode: { contains: t, mode: "insensitive" as const } },
    { vatNumber: { contains: t, mode: "insensitive" as const } },
    { email: { contains: t, mode: "insensitive" as const } },
    { phone: { contains: t, mode: "insensitive" as const } },
    { address: { contains: t, mode: "insensitive" as const } },
    { notes: { contains: t, mode: "insensitive" as const } },
    {
      contracts: {
        some: {
          deletedAt: null,
          OR: [
            { notes: { contains: t, mode: "insensitive" as const } },
            { podPdr: { contains: t, mode: "insensitive" as const } },
            { pod: { contains: t, mode: "insensitive" as const } },
            { pdr: { contains: t, mode: "insensitive" as const } },
            { contractNumber: { contains: t, mode: "insensitive" as const } },
            { masterNotes: { contains: t, mode: "insensitive" as const } },
            { internalNotes: { contains: t, mode: "insensitive" as const } },
          ],
        },
      },
    },
  ]);
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
