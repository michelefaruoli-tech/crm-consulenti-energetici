import type { Prisma } from "@/generated/prisma/client";

/** Apostrofi tipografici / varianti → trattati come lo stesso segno. */
const APOSTROPHE_RE = /['\u2019\u2018\u02BC\u0060\u00B4]/g;

/**
 * Prefissi italiani con apostrofo, dal più lungo.
 * «dangelo» → D'Angelo; «dellacqua» → Dell'Acqua. Un solo tentativo.
 */
const IT_APOSTROPHE_PREFIXES = [
  "DALLA",
  "DELL",
  "DALL",
  "NELL",
  "SULL",
  "SANT",
  "DEL",
  "ALL",
  "DE",
  "D",
  "L",
] as const;

const ins = "insensitive" as const;

function contains(term: string) {
  return { contains: term, mode: ins };
}

/** Spezza la query in pezzi. L'apostrofo non spezza. */
/** «carlo di vizzino» non deve richiedere il token «di» su ogni campo. */
const SEARCH_STOPWORDS = new Set([
  "di",
  "del",
  "della",
  "dello",
  "dei",
  "degli",
  "delle",
  "e",
  "a",
  "da",
  "in",
  "su",
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "un",
  "uno",
  "una",
  "per",
  "con",
  "al",
  "dal",
]);

function searchTokens(q: string): string[] {
  const raw = q
    .trim()
    .split(/[\s,;|/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  const meaningful = raw.filter((t) => !SEARCH_STOPWORDS.has(t.toLowerCase()));
  return meaningful.length > 0 ? meaningful : raw;
}

/**
 * Varianti solo per nome/cognome/ragione sociale.
 * Massimo 3 stringhe: originale, senza apostrofo, eventuale prefisso italiano.
 */
export function searchTermVariants(term: string): string[] {
  const raw = term.trim();
  if (!raw) return [];

  const normalized = raw.replace(APOSTROPHE_RE, "'");
  const stripped = normalized.replace(/'/g, "");
  const variants = new Set<string>();
  variants.add(normalized);
  if (stripped && stripped !== normalized) variants.add(stripped);

  if (!normalized.includes("'") && stripped.length >= 4) {
    const upper = stripped.toUpperCase();
    const prefix = IT_APOSTROPHE_PREFIXES.find(
      (p) => upper.startsWith(p) && stripped.length - p.length >= 3,
    );
    if (prefix) {
      variants.add(`${stripped.slice(0, prefix.length)}'${stripped.slice(prefix.length)}`);
    }
  }

  return [...variants];
}

/** Codice/POD/telefono: niente varianti nome (evita esplosione OR). */
function looksLikeCode(term: string): boolean {
  const t = term.replace(/\s+/g, "");
  return t.length >= 6 && /^[A-Z0-9]+$/i.test(t) && /\d/.test(t);
}

function nameFieldVariants(term: string): string[] {
  if (looksLikeCode(term)) return [term.trim()];
  return searchTermVariants(term);
}

function contractNameOr(term: string): Prisma.ContractWhereInput[] {
  return nameFieldVariants(term).flatMap((t) => [
    { client: { firstName: contains(t) } },
    { client: { lastName: contains(t) } },
    { client: { companyName: contains(t) } },
    { collaborator: { name: contains(t) } },
  ]);
}

function clientNameOr(term: string): Prisma.ClientWhereInput[] {
  return nameFieldVariants(term).flatMap((t) => [
    { firstName: contains(t) },
    { lastName: contains(t) },
    { companyName: contains(t) },
  ]);
}

/**
 * Campi non-nome: una sola stringa (token originale).
 * Le varianti apostrofo restano sui soli campi anagrafica.
 */
function contractCodeFieldsOr(term: string): Prisma.ContractWhereInput[] {
  return [
    { contractNumber: contains(term) },
    { podPdr: contains(term) },
    { pod: contains(term) },
    { pdr: contains(term) },
    { notes: contains(term) },
    { masterNotes: contains(term) },
    { internalNotes: contains(term) },
    { workNotes: contains(term) },
    { koNotes: contains(term) },
    { koReason: contains(term) },
    { archiveLabel: contains(term) },
    { paymentStatus: contains(term) },
    { recurrence: contains(term) },
    { operationType: contains(term) },
    { client: { fiscalCode: contains(term) } },
    { client: { vatNumber: contains(term) } },
    { client: { email: contains(term) } },
    { client: { phone: contains(term) } },
    { client: { address: contains(term) } },
    { client: { notes: contains(term) } },
    { supplier: { name: contains(term) } },
  ];
}

function contractFieldsOr(term: string): Prisma.ContractWhereInput[] {
  return [...contractCodeFieldsOr(term), ...contractNameOr(term)];
}

function clientFieldsOr(term: string): Prisma.ClientWhereInput[] {
  return [
    ...clientNameOr(term),
    { fiscalCode: contains(term) },
    { vatNumber: contains(term) },
    { email: contains(term) },
    { phone: contains(term) },
    { address: contains(term) },
    { notes: contains(term) },
    {
      contracts: {
        some: {
          deletedAt: null,
          OR: [
            { notes: contains(term) },
            { podPdr: contains(term) },
            { pod: contains(term) },
            { pdr: contains(term) },
            { contractNumber: contains(term) },
          ],
        },
      },
    },
  ];
}

/**
 * Filtro testo per liste contratti: nome, cognome, CF/P.IVA, POD, telefono,
 * note, fornitore, collaboratore, n. contratto.
 */
export function contractTextSearchWhere(
  q: string | null | undefined,
): Prisma.ContractWhereInput | undefined {
  const term = q?.trim();
  if (!term) return undefined;

  const tokens = searchTokens(term);
  if (tokens.length === 0) return undefined;

  if (tokens.length === 1) {
    return { OR: contractFieldsOr(tokens[0]!) };
  }

  return {
    AND: tokens.map((t) => ({ OR: contractFieldsOr(t) })),
  };
}

/** Filtro testo per lista anagrafiche clienti. */
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
