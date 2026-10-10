/**
 * Regole fill POD/PDR per Fagiano (e in generale quando il file ha POD).
 *
 * - Match sicuro (nominativo univoco, riga CRM senza POD o POD uguale):
 *   precompilabile, resta in approvazione singola.
 * - POD CRM già diverso o nominativo ambiguo: lista «da confermare»,
 *   nessun overwrite automatico.
 */

import { normalizePodKey } from "@/lib/storno-status";
import type { ComparaPodFillMode } from "@/lib/compara-agosto/view-types";

export type PodFillDecision = {
  mode: ComparaPodFillMode;
  proposedPodFill: string | null;
  reason: string | null;
};

function crmPodRaw(contract: {
  podPdr?: string | null;
  pod?: string | null;
  pdr?: string | null;
}): string {
  return (contract.podPdr || contract.pod || contract.pdr || "").trim();
}

/**
 * Decide se proporre un fill POD sul contratto CRM.
 * `ambiguousMatch` = più candidati o match solo nominativo da confermare.
 */
export function decidePodFill(params: {
  filePodRaw: string;
  contract: {
    podPdr?: string | null;
    pod?: string | null;
    pdr?: string | null;
  } | null;
  isFagiano: boolean;
  ambiguousMatch: boolean;
}): PodFillDecision {
  const filePod = params.filePodRaw.trim();
  const fileKey = filePod ? normalizePodKey(filePod) : "";
  const crmRaw = params.contract ? crmPodRaw(params.contract) : "";
  const crmKey = crmRaw ? normalizePodKey(crmRaw) : "";

  if (params.ambiguousMatch) {
    if (fileKey && crmKey && fileKey !== crmKey) {
      return {
        mode: "needs_confirm",
        proposedPodFill: filePod,
        reason: "Nominativo ambiguo e POD diverso da CRM",
      };
    }
    if (fileKey && !crmKey) {
      return {
        mode: "needs_confirm",
        proposedPodFill: filePod,
        reason: "Nominativo ambiguo: fill POD da confermare",
      };
    }
    return {
      mode: "none",
      proposedPodFill: null,
      reason: "Nominativo ambiguo: nessuna scrittura POD automatica",
    };
  }

  // File senza POD (tipico Fagiano): mostra POD CRM in anteprima, non scrive
  if (!fileKey) {
    if (params.isFagiano && crmRaw) {
      return {
        mode: "display_from_crm",
        proposedPodFill: null,
        reason: "Fagiano senza POD in file: match su nominativo, POD da CRM",
      };
    }
    return { mode: "none", proposedPodFill: null, reason: null };
  }

  // File ha POD, CRM vuoto → prefill sicuro
  if (!crmKey) {
    return {
      mode: "safe_prefill",
      proposedPodFill: filePod,
      reason: "POD assente in CRM: proposta fill da file",
    };
  }

  // Stesso POD: niente da scrivere
  if (fileKey === crmKey) {
    return {
      mode: "none",
      proposedPodFill: null,
      reason: "POD file = CRM",
    };
  }

  // Diverso → Michele decide
  return {
    mode: "needs_confirm",
    proposedPodFill: filePod,
    reason: `POD diverso (file ${filePod} ≠ CRM ${crmRaw})`,
  };
}
