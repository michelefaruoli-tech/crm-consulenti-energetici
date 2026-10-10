/**
 * Regole importo Compara (Michele Faruoli):
 * - Fagiano: Eni 70€, Iren 65€
 * - Laforgia e tutti gli altri: Iren 60€, Eni 70€
 *
 * L'importo del file (Gettone marketplace) viene sostituito da queste quote.
 */

export const COMPARA_AMOUNT_FAGIANO_ENI = 70;
export const COMPARA_AMOUNT_FAGIANO_IREN = 65;
export const COMPARA_AMOUNT_OTHER_ENI = 70;
export const COMPARA_AMOUNT_OTHER_IREN = 60;

/** Collaboratore Fagiano (Shop CRM o hint file). */
export function isFagianoCollaborator(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\bfagiano\b/i.test(name.trim());
}

export type ComparaSupplierKind = "eni" | "iren" | "other";

export function classifyComparaSupplier(
  supplierHint: string | null | undefined,
): ComparaSupplierKind {
  const s = (supplierHint ?? "").trim().toLowerCase();
  if (!s) return "other";
  if (s.includes("eni") || s.includes("plenitude")) return "eni";
  if (s.includes("iren")) return "iren";
  return "other";
}

/**
 * Importo CRM per riga Compara.
 * Per fornitori diversi da Eni/Iren restituisce null (si tiene il gettone file).
 * `units` = Valore file (1 o 2 per Dual): moltiplica la quota unitaria.
 */
export function comparaRuleAmount(params: {
  supplierHint: string | null | undefined;
  collaboratorName: string | null | undefined;
  /** Valore colonna Compara (1 o 2). Default 1. */
  units?: number | null;
  /** Gettone letto dal file, usato se fornitore non in regola. */
  fileAmount?: number | null;
}): { amount: number | null; ruleApplied: boolean; unitAmount: number | null } {
  const units =
    params.units != null && Number.isFinite(params.units) && params.units >= 1
      ? Math.min(Math.round(params.units), 2)
      : 1;
  const kind = classifyComparaSupplier(params.supplierHint);
  const fagiano = isFagianoCollaborator(params.collaboratorName);

  let unit: number | null = null;
  if (kind === "eni") {
    unit = fagiano ? COMPARA_AMOUNT_FAGIANO_ENI : COMPARA_AMOUNT_OTHER_ENI;
  } else if (kind === "iren") {
    unit = fagiano ? COMPARA_AMOUNT_FAGIANO_IREN : COMPARA_AMOUNT_OTHER_IREN;
  }

  if (unit == null) {
    return {
      amount: params.fileAmount ?? null,
      ruleApplied: false,
      unitAmount: null,
    };
  }
  return {
    amount: unit * units,
    ruleApplied: true,
    unitAmount: unit,
  };
}
