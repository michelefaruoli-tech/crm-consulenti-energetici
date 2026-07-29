/** Tipi operazione pratica energetica (valore interno legacy CAMBIO = Switch in UI) */
export type OperationType = "CAMBIO" | "VOLTURA" | "ATTIVAZIONE";

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  CAMBIO: "Switch",
  VOLTURA: "Voltura",
  ATTIVAZIONE: "Attivazione",
};

export function normalizeOperationType(
  value: string | null | undefined,
): OperationType {
  const v = (value ?? "").trim().toUpperCase();
  if (v === "VOLTURA") return "VOLTURA";
  if (
    v === "ATTIVAZIONE" ||
    v === "ATTIVAZIONI" ||
    v === "NUOVA_ATTIVAZIONE" ||
    v === "SUBENTRO"
  ) {
    return "ATTIVAZIONE";
  }
  // SWITCH e CAMBIO (legacy) → stesso comportamento "Switch"
  if (v === "SWITCH" || v === "CAMBIO" || v === "CAMBIO_FORNITORE") return "CAMBIO";
  // Default: Switch (mai etichettare come "Cambio" in UI)
  return "CAMBIO";
}

/**
 * Data inizio fornitura:
 * - Switch: se inserito prima del giorno 8 → 1° del mese successivo;
 *   dal 8 in poi → 1° di due mesi dopo.
 * - Voltura / Attivazione: circa 7 giorni dall'inserimento.
 */
export function computeSupplyStartDate(
  insertionDate: Date | string,
  operationType?: string | null,
): Date {
  const insertion =
    typeof insertionDate === "string" ? new Date(insertionDate) : new Date(insertionDate);
  const type = normalizeOperationType(operationType);

  if (type === "VOLTURA" || type === "ATTIVAZIONE") {
    const d = new Date(insertion);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 7);
    return d;
  }

  const day = insertion.getDate();
  const year = insertion.getFullYear();
  const month = insertion.getMonth();
  if (day < 8) {
    return new Date(year, month + 1, 1);
  }
  return new Date(year, month + 2, 1);
}

export function formatItDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Inizio giornata per confronti data fornitura. */
function startOfDayLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * True se l’utenza è già in fornitura (data ingresso ≤ oggi).
 * Senza data ingresso → non ancora in fornitura (non trattare come incassato).
 */
export function isInFornitura(
  supplyStartDate: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!supplyStartDate) return false;
  const s =
    typeof supplyStartDate === "string"
      ? new Date(supplyStartDate)
      : supplyStartDate;
  if (Number.isNaN(s.getTime())) return false;
  return startOfDayLocal(s).getTime() <= startOfDayLocal(now).getTime();
}
