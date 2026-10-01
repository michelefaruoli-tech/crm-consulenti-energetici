import { canonicalSupplierName } from "@/lib/supplier-names";
import { addMonths, monthsBetween, toPeriod } from "@/lib/recurring";
import type { RecurringWindow } from "@/lib/recurring-window";
import { isPeriodInRecurringWindow, lastGeneratedPeriod } from "@/lib/recurring-window";

export const HELIOS_MONTHLY_RESIDENTE = 4;
export const HELIOS_MONTHLY_ALTRO = 6;

/**
 * Helios: lag fisso M+2 (vincolante) — regola generale sulle ricorrenze mensili.
 * Genera la riga solo nel mese di pagamento/liquidazione, con mese rif. = competenza.
 *
 * Esempi (calendario → competenza creabile):
 * - settembre → solo fino a luglio (agosto NO: si crea a ottobre)
 * - ottobre → fino ad agosto (settembre NO: si crea a novembre)
 * - novembre → fino a settembre
 *
 * Eccezione (Michele 2026-10): per **nuova attivazione / voltura / switch**
 * la **prima** competenza (= mese ingresso fornitura) si crea e si mostra subito
 * con mese di riferimento, anche se oltre lastPayable. Le rate mensili successive
 * restano M+2. Vedi `isHeliosFirstMonthVisibleOperation`.
 */
export const HELIOS_RECURRING_GENERATION_LAG_MONTHS = 2;

/**
 * Valori `Contract.operationType` (già in schema/UI — non inventati) per cui
 * Helios espone subito la prima rata con mese riferimento.
 * Sottoinsieme di OPERATION_OPTIONS + alias legacy `CAMBIO` (= Switch).
 * Esclusi: CESSAZIONE, RINNOVO, ALTRO, ecc.
 */
export const HELIOS_FIRST_MONTH_VISIBLE_OPERATION_TYPES = [
  "SWITCH",
  "CAMBIO",
  "CAMBIO_FORNITORE",
  "VOLTURA",
  "ATTIVAZIONE",
  "NUOVA_ATTIVAZIONE",
  "SUBENTRO",
] as const;

/** True se il tipo operazione rientra nell’eccezione prima competenza Helios. */
export function isHeliosFirstMonthVisibleOperation(
  operationType: string | null | undefined,
): boolean {
  const v = String(operationType ?? "")
    .trim()
    .toUpperCase();
  if (!v) return false;
  return (HELIOS_FIRST_MONTH_VISIBLE_OPERATION_TYPES as readonly string[]).includes(
    v,
  );
}

/**
 * Prima competenza = mese di ingresso fornitura (`window.start`).
 * Solo per attivazione/voltura/switch: visibile/creabile anche se > lastPayable.
 */
export function isHeliosFirstCompetenceLagException(opts: {
  operationType: string | null | undefined;
  competencePeriod: string;
  supplyStartPeriod: string;
}): boolean {
  if (!isHeliosFirstMonthVisibleOperation(opts.operationType)) return false;
  const period = validYearMonth(opts.competencePeriod);
  const start = validYearMonth(opts.supplyStartPeriod);
  if (!period || !start) return false;
  return period === start;
}

/**
 * Periodi mensili da generare per un contratto.
 * Helios: fino a lastPayable (M+2), più eventuale prima competenza
 * (attivazione/voltura/switch) se ancora oltre il lag ma ≤ mese calendario.
 */
export function monthlyPeriodsDueForContract(opts: {
  supplierName: string | null | undefined;
  operationType: string | null | undefined;
  window: RecurringWindow;
  now: Date;
}): string[] {
  const lag = recurringGenerationLagMonths(opts.supplierName);
  const lastPeriod = lastGeneratedPeriod(opts.window, opts.now, lag);
  const base =
    opts.window.start <= lastPeriod
      ? monthsBetween(opts.window.start, lastPeriod)
      : [];

  if (lag <= 0) return base;
  if (!isHeliosFirstMonthVisibleOperation(opts.operationType)) return base;
  if (opts.window.start <= lastPeriod) return base;

  const nowPeriod = toPeriod(opts.now);
  if (opts.window.start > nowPeriod) return base;
  if (!isPeriodInRecurringWindow(opts.window, opts.window.start)) return base;

  return [opts.window.start];
}

