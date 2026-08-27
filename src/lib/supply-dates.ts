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
  // SWITCH, CESSAZIONE e CAMBIO (legacy) → allineamento mensile
  if (
    v === "SWITCH" ||
    v === "CAMBIO" ||
    v === "CAMBIO_FORNITORE" ||
    v === "CESSAZIONE" ||
    v === "CESSATO" ||
    v === "DISDETTA"
  ) {
    return "CAMBIO";
  }
  // Default: Switch (mai etichettare come "Cambio" in UI)
  return "CAMBIO";
}

/** Switch: entro il 9 del mese → 1° del mese successivo, altrimenti +2 mesi. */
export const SWITCH_CUTOFF_DAY = 9;
/** Attivazione / Voltura: circa 10 giorni dall'inserimento. */
export const ACTIVATION_LEAD_DAYS = 10;

/**
 * Data inizio fornitura:
 * - Switch / Cessazione: se inserito entro il giorno 9 → 1° del mese successivo;
 *   dal 10 in poi → 1° di due mesi dopo.
 * - Voltura / Attivazione: circa 10 giorni dall'inserimento.
 *
 * Regola CRM: per Switch, data inserimento e data fornitura NON possono
 * essere lo stesso giorno (sì invece per Voltura/Attivazione).
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
    d.setDate(d.getDate() + ACTIVATION_LEAD_DAYS);
    return d;
  }

  const day = insertion.getDate();
  const year = insertion.getFullYear();
  const month = insertion.getMonth();
  if (day <= SWITCH_CUTOFF_DAY) {
    return new Date(year, month + 1, 1);
  }
  return new Date(year, month + 2, 1);
}

export function describeSupplyStartRule(operationType?: string | null): string {
  const type = normalizeOperationType(operationType);
  if (type === "VOLTURA" || type === "ATTIVAZIONE") {
    return `Ingresso calcolato: +${ACTIVATION_LEAD_DAYS} giorni dalla data di inserimento.`;
  }
  return `Ingresso calcolato: entro il ${SWITCH_CUTOFF_DAY} → 1° del mese successivo, altrimenti 1° di due mesi dopo.`;
}

function ymdLocal(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Se è uno Switch e inserimento = fornitura (errore tipico), sposta
 * l’inserimento al 1° del mese precedente, lasciando invariata la fornitura.
 * Voltura/Attivazione: nessuna modifica.
 */
export function fixSwitchEqualInsertionSupply(
  insertionDate: Date,
  supplyStartDate: Date | null | undefined,
  operationType?: string | null,
): { insertionDate: Date; supplyStartDate: Date } {
  const type = normalizeOperationType(operationType);
  const supply =
    supplyStartDate ?? computeSupplyStartDate(insertionDate, type);

  if (type === "VOLTURA" || type === "ATTIVAZIONE") {
    return { insertionDate, supplyStartDate: supply };
  }

  if (ymdLocal(insertionDate) !== ymdLocal(supply)) {
    return { insertionDate, supplyStartDate: supply };
  }

  // Stesso giorno su Switch: inserimento = 1° del mese prima della fornitura
  const fixedIns = new Date(
    supply.getFullYear(),
    supply.getMonth() - 1,
    1,
  );
  return { insertionDate: fixedIns, supplyStartDate: supply };
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

/** Sposta una data di N mesi (stesso giorno, clamp fine mese). */
export function addMonthsLocal(date: Date, months: number): Date {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  target.setHours(0, 0, 0, 0);
  return target;
}

/**
 * Se le date sono ancora future (inserimento errato), anticipa l’inserimento
 * di 1 mese e ricalcola/sposta la fornitura, così Incassato/Pagato resta salvato.
 */
export function fixFutureDatesForPayment(opts: {
  insertionDate: Date;
  supplyStartDate?: Date | null;
  operationType?: string | null;
  now?: Date;
}): { insertionDate: Date; supplyStartDate: Date; adjusted: boolean } {
  const now = opts.now ?? new Date();
  const op = normalizeOperationType(opts.operationType);
  let insertion = new Date(opts.insertionDate);
  insertion.setHours(0, 0, 0, 0);
  let supply =
    opts.supplyStartDate != null
      ? new Date(opts.supplyStartDate)
      : computeSupplyStartDate(insertion, op);
  supply.setHours(0, 0, 0, 0);

  if (isInFornitura(supply, now)) {
    return { insertionDate: insertion, supplyStartDate: supply, adjusted: false };
  }

  // Regola CRM: data pagamento → anticipa inserimento di 1 mese
  insertion = addMonthsLocal(insertion, -1);
  if (opts.supplyStartDate != null) {
    supply = addMonthsLocal(new Date(opts.supplyStartDate), -1);
  } else {
    supply = computeSupplyStartDate(insertion, op);
  }

  // Se ancora futura (es. errore di più mesi), allinea fornitura a oggi
  // e tiene l’inserimento almeno 1 mese prima per Switch.
  if (!isInFornitura(supply, now)) {
    supply = startOfDayLocal(now);
    const fixed = fixSwitchEqualInsertionSupply(insertion, supply, op);
    insertion = fixed.insertionDate;
    supply = fixed.supplyStartDate;
    if (!isInFornitura(supply, now)) {
      supply = startOfDayLocal(now);
    }
  }

  return { insertionDate: insertion, supplyStartDate: supply, adjusted: true };
}
