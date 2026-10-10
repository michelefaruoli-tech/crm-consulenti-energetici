/**
 * Regole fill POD/PDR per Fagiano (e in generale quando il file ha POD).
 *
 * - Match sicuro (nominativo univoco, riga CRM senza POD o POD uguale):
 *   precompilabile, resta in approvazione singola.
 * - POD CRM già diverso o nominativo ambiguo: lista «da confermare»,
 *   nessun overwrite automatico.
 */

import {
  effectiveCrmPod,
  isPlaceholderPod,
  podsEquivalent,
} from "@/lib/payout/normalize";
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
  const fileUsable = Boolean(filePod) && !isPlaceholderPod(filePod);
  const fileKey = fileUsable ? normalizePodKey(filePod) : "";
  const crmStored = params.contract ? crmPodRaw(params.contract) : "";
  const crmRaw = effectiveCrmPod(crmStored);
  const crmKey = crmRaw ? normalizePodKey(crmRaw) : "";
  const crmWasPlaceholder =
    Boolean(crmStored.trim()) && isPlaceholderPod(crmStored);

  if (params.ambiguousMatch) {
    if (fileKey && crmKey && !podsEquivalent(filePod, crmRaw)) {
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
        reason: crmWasPlaceholder
          ? "Nominativo ambiguo: sostituisci segnaposto POD (XXXX…) dal file"
          : "Nominativo ambiguo: fill POD da confermare",
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

  // CRM vuoto o segnaposto (XXXX / ZXXXX / maschera) → fill dal file
  if (!crmKey) {
    return {
      mode: "safe_prefill",
      proposedPodFill: filePod,
      reason: crmWasPlaceholder
        ? "POD CRM è segnaposto (XXXX…): proposta dal file"
        : "POD assente in CRM: proposta fill da file",
    };
  }

  // Stesso POD/PDR anche se manca solo lo 00 iniziale (Excel): non sovrascrivere
  if (podsEquivalent(filePod, crmRaw)) {
    return {
      mode: "none",
      proposedPodFill: null,
      reason: "POD/PDR file = CRM (zeri iniziali equivalenti)",
    };
  }

  // Diverso → Michele decide (non proporre di togliere gli 00 già corretti in CRM)
  return {
    mode: "needs_confirm",
    proposedPodFill: filePod,
    reason: `POD diverso (file ${filePod} ≠ CRM ${crmRaw})`,
  };
}
