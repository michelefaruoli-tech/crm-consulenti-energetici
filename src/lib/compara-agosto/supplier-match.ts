/**
 * Compatibilità fornitore file Compara ↔ contratto CRM.
 * Eni e Plenitude sono lo stesso gruppo; Iren è distinto.
 * Se il match POD punta a una Liquidata di altro fornitore,
 * non è il pagamento di agosto → nuova riga per il fornitore del file.
 */

import { classifyComparaSupplier } from "@/lib/compara-agosto/amounts";
import type {
  PayoutCandidate,
  PayoutContractIndex,
} from "@/lib/payout/match";
import type { ParsedPayoutRow } from "@/lib/payout/types";

/** True se file e CRM indicano lo stesso fornitore Compara (Eni≡Plenitude). */
export function comparaSuppliersCompatible(
  fileHint: string | null | undefined,
  crmName: string | null | undefined,
): boolean {
  const fKind = classifyComparaSupplier(fileHint);
  const cKind = classifyComparaSupplier(crmName);
  if (fKind !== "other" && cKind !== "other") {
    return fKind === cKind;
  }
  const fs = (fileHint ?? "").trim().toLowerCase();
  const cs = (crmName ?? "").trim().toLowerCase();
  if (!fs || !cs) return true; // senza hint non si può escludere
  if (fs.includes(cs) || cs.includes(fs)) return true;
  if (fKind === "eni" && (cs.includes("eni") || cs.includes("plenitude"))) {
    return true;
  }
  if (cKind === "eni" && (fs.includes("eni") || fs.includes("plenitude"))) {
    return true;
  }
  if (fKind === "iren" && cs.includes("iren")) return true;
  if (cKind === "iren" && fs.includes("iren")) return true;
  return false;
}

/** Etichetta corta per «Nuova riga Iren». */
export function comparaSupplierDisplayLabel(
  hint: string | null | undefined,
): string {
  const raw = (hint ?? "").trim();
  if (!raw) return "Compara";
  const kind = classifyComparaSupplier(raw);
  if (kind === "iren") return "Iren";
  if (kind === "eni") {
    return raw.toLowerCase().includes("plenitude") ? "Plenitude" : "Eni";
  }
  return raw.split(/\s+/)[0] || raw;
}

function pushUnique(list: PayoutCandidate[], c: PayoutCandidate): void {
  if (!list.some((x) => x.id === c.id)) list.push(c);
}

/**
 * Cerca un contratto con lo stesso POD/PDR e fornitore compatibile col file.
 * Usato quando il match primario punta a un altro fornitore.
 */
export function findComparaSupplierCompatible(
  index: PayoutContractIndex,
  row: ParsedPayoutRow,
  supplierHint: string,
): PayoutCandidate | null {
  const hint = supplierHint.trim();
  if (!hint || row.podKeys.length === 0) return null;

  const pool: PayoutCandidate[] = [];
  for (const key of row.podKeys) {
    const found = index.byPod.get(key);
    if (!found) continue;
    for (const c of found) {
      if (comparaSuppliersCompatible(hint, c.supplierName)) {
        pushUnique(pool, c);
      }
    }
  }

  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;

  // Preferisci il più recente
  return pool.slice().sort((a, b) => {
    const ta = a.insertionDate?.getTime?.() ?? 0;
    const tb = b.insertionDate?.getTime?.() ?? 0;
    return tb - ta;
  })[0]!;
}

export type ComparaResolvedMatch = {
  contract: PayoutCandidate | null;
  ambiguous: boolean;
  matchReason: string | null;
  matchScore: number | null;
  candidateIds: string[];
  /** Match primario scartato per fornitore diverso → nuova riga. */
  supplierMismatchCreate: boolean;
  mismatchedSupplierName: string | null;
};

/**
 * Dopo matchPayoutRow: se il fornitore non combacia, prova un'alternativa
 * o forza create (contract null) senza toccare la Liquidata altrui.
 */
export function resolveComparaSupplierMatch(params: {
  index: PayoutContractIndex;
  row: ParsedPayoutRow;
  matched: PayoutCandidate | null;
  ambiguous: boolean;
  matchReason: string | null;
  matchScore: number | null;
  candidateIds: string[];
}): ComparaResolvedMatch {
  const {
    index,
    row,
    matched,
    ambiguous,
    matchReason,
    matchScore,
    candidateIds,
  } = params;
  const hint = row.supplierHint.trim();

  if (!matched || !hint) {
    return {
      contract: matched,
      ambiguous,
      matchReason,
      matchScore,
      candidateIds,
      supplierMismatchCreate: false,
      mismatchedSupplierName: null,
    };
  }

  if (comparaSuppliersCompatible(hint, matched.supplierName)) {
    return {
      contract: matched,
      ambiguous,
      matchReason,
      matchScore,
      candidateIds,
      supplierMismatchCreate: false,
      mismatchedSupplierName: null,
    };
  }

  const alt = findComparaSupplierCompatible(index, row, hint);
  if (alt) {
    return {
      contract: alt,
      ambiguous: false,
      matchReason: "supplier_compatible",
      matchScore,
      candidateIds: [alt.id],
      supplierMismatchCreate: false,
      mismatchedSupplierName: null,
    };
  }

  // Es. Lepore: PDR matcha Plenitude Liquidata 2025, file è Iren → nuova riga
  return {
    contract: null,
    ambiguous: false,
    matchReason: "supplier_mismatch_create",
    matchScore: null,
    candidateIds: [],
    supplierMismatchCreate: true,
    mismatchedSupplierName: matched.supplierName,
  };
}