/**
 * True se una competenza Helios oltre lastPayable va nascosta in lista.
 * False per la prima competenza di attivazione/voltura/switch (eccezione).
 */
export function isHeliosCompetenceHiddenByLag(opts: {
  period: string;
  operationType?: string | null;
  supplyStartPeriod?: string | null;
  now?: Date;
}): boolean {
  if (!isHeliosCompetenceNotYetPayable(opts.period, opts.now)) return false;
  if (
    opts.supplyStartPeriod &&
    isHeliosFirstCompetenceLagException({
      operationType: opts.operationType,
      competencePeriod: opts.period,
      supplyStartPeriod: opts.supplyStartPeriod,
    })
  ) {
    return false;
  }
  return true;
}

/** Ritardo generazione rate ricorrenti per fornitore (0 = mese calendario corrente). */
export function recurringGenerationLagMonths(
  supplierName: string | null | undefined,
): number {
  return isHeliosSupplier(supplierName) ? HELIOS_RECURRING_GENERATION_LAG_MONTHS : 0;
}

function validYearMonth(value: string | null | undefined): string | null {
  const period = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/** Competenza Helios dal mese di pagamento (settembre → luglio). */
export function heliosCompetenceFromPaymentMonth(paymentPeriod: string): string {
  return addMonths(paymentPeriod, -HELIOS_RECURRING_GENERATION_LAG_MONTHS);
}

function isLagAhead(later: string, earlier: string): boolean {
  return later === addMonths(earlier, HELIOS_RECURRING_GENERATION_LAG_MONTHS);
}

/**
 * Mese riferimento Helios = competenza, mai il mese di pagamento/incasso.
 * Se foglio o selezione coincidono con il pagamento, si applica il lag di 2 mesi.
 * Se i due campi sono invertiti (pagamento in competenza, competenza in incasso),
 * si usa il mese più vecchio come competenza.
 */
export function resolveHeliosCompetencePeriod(opts: {
  selectedCompetence?: string | null;
  settledPeriod?: string | null;
  inferredPeriod?: string | null;
}): string {
  const selected = validYearMonth(opts.selectedCompetence);
  const settled = validYearMonth(opts.settledPeriod);
  const inferred = validYearMonth(opts.inferredPeriod);

  if (selected && settled && isLagAhead(selected, settled)) {
    return settled;
  }
  if (inferred && settled && isLagAhead(inferred, settled)) {
    return settled;
  }

  const inferredIsPayment = Boolean(inferred && settled && inferred === settled);

  if (inferred && !inferredIsPayment) {
    return inferred;
  }
  if (selected && settled && selected === settled) {
    return heliosCompetenceFromPaymentMonth(settled);
  }
  if (selected) return selected;
  if (settled) return heliosCompetenceFromPaymentMonth(settled);
  return inferred ?? "";
}

/**
 * Mese in cui Helios versa (Data incasso), sempre competenza + 2 mesi
 * se i campi form/foglio sono allineati o invertiti.
 */
export function resolveHeliosPaymentPeriod(opts: {
  selectedCompetence?: string | null;
  settledPeriod?: string | null;
  inferredPeriod?: string | null;
}): string {
  const competence = resolveHeliosCompetencePeriod(opts);
  const selected = validYearMonth(opts.selectedCompetence);
  const settled = validYearMonth(opts.settledPeriod);
  const inferred = validYearMonth(opts.inferredPeriod);
  const later = [settled, inferred, selected]
    .filter((p): p is string => typeof p === "string" && competence !== "" && p > competence)
    .sort();
  if (later.length > 0) {
    const payment = later[later.length - 1];
    if (payment) return payment;
  }
  if (competence) return addMonths(competence, HELIOS_RECURRING_GENERATION_LAG_MONTHS);
  return settled ?? selected ?? inferred ?? "";
}

export type HeliosMeseRifShiftKind = "coincident" | "inverted";

export type HeliosMeseRifShiftPlan = {
  kind: HeliosMeseRifShiftKind;
  targetPeriod: string;
  targetSettled: string;
};

/**
 * Allineamento rate già importate.
 * - coincident: period = settled = pagamento → period diventa pagamento − 2
 * - inverted: period = pagamento e settled = competenza → si scambiano
 */
export function planHeliosMeseRifShift(
  period: string,
  settledPeriod: string,
): HeliosMeseRifShiftPlan | null {
  const current = validYearMonth(period);
  const settled = validYearMonth(settledPeriod);
  if (!current || !settled) return null;
  if (current === settled) {
    const targetPeriod = heliosCompetenceFromPaymentMonth(settled);
    if (targetPeriod === current) return null;
    return { kind: "coincident", targetPeriod, targetSettled: settled };
  }
  if (isLagAhead(current, settled)) {
    return { kind: "inverted", targetPeriod: settled, targetSettled: current };
  }
  return null;
}

/** Ultima competenza Helios visibile / generabile a una data. */
export function heliosLastPayableCompetence(now: Date = new Date()): string {
  return addMonths(toPeriod(now), -HELIOS_RECURRING_GENERATION_LAG_MONTHS);
}

/** Agosto/settembre in settembre 2026: competenza non ancora pagata da Helios. */
export function isHeliosCompetenceNotYetPayable(
  period: string,
  now: Date = new Date(),
): boolean {
  const p = validYearMonth(period);
  if (!p) return false;
  return p > heliosLastPayableCompetence(now);
}

/** Fornitore Helios (nome canonico o variante). */
export function isHeliosSupplier(name: string | null | undefined): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  const canon = canonicalSupplierName(raw);
  const key = (canon || raw).toLowerCase();
  return key === "helios" || key.startsWith("helios ");
}

