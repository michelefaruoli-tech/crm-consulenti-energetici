/** Utility condivise (client + server) per import Excel Helios. */

import { computeSupplyStartDate } from "@/lib/supply-dates";
import { toPeriod } from "@/lib/recurring";

export type HeliosContractPeriodMatch = {
  id: string;
  supplyStartDate: Date | null;
  insertionDate: Date;
  operationType: string | null;
  expiryDate: Date | null;
};

function dayBefore(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - 1);
  return d;
}

/** Ultimo mese YYYY-MM fatturabile per un contratto (incluso). */
export function lastBillablePeriodForHeliosContract(
  c: HeliosContractPeriodMatch,
): string | null {
  if (!c.expiryDate) return null;
  return toPeriod(dayBefore(c.expiryDate));
}

/** Primo mese YYYY-MM fatturabile per un contratto (incluso). */
export function firstBillablePeriodForHeliosContract(
  c: HeliosContractPeriodMatch,
): string {
  const start =
    c.supplyStartDate ??
    computeSupplyStartDate(c.insertionDate, c.operationType);
  return toPeriod(start);
}

/** Il contratto copre la competenza mensile indicata? */
export function heliosContractCoversPeriod(
  c: HeliosContractPeriodMatch,
  period: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const start = firstBillablePeriodForHeliosContract(c);
  if (period < start) return false;
  const end = lastBillablePeriodForHeliosContract(c);
  if (end && period > end) return false;
  return true;
}

/** Fornitore ha pagato per questo mese solo se il contratto era già in fornitura. */
export function canMarkIncassatoForCompetencePeriod(
  supplyStart: Date,
  period: string,
): boolean {
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const [y, m] = period.split("-").map(Number);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
  const startDay = new Date(
    supplyStart.getFullYear(),
    supplyStart.getMonth(),
    supplyStart.getDate(),
  );
  return startDay <= monthEnd;
}

/**
 * Switch Helios: stesso POD può avere vecchio + nuovo contratto.
 * Sceglie quello la cui finestra [ingresso, chiusura] contiene il mese competenza.
 */
export function pickHeliosContractForPeriod<T extends HeliosContractPeriodMatch>(
  matches: T[],
  period: string,
): T | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  const covering = matches.filter((c) => heliosContractCoversPeriod(c, period));
  if (covering.length === 1) return covering[0]!;
  if (covering.length > 1) {
    return [...covering].sort(
      (a, b) =>
        firstBillablePeriodForHeliosContract(b).localeCompare(
          firstBillablePeriodForHeliosContract(a),
        ),
    )[0]!;
  }

  // Competenza prima dell’ingresso del nuovo: preferisci il contratto più vecchio
  const beforeStart = matches.filter(
    (c) => period < firstBillablePeriodForHeliosContract(c),
  );
  if (beforeStart.length > 0) {
    return [...beforeStart].sort((a, b) =>
      firstBillablePeriodForHeliosContract(a).localeCompare(
        firstBillablePeriodForHeliosContract(b),
      ),
    )[0]!;
  }

  // Nuovo non ancora in fornitura: preferisci quello con ingresso futuro più vicino
  return [...matches].sort((a, b) =>
    firstBillablePeriodForHeliosContract(a).localeCompare(
      firstBillablePeriodForHeliosContract(b),
    ),
  )[0]!;
}

export type HeliosImportRowStatus =
  | "will_pay" /** da segnare incassato (fornitore) */
  | "already_paid" /** già incassato */
  | "not_found"
  | "ambiguous";

/** Etichette UI: import rendiconto = Incassato, non Pagato collaboratore. */
export const HELIOS_IMPORT_STATUS_LABEL: Record<HeliosImportRowStatus, string> = {
  will_pay: "Da segnare incassato",
  already_paid: "Già incassato",
  not_found: "POD non in CRM",
  ambiguous: "Più contratti",
};

