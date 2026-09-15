/**
 * Normalizzazione dei valori letti dai rendiconti provvigioni.
 *
 * Ogni funzione qui risponde a un'insidia osservata nei file reali delle fonti
 * (vedi `docs/provvigioni-formati-e-import.md`, §1.8): formati di data diversi,
 * PDR numerici con zeri iniziali persi, POD mascherati, refusi con cifre al
 * posto di lettere, importi come formule senza risultato memorizzato.
 */

import { normalizePodKey } from "@/lib/storno-status";
import { normalizePersonKey } from "@/lib/helios-provvigioni-shared";

export type PayoutDateFormat =
  | "it"
  | "it_dash"
  | "us"
  | "excel"
  | "month_abbr"
  | "yyyymm"
  | "auto";

/** Valore grezzo di una cella Excel dopo la lettura di exceljs. */
export type RawCell = unknown;

const MONTHS_IT: Record<string, string> = {
  gennaio: "01",
  febbraio: "02",
  marzo: "03",
  aprile: "04",
  maggio: "05",
  giugno: "06",
  luglio: "07",
  agosto: "08",
  settembre: "09",
  ottobre: "10",
  novembre: "11",
  dicembre: "12",
};

const MONTHS_ABBR: Record<string, string> = {
  gen: "01",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  mag: "05",
  jun: "06",
  giu: "06",
  jul: "07",
  lug: "07",
  aug: "08",
  ago: "08",
  sep: "09",
  set: "09",
  oct: "10",
  ott: "10",
  nov: "11",
  dec: "12",
  dic: "12",
};

/**
 * Testo di una cella. Gestisce rich text, hyperlink e formule: per queste
 * ultime restituisce il risultato memorizzato, che in alcuni file manca.
 */
export function cellText(value: RawCell): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const o = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: unknown;
    };
    if (Array.isArray(o.richText)) {
      return o.richText
        .map((t) => t.text ?? "")
        .join("")
        .trim();
    }
    if (o.result != null) return cellText(o.result);
    if (o.text != null) return cellText(o.text);
  }
  return "";
}

/** True se la cella è una formula priva di risultato memorizzato. */
export function isFormulaWithoutResult(value: RawCell): boolean {
  if (value == null || typeof value !== "object") return false;
  const o = value as { formula?: unknown; result?: unknown };
  return o.formula != null && (o.result == null || o.result === undefined);
}

/**
 * Importo con convenzione italiana (virgola decimale, punto migliaia) o inglese.
 * Restituisce null quando la cella contiene testo esplicativo invece di un
 * numero: la riga resterà senza importo e visibile in revisione.
 */
export function parseAmount(value: RawCell): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value != null && typeof value === "object") {
    const o = value as { result?: unknown };
    if (o.result != null) return parseAmount(o.result);
  }

  const raw = cellText(value);
  if (!raw) return null;

  // Parentesi contabili: (100,00) = -100
  const negativeByParens = /^\(.*\)$/.test(raw.trim());
  let s = raw.replace(/[()]/g, "").replace(/[\s\u00a0]/g, "").replace(/€|EUR/gi, "");
  if (!s) return null;

  // Nessuna cifra: è testo (es. «riscedulazione», «PAG. APRILE»)
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Il separatore più a destra è quello decimale
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Virgola sola: decimale se segue 1-2 cifre finali, altrimenti migliaia
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  s = s.replace(/[^\d.\-+]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativeByParens ? -Math.abs(n) : n;
}

/** Vero se il testo del POD è mascherato (es. `**********1098`). */
export function isMaskedPod(raw: string): boolean {
  return /[*x]{3,}/i.test(raw);
}

/** Ultime cifre di un POD mascherato, usate come match debole. */
export function maskedPodSuffix(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? digits.slice(-6) : "";
}

/** Lunghezza canonica di un PDR italiano. */
const PDR_LENGTH = 14;

/**
 * Chiavi candidate per POD/PDR.
 *
 * Le fonti che salvano il PDR come numero perdono gli zeri iniziali: un PDR di
 * 12-13 cifre va riprovato con gli zeri ripristinati a 14, altrimenti nessuna
 * fornitura gas trova corrispondenza.
 */
export function podCandidateKeys(raw: string): string[] {
  const base = normalizePodKey(raw);
  if (!base) return [];
  const out = [base];
  if (/^\d{11,13}$/.test(base)) {
    out.push(base.padStart(PDR_LENGTH, "0"));
  }
  if (/^0+\d+$/.test(base)) {
    out.push(base.replace(/^0+/, ""));
  }
  return [...new Set(out)];
}

/**
 * Chiave nome persona tollerante ai refusi da sostituzione di cifra osservati
 * nei fogli compilati a mano (`5MONA` → SIMONA, `CO5MO` → COSIMO).
 */
