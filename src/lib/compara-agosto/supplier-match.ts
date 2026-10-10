/**
 * Compatibilità fornitore file Compara ↔ contratto CRM.
 * Eni e Plenitude sono lo stesso gruppo; Iren è distinto.
 * Se il match POD punta a una Liquidata di altro fornitore,
 * cerca un contratto dello stesso nominativo + fornitore file
 * (anche con POD CRM XXXX) prima di chiedere «Da caricare».
 */

import { classifyComparaSupplier } from "@/lib/compara-agosto/amounts";
import type {
  PayoutCandidate,
  PayoutContractIndex,
} from "@/lib/payout/match";
import { isPlaceholderPod } from "@/lib/payout/normalize";
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

function rankCandidate(c: PayoutCandidate): number {
  // Preferisci già Incassato / liquidabile rispetto a bozze
  const st = `${c.status}`.toUpperCase();
  if (st === "PAGATO_DAL_FORNITORE") return 100;
  if (st === "PROVVIGIONE_LIQUIDATA") return 40;
  if (st === "ATTIVATO" || st === "INSERITO") return 60;
  return 20;
}

function pickBest(pool: PayoutCandidate[]): PayoutCandidate | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;
  return pool.slice().sort((a, b) => {
    const ra = rankCandidate(a);
    const rb = rankCandidate(b);
    if (rb !== ra) return rb - ra;
    const ta = a.insertionDate?.getTime?.() ?? 0;
    const tb = b.insertionDate?.getTime?.() ?? 0;
    return tb - ta;
  })[0]!;
}

/**
 * Cerca contratto fornitore-compatibile: prima per POD/PDR, poi per nominativo
 * (copre POD CRM segnaposto XXXX / ZXXXX sullo stesso cliente+fornitore).
 */
export function findComparaSupplierCompatible(
  index: PayoutContractIndex,
  row: ParsedPayoutRow,
  supplierHint: string,
): PayoutCandidate | null {
  const hint = supplierHint.trim();
  if (!hint) return null;

  const byPod: PayoutCandidate[] = [];
  for (const key of row.podKeys) {
    const found = index.byPod.get(key);
    if (!found) continue;
    for (const c of found) {
      if (comparaSuppliersCompatible(hint, c.supplierName)) {
        pushUnique(byPod, c);
      }
    }
  }
  const podPick = pickBest(byPod);
  if (podPick) return podPick;

  // Nome (+ ordine invertito già in personKeys) + stesso fornitore
  const byName: PayoutCandidate[] = [];
  for (const key of row.personKeys ?? []) {
    const found = index.byName.get(key);
    if (!found) continue;
    for (const c of found) {
      if (comparaSuppliersCompatible(hint, c.supplierName)) {
        pushUnique(byName, c);
      }
    }
  }
  // Tra i match per nome, preferisci quelli con POD reale o già Incassato
  const ranked = byName.slice().sort((a, b) => {
    const aPod = a.podPdr || a.pod || a.pdr || "";
    const bPod = b.podPdr || b.pod || b.pdr || "";
    const aReal = aPod && !isPlaceholderPod(aPod) ? 1 : 0;
    const bReal = bPod && !isPlaceholderPod(bPod) ? 1 : 0;
    if (bReal !== aReal) return bReal - aReal;
    const ra = rankCandidate(a);
    const rb = rankCandidate(b);
    if (rb !== ra) return rb - ra;
    return (b.insertionDate?.getTime?.() ?? 0) - (a.insertionDate?.getTime?.() ?? 0);
  });
  return ranked[0] ?? null;
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
 * Dopo matchPayoutRow: se il fornitore non combacia (o non c’è match POD),
 * prova nominativo+fornitore file; altrimenti «Da caricare» senza toccare
 * la Liquidata altrui.
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

  if (!hint) {
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

  if (matched && comparaSuppliersCompatible(hint, matched.supplierName)) {
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
      matchReason: matched
        ? "supplier_compatible"
        : "name_supplier_compatible",
      matchScore: matchScore ?? 50,
      candidateIds: [alt.id],
      supplierMismatchCreate: false,
      mismatchedSupplierName: null,
    };
  }

  if (!matched) {
    return {
      contract: null,
      ambiguous: false,
      matchReason: matchReason,
      matchScore: null,
      candidateIds: [],
      supplierMismatchCreate: false,
      mismatchedSupplierName: null,
    };
  }

  // Es. POD matcha Plenitude Liquidata, nessun Iren per quel nominativo
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