/**
 * Gettone mensile Helios:
 * - €4 per tutti i domestici / privati
 * - €6 per business / aziende
 */
export function heliosMonthlyCommission(opts: {
  clientType?: string | null;
  classification?: string | null;
}): number {
  const clientType = (opts.clientType ?? "").trim().toUpperCase();
  if (clientType === "AZIENDA" || clientType === "BUSINESS") {
    return HELIOS_MONTHLY_ALTRO;
  }
  return HELIOS_MONTHLY_RESIDENTE;
}

type HeliosListinoRule = {
  id: string;
  clientSegment: string;
  name: string;
  paymentType?: string;
  gettoneMensile?: number;
};

/** Sceglie la regola listino Helios più adatta a classificazione e segmento. */
export function pickHeliosListinoRule(
  rules: HeliosListinoRule[],
  clientType: "PRIVATO" | "AZIENDA",
  classification?: string,
): HeliosListinoRule | undefined {
  if (!rules.length) return undefined;

  const expected = heliosMonthlyCommission({ clientType, classification });
  const classNorm = (classification ?? "").trim().toLowerCase();

  const segmentMatchers: string[] = [];
  if (clientType === "AZIENDA") {
    if (classNorm) segmentMatchers.push(classNorm);
    segmentMatchers.push("business", "azienda", "tutti");
  } else {
    if (classNorm) segmentMatchers.push(classNorm);
    segmentMatchers.push("residente", "privato", "domestico", "tutti");
  }

  for (const seg of segmentMatchers) {
    const hit = rules.find((r) => {
      const cs = (r.clientSegment ?? "TUTTI").toLowerCase();
      const nm = r.name.toLowerCase();
      if (seg === "tutti") return cs === "tutti" || cs === "all";
      return cs.includes(seg) || nm.includes(seg);
    });
    if (hit) return hit;
  }

  const byAmount = rules.find(
    (r) => Number(r.gettoneMensile) === expected && expected > 0,
  );
  if (byAmount) return byAmount;

  const monthly = rules.find(
    (r) => (r.paymentType ?? "").toUpperCase() === "MENSILE",
  );
  if (monthly) return monthly;

  return rules[0];
}
