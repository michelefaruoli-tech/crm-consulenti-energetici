/**
 * Colore stabile di ogni fornitore nel rendiconto (anteprima, PDF, Excel).
 * Lo stesso nome — anche «Eni» / «Plenitude» o «Enel Energia» — tiene sempre
 * la stessa barra. I fornitori non in elenco ricevono un colore dalla
 * tavolozza di riserva, scelto con un hash del nome normalizzato.
 */
import { canonicalSupplierName, stripMergedSupplierLabel } from "@/lib/supplier-names";

export type RendicontoSwatch = {
  id: string;
  /** Nome leggibile, per la legenda. */
  label: string;
  /** Barra piena #RRGGBB. */
  bar: string;
  /** Testo sulla barra: scuro se la barra è chiara, bianco se è piena e scura. */
  text: string;
  /** Cornice della scheda #RRGGBB. */
  frame: string;
  /** Sfondo chiaro sotto l’intestazione colonne. */
  wash: string;
  /** Testo scuro sul wash. */
  washText: string;
};

function swatch(
  id: string,
  label: string,
  bar: string,
  text: string,
  frame: string,
  wash: string,
  washText: string,
): RendicontoSwatch {
  return { id, label, bar, text, frame, wash, washText };
}

const NAMED: Record<string, RendicontoSwatch> = {
  plenitude: swatch(
    "plenitude",
    "Eni / Plenitude",
    "#F5C518",
    "#1C1917",
    "#A16207",
    "#FEF9C3",
    "#422006",
  ),
  iren: swatch(
    "iren",
    "Iren",
    "#C2410C",
    "#FFFFFF",
    "#9A3412",
    "#FFEDD5",
    "#7C2D12",
  ),
  enel: swatch(
    "enel",
    "Enel",
    "#166534",
    "#FFFFFF",
    "#14532D",
    "#DCFCE7",
    "#14532D",
  ),
  helios: swatch(
    "helios",
    "Helios",
    "#1D4ED8",
    "#FFFFFF",
    "#1E3A8A",
    "#DBEAFE",
    "#1E3A8A",
  ),
  edison: swatch(
    "edison",
    "Edison",
    "#BE123C",
    "#FFFFFF",
    "#9F1239",
    "#FFE4E6",
    "#881337",
  ),
  dolomiti: swatch(
    "dolomiti",
    "Dolomiti",
    "#0369A1",
    "#FFFFFF",
    "#075985",
    "#E0F2FE",
    "#0C4A6E",
  ),
  duferco: swatch(
    "duferco",
    "Duferco",
    "#6D28D9",
    "#FFFFFF",
    "#5B21B6",
    "#EDE9FE",
    "#4C1D95",
  ),
  acea: swatch(
    "acea",
    "Acea",
    "#0F766E",
    "#FFFFFF",
    "#115E59",
    "#CCFBF1",
    "#134E4A",
  ),
  engie: swatch(
    "engie",
    "Engie",
    "#A5F3FC",
    "#164E63",
    "#0E7490",
    "#ECFEFF",
    "#155E75",
  ),
  sorgenia: swatch(
    "sorgenia",
    "Sorgenia",
    "#312E81",
    "#FFFFFF",
    "#1E1B4B",
    "#E0E7FF",
    "#312E81",
  ),
  etruria: swatch(
    "etruria",
    "Etruria",
    "#78350F",
    "#FFFFFF",
    "#451A03",
    "#FEF3C7",
    "#78350F",
  ),
  sinergy: swatch(
    "sinergy",
    "Sinergy",
    "#A21CAF",
    "#FFFFFF",
    "#86198F",
    "#FAE8FF",
    "#701A75",
  ),
};

/** Ordine di riconoscimento. Enel prima di Eni, così «Enel Energia» non diventa Plenitude. */
const MATCH_ORDER = [
  "enel",
  "plenitude",
  "iren",
  "helios",
  "edison",
  "dolomiti",
  "duferco",
  "acea",
  "engie",
  "sorgenia",
  "etruria",
  "sinergy",
] as const;

const SENZA: RendicontoSwatch = swatch(
  "senza",
  "Senza fornitore",
  "#E2E8F0",
  "#0F172A",
  "#64748B",
  "#F8FAFC",
  "#0F172A",
);

/** Tavolozza di riserva: stessa per lo stesso nome, distinta dai fornitori noti. */
export const RENDICONTO_FALLBACK_THEMES: RendicontoSwatch[] = [
  swatch("altro-1", "Altro fornitore", "#334155", "#FFFFFF", "#1E293B", "#F8FAFC", "#0F172A"),
  swatch("altro-2", "Altro fornitore", "#7F1D1D", "#FFFFFF", "#450A0A", "#FEF2F2", "#450A0A"),
  swatch("altro-3", "Altro fornitore", "#134E4A", "#FFFFFF", "#042F2E", "#F0FDFA", "#134E4A"),
  swatch("altro-4", "Altro fornitore", "#4A044E", "#FFFFFF", "#3B0764", "#FDF4FF", "#4A044E"),
  swatch("altro-5", "Altro fornitore", "#3F3F46", "#FFFFFF", "#27272A", "#F4F4F5", "#18181B"),
  swatch("altro-6", "Altro fornitore", "#713F12", "#FFFFFF", "#451A03", "#FFFBEB", "#451A03"),
  swatch("altro-7", "Altro fornitore", "#1E1B4B", "#FFFFFF", "#1E1B4B", "#EEF2FF", "#1E1B4B"),
  swatch("altro-8", "Altro fornitore", "#3B0764", "#FFFFFF", "#2E1065", "#FAF5FF", "#3B0764"),
];

