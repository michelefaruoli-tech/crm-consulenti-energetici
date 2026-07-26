/** Utility condivise (client + server) per import Excel Helios. */

export type HeliosImportRowStatus =
  | "will_pay"
  | "already_paid"
  | "not_found"
  | "ambiguous";

export type HeliosImportPreviewRow = {
  excelRow: number;
  pod: string;
  intestatario: string;
  baseAmount: number;
  status: HeliosImportRowStatus;
  contractId?: string;
  clientName?: string;
};

export type HeliosImportPreviewResult = {
  ok: true;
  competencePeriod: string;
  settledPeriod: string;
  fileName: string;
  rows: HeliosImportPreviewRow[];
  summary: {
    total: number;
    willPay: number;
    alreadyPaid: number;
    notFound: number;
    ambiguous: number;
  };
};

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

/** Da nome file tipo Provvigioni_Aprile_2026_… → 2026-04 */
export function guessCompetenceFromFilename(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  for (const [name, mm] of Object.entries(IT_MONTHS)) {
    const re = new RegExp(`${name}[_\\s-]*(\\d{4})`, "i");
    const m = lower.match(re);
    if (m) return `${m[1]}-${mm}`;
  }
  const yyyyMm = lower.match(/(\d{4})[_-](\d{2})/);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}`;
  return null;
}

export function isYearMonthPeriod(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}