export type HeliosImportPreviewRow = {
  excelRow: number;
  pod: string;
  intestatario: string;
  baseAmount: number;
  /** Mese competenza YYYY-MM (può variare riga per riga nei file multi-mese) */
  competencePeriod: string;
  status: HeliosImportRowStatus;
  contractId?: string;
  clientName?: string;
  /** true se il POD verrà scritto sul contratto CRM (mancava) */
  willUpdatePod?: boolean;
};

export type HeliosImportPreviewResult = {
  ok: true;
  /** Fallback / primo mese (retrocompatibilità UI) */
  competencePeriod: string;
  settledPeriod: string;
  /** true se il file contiene più mesi di competenza */
  multiMonth: boolean;
  /** Elenco mesi trovati nel file, ordinati */
  competencePeriods: string[];
  fileName: string;
  rows: HeliosImportPreviewRow[];
  summary: {
    total: number;
    willPay: number;
    alreadyPaid: number;
    notFound: number;
    ambiguous: number;
    podsToUpdate: number;
  };
};

/** Chiave confronto nomi (Excel ↔ CRM) senza accenti/maiuscole. */
export function normalizePersonKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Da nome foglio tipo «Gennaio 2026» → 2026-01. */
export function periodFromSheetName(sheetName: string): string | null {
  const lower = sheetName.toLowerCase().trim();
  for (const [name, mm] of Object.entries(IT_MONTHS)) {
    const re = new RegExp(`${name}\\s*(\\d{4})`, "i");
    const m = lower.match(re);
    if (m) return `${m[1]}-${mm}`;
  }
  return null;
}

const IT_MONTHS: Record<string, string> = {
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

/** Da nome file tipo Provvigioni_Aprile_2026_… → 2026-04 (primo mese trovato). */
export function guessCompetenceFromFilename(fileName: string): string | null {
  const all = guessAllCompetencesFromFilename(fileName);
  return all[0] ?? null;
}

/**
 * File multi-mese tipo Provvigioni_Dicembre_2025_a_Febbraio_2026_…
 * → ["2025-12", "2026-02"] (mesi citati nel nome; la competenza reale resta sulla riga).
 */
export function guessAllCompetencesFromFilename(fileName: string): string[] {
  const lower = fileName.toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [name, mm] of Object.entries(IT_MONTHS)) {
    const re = new RegExp(`${name}[_\\s-]*(\\d{4})`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const period = `${m[1]}-${mm}`;
      if (!seen.has(period)) {
        seen.add(period);
        found.push(period);
      }
    }
  }
  if (found.length === 0) {
    const yyyyMm = lower.match(/(\d{4})[_-](\d{2})/);
    if (yyyyMm) found.push(`${yyyyMm[1]}-${yyyyMm[2]}`);
  }
  return found.sort();
}

export function isYearMonthPeriod(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}

/** Data Excel / testo → YYYY-MM (competenza). */
export function periodFromHeliosDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (giorni dal 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(value) * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
  }
  if (typeof value === "object" && value != null) {
    const o = value as { result?: unknown; text?: unknown };
    if (o.result != null) return periodFromHeliosDate(o.result);
    if (o.text != null) return periodFromHeliosDate(o.text);
  }
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!s) return null;

  // YYYY-MM
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // GG/MM/AAAA o MM/AAAA
  const dmY = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmY) {
    const mm = dmY[2]!.padStart(2, "0");
    return `${dmY[3]}-${mm}`;
  }
  const mY = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (mY) {
    return `${mY[2]}-${mY[1]!.padStart(2, "0")}`;
  }

  // «dicembre 2025» / «dic-2025»
  for (const [name, mm] of Object.entries(IT_MONTHS)) {
    const re = new RegExp(`${name}[^0-9]*(\\d{4})`, "i");
    const m = s.match(re);
    if (m) return `${m[1]}-${mm}`;
  }
  return null;
}