/** Bande che non sono un fornitore (periodo, storni, totale). */
export const RENDICONTO_SECTION_THEME = {
  periodo: swatch("periodo", "Periodo", "#0F172A", "#FFFFFF", "#0F172A", "#F1F5F9", "#0F172A"),
  dettaglio: swatch("dettaglio", "Dettaglio", "#334155", "#FFFFFF", "#1E293B", "#F8FAFC", "#0F172A"),
  storni: swatch("storni", "Storni", "#9F1239", "#FFFFFF", "#881337", "#FFF1F2", "#881337"),
  ricorrenti: swatch("ricorrenti", "Rate ricorrenti", "#6B21A8", "#FFFFFF", "#581C87", "#F3E8FF", "#581C87"),
  netto: swatch("netto", "Totale netto", "#065F46", "#FFFFFF", "#064E3B", "#D1FAE5", "#064E3B"),
  extra: swatch("extra", "Voce aggiuntiva", "#E2E8F0", "#0F172A", "#64748B", "#F8FAFC", "#0F172A"),
} as const;

export function namedRendicontoThemes(): RendicontoSwatch[] {
  return MATCH_ORDER.map((id) => NAMED[id]);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Colore non valido: ${hex}`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** ARGB per ExcelJS (`FF` + esadecimale). */
export function hexToArgb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function normalizeSupplierKey(name: string): string {
  const canon = canonicalSupplierName(name);
  return `${canon} ${stripMergedSupplierLabel(name)}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isPlenitudeToken(token: string): boolean {
  if (token === "eni") return true;
  if (token.includes("plenitude")) return true;
  if (token.startsWith("pleni")) return true;
  return false;
}

function matches(id: string, tokens: string[], key: string): boolean {
  const has = (pred: (token: string) => boolean) => tokens.some(pred);
  switch (id) {
    case "enel":
      return has((token) => token === "enel" || token.startsWith("enel"));
    case "plenitude":
      return has(isPlenitudeToken);
    case "iren":
      return has((token) => token === "iren" || token.startsWith("iren"));
    case "helios":
      return has((token) => token === "helios" || token.startsWith("helios"));
    case "edison":
      return has((token) => token === "edison" || token.startsWith("edison"));
    case "dolomiti":
      return key.includes("dolomiti");
    case "duferco":
      return key.includes("duferco");
    case "acea":
      return has((token) => token === "acea" || token.startsWith("acea"));
    case "engie":
      return has((token) => token === "engie" || token.startsWith("engie"));
    case "sorgenia":
      return has((token) => token.startsWith("sorgenia"));
    case "etruria":
      return has((token) => token.startsWith("etruria"));
    case "sinergy":
      return has(
        (token) =>
          token.startsWith("sinergy") || token.startsWith("synergy"),
      );
    default:
      return false;
  }
}

export function rendicontoSupplierTheme(
  name: string | null | undefined,
): RendicontoSwatch {
  const raw = String(name ?? "").trim();
  const key = normalizeSupplierKey(raw);
  if (!key || key.includes("senza fornitore")) return SENZA;
  const tokens = key.split(" ").filter(Boolean);
  for (const id of MATCH_ORDER) {
    if (matches(id, tokens, key)) return NAMED[id];
  }
  const index = hashKey(key) % RENDICONTO_FALLBACK_THEMES.length;
  return RENDICONTO_FALLBACK_THEMES[index] ?? RENDICONTO_FALLBACK_THEMES[0];
}

export function rendicontoSummarySwatch(row: {
  kind: "supplier" | "storni" | "ricorrenti" | "extra" | "netto";
  label: string;
  amount: number;
}): RendicontoSwatch {
  if (row.kind === "supplier") return rendicontoSupplierTheme(row.label);
  if (row.kind === "storni") return RENDICONTO_SECTION_THEME.storni;
  if (row.kind === "ricorrenti") return RENDICONTO_SECTION_THEME.ricorrenti;
  if (row.kind === "extra") return RENDICONTO_SECTION_THEME.extra;
  return row.amount < 0
    ? RENDICONTO_SECTION_THEME.storni
    : RENDICONTO_SECTION_THEME.netto;
}

export function rendicontoNettoSwatch(amount: number): RendicontoSwatch {
  return amount < 0
    ? RENDICONTO_SECTION_THEME.storni
    : RENDICONTO_SECTION_THEME.netto;
}