export function fuzzyPersonKey(name: string): string {
  const deTyped = name
    .replace(/5/g, "S")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/4/g, "A");
  return normalizePersonKey(deTyped);
}

/** Unisce nome e cognome provando l'ordine dichiarato e quello inverso. */
export function personKeyVariants(parts: {
  full?: string;
  first?: string;
  last?: string;
}): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const k = fuzzyPersonKey(v);
    if (k) out.push(k);
  };
  if (parts.full) push(parts.full);
  if (parts.first && parts.last) {
    push(`${parts.first} ${parts.last}`);
    push(`${parts.last} ${parts.first}`);
  } else if (parts.last) {
    push(parts.last);
  } else if (parts.first) {
    push(parts.first);
  }
  return [...new Set(out)];
}

/** Codice fiscale / P.IVA normalizzato, vuoto se non plausibile. */
export function normalizeFiscalKey(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (s.length === 16 || s.length === 11) return s;
  return "";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function periodFromParts(year: number, month: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  const y = year < 100 ? 2000 + year : year;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad2(month)}`;
}

/** Data seriale Excel (giorni dal 1899-12-30) → periodo YYYY-MM. */
function periodFromExcelSerial(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return periodFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/**
 * Mese di competenza YYYY-MM da una cella, secondo la convenzione dichiarata
 * nella mappatura. Con `auto` prova tutte le convenzioni viste nei file reali:
 * quattro formati di data più `Feb-26` e `202608`.
 */
export function parsePeriodCell(
  value: RawCell,
  format: PayoutDateFormat = "auto",
): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return periodFromParts(value.getFullYear(), value.getMonth() + 1);
  }
  if (typeof value === "number") {
    // 202608 = anno+mese compatto, altrimenti seriale Excel
    if (value >= 190001 && value <= 210012) {
      return periodFromParts(Math.floor(value / 100), value % 100);
    }
    if (format === "yyyymm") return null;
    return periodFromExcelSerial(value);
  }
  if (value != null && typeof value === "object") {
    const o = value as { result?: unknown; text?: unknown };
    if (o.result != null) return parsePeriodCell(o.result, format);
    if (o.text != null) return parsePeriodCell(o.text, format);
  }

  const s = cellText(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;

  // 202608
  const compact = s.match(/^(\d{4})(\d{2})$/);
  if (compact) return periodFromParts(Number(compact[1]), Number(compact[2]));

  // 2026-08 / 2026-08-15
  const iso = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (iso) return periodFromParts(Number(iso[1]), Number(iso[2]));

  // gg/mm/aaaa, gg-mm-aaaa, mm/gg/aa (statunitense)
  const triple = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (triple) {
    const a = Number(triple[1]);
    const b = Number(triple[2]);
    const y = Number(triple[3]);
    if (format === "us") return periodFromParts(y, a);
    if (format === "it" || format === "it_dash") return periodFromParts(y, b);
    // auto: se il primo campo non può essere un mese è giorno/mese
    if (a > 12) return periodFromParts(y, b);
    if (b > 12) return periodFromParts(y, a);
    return periodFromParts(y, b);
  }

  // mm/aaaa
  const pair = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (pair) return periodFromParts(Number(pair[2]), Number(pair[1]));

  // «agosto 2026»
  for (const [name, mm] of Object.entries(MONTHS_IT)) {
    if (new RegExp(`\\b${name}\\b`).test(s)) {
      const y = s.match(/(\d{4})/);
      if (y) return `${y[1]}-${mm}`;
    }
  }

  // «Feb-26», «feb 2026»
  const abbr = s.match(/^([a-z]{3})[-\s/]?(\d{2,4})$/);
  if (abbr) {
    const mm = MONTHS_ABBR[abbr[1]!];
    if (mm) {
      const y = Number(abbr[2]);
      return periodFromParts(y < 100 ? 2000 + y : y, Number(mm));
    }
  }

  return null;
}

/** Riconosce le righe di totale, che chiudono il blocco dati. */
const TOTAL_PATTERNS = [
  /^totale\b/i,
  /^subtotale\b/i,
  /^tot\.?\s/i,
  /totale\s+(fattura|rendiconto|invito)/i,
  /^somma\b/i,
];

export function looksLikeTotalRow(texts: string[]): boolean {
  const nonEmpty = texts.map((t) => t.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  if (nonEmpty.some((t) => TOTAL_PATTERNS.some((re) => re.test(t)))) return true;
  // Celle unite di totale: lo stesso testo ripetuto su molte colonne
  if (nonEmpty.length >= 4) {
    const first = nonEmpty[0]!.toLowerCase();
    if (
      first.includes("totale") &&
      nonEmpty.every((t) => t.toLowerCase() === first)
    ) {
      return true;
    }
  }
  return false;
}
