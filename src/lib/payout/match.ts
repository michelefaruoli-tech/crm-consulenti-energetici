import "server-only";

/**
 * Cascata di matching riga di rendiconto → contratto CRM.
 *
 * Generalizza `resolveHeliosMatch` (`helios-provvigioni-import.ts`) alle fonti
 * che non hanno un POD pulito: PDR con zeri persi, POD mascherato, codice
 * fiscale, nome cliente. Il punteggio non è decorativo: sotto soglia la riga è
 * ambigua e non viene applicata.
 */

import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { normalizePodKey } from "@/lib/storno-status";
import { pickHeliosContractForPeriod } from "@/lib/helios-provvigioni-shared";
import {
  fuzzyPersonKey,
  normalizeFiscalKey,
  podCandidateKeys,
} from "@/lib/payout/normalize";
import type { ParsedPayoutRow } from "@/lib/payout/types";

/** Punteggio minimo per applicare senza conferma umana. */
export const PAYOUT_AUTO_MATCH_SCORE = 90;

/** Cifre finali richieste per tentare il match su POD mascherato. */
const MASKED_SUFFIX_MIN = 4;

export type PayoutMatchReason =
  | "pod_exact"
  | "pdr_zero_fill"
  | "fiscal_code"
  | "pod_masked_suffix"
  | "name_period";

const REASON_SCORE: Record<PayoutMatchReason, number> = {
  pod_exact: 100,
  pdr_zero_fill: 95,
  fiscal_code: 90,
  pod_masked_suffix: 70,
  name_period: 60,
};

export const PAYOUT_MATCH_REASON_LABEL: Record<PayoutMatchReason, string> = {
  pod_exact: "POD esatto",
  pdr_zero_fill: "PDR con zero ripristinato",
  fiscal_code: "Codice fiscale / P.IVA",
  pod_masked_suffix: "POD mascherato + cognome",
  name_period: "Nome + periodo",
};

const CONTRACT_SELECT = {
  id: true,
  contractNumber: true,
  podPdr: true,
  pod: true,
  pdr: true,
  supplierId: true,
  collaboratorId: true,
  recurrence: true,
  status: true,
  supplyStartDate: true,
  insertionDate: true,
  operationType: true,
  expiryDate: true,
  supplier: { select: { id: true, name: true } },
  collaborator: { select: { id: true, name: true } },
  client: {
    select: {
      type: true,
      firstName: true,
      lastName: true,
      companyName: true,
      fiscalCode: true,
      vatNumber: true,
    },
  },
} as const;

export type PayoutCandidate = {
  id: string;
  contractNumber: string;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  supplierId: string;
  collaboratorId: string;
  recurrence: string | null;
  status: string;
  supplyStartDate: Date | null;
  insertionDate: Date;
  operationType: string | null;
  expiryDate: Date | null;
  supplierName: string;
  collaboratorName: string;
  clientName: string;
};

export type PayoutContractIndex = {
  byPod: Map<string, PayoutCandidate[]>;
  byPodSuffix: Map<string, PayoutCandidate[]>;
  byFiscal: Map<string, PayoutCandidate[]>;
  byName: Map<string, PayoutCandidate[]>;
  size: number;
};

function push(
  map: Map<string, PayoutCandidate[]>,
  key: string,
  value: PayoutCandidate,
) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.some((c) => c.id === value.id)) list.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Indice dei contratti candidati. Un solo caricamento per import: le fonti
 * marketplace mescolano fornitori diversi, quindi non si può restringere a uno.
 */
export async function loadPayoutContractIndex(): Promise<PayoutContractIndex> {
  const contracts = await prisma.contract.findMany({
    where: { deletedAt: null, isHistorical: false },
    select: CONTRACT_SELECT,
  });

  const index: PayoutContractIndex = {
    byPod: new Map(),
    byPodSuffix: new Map(),
    byFiscal: new Map(),
    byName: new Map(),
    size: contracts.length,
  };

  for (const c of contracts) {
    const candidate: PayoutCandidate = {
      id: c.id,
      contractNumber: c.contractNumber,
      podPdr: c.podPdr,
      pod: c.pod,
      pdr: c.pdr,
      supplierId: c.supplierId,
      collaboratorId: c.collaboratorId,
      recurrence: c.recurrence,
      status: c.status,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      operationType: c.operationType,
      expiryDate: c.expiryDate,
      supplierName: c.supplier.name,
      collaboratorName: c.collaborator.name,
      clientName: clientDisplayName(c.client),
    };

    for (const raw of [c.podPdr, c.pod, c.pdr]) {
      if (!raw) continue;
      for (const key of podCandidateKeys(raw)) {
        push(index.byPod, key, candidate);
        if (key.length >= MASKED_SUFFIX_MIN) {
          const digits = key.replace(/[^0-9]/g, "");
          if (digits.length >= MASKED_SUFFIX_MIN) {
            push(index.byPodSuffix, digits.slice(-MASKED_SUFFIX_MIN), candidate);
          }
        }
      }
    }

    for (const raw of [c.client.fiscalCode, c.client.vatNumber]) {
      const key = normalizeFiscalKey(raw ?? "");
      if (key) push(index.byFiscal, key, candidate);
    }

    const nameKey = fuzzyPersonKey(candidate.clientName);
    if (nameKey) push(index.byName, nameKey, candidate);
    // Solo cognome: alcune fonti riportano esclusivamente quello
    if (c.client.lastName) {
      const last = fuzzyPersonKey(c.client.lastName);
      if (last && last !== nameKey) push(index.byName, last, candidate);
    }
  }

  return index;
}

export type PayoutMatchOutcome =
  | {
      status: "matched";
      contract: PayoutCandidate;
      score: number;
      reason: PayoutMatchReason;
    }
  | {
      status: "ambiguous";
      candidates: PayoutCandidate[];
      score: number;
      reason: PayoutMatchReason;
    }
  | { status: "unmatched" };

/** Restringe i candidati al fornitore indicato dal file, quando riconoscibile. */
function filterBySupplierHint(
  candidates: PayoutCandidate[],
  supplierHint: string,
): PayoutCandidate[] {
  const hint = supplierHint.trim().toLowerCase();
  if (!hint || candidates.length <= 1) return candidates;
  const filtered = candidates.filter((c) => {
    const name = c.supplierName.toLowerCase();
    return name.includes(hint) || hint.includes(name);
  });
  return filtered.length > 0 ? filtered : candidates;
}

/**
 * Sceglie fra più candidati usando la finestra di competenza, la stessa logica
 * già in uso per lo switch sullo stesso POD.
 */
function pickForPeriod(
  candidates: PayoutCandidate[],
  period: string | null,
): PayoutCandidate | null {
  if (candidates.length === 1) return candidates[0]!;
  if (!period) return null;
  return pickHeliosContractForPeriod(candidates, period);
}

function resolve(
  candidates: PayoutCandidate[],
  reason: PayoutMatchReason,
  row: ParsedPayoutRow,
  requireConfirm: boolean,
): PayoutMatchOutcome | null {
  const narrowed = filterBySupplierHint(candidates, row.supplierHint);
  if (narrowed.length === 0) return null;

  const picked = pickForPeriod(narrowed, row.period);
  const score = REASON_SCORE[reason];

  if (!picked) {
    return { status: "ambiguous", candidates: narrowed, score, reason };
  }
  if (requireConfirm || score < PAYOUT_AUTO_MATCH_SCORE) {
    return { status: "ambiguous", candidates: [picked], score, reason };
  }
  return { status: "matched", contract: picked, score, reason };
}

/** Applica la cascata di matching a una riga letta dal file. */
export function matchPayoutRow(
  row: ParsedPayoutRow,
  index: PayoutContractIndex,
): PayoutMatchOutcome {
  // 1-2. POD/PDR esatto, poi PDR con zero iniziale ripristinato
  for (const key of row.podKeys) {
    const found = index.byPod.get(key);
    if (!found?.length) continue;
    // L'etichetta dice come è avvenuto il match: «esatto» solo se il valore nel
    // file corrisponde davvero a quello sul contratto, senza normalizzazioni
    const exact = found.some((c) =>
      [c.podPdr, c.pod, c.pdr].some(
        (raw) => raw != null && normalizePodKey(raw) === key,
      ),
    );
    const outcome = resolve(
      found,
      exact ? "pod_exact" : "pdr_zero_fill",
      row,
      false,
    );
    if (outcome) return outcome;
  }

  // 3. Codice fiscale o P.IVA
  if (row.fiscalKey) {
    const found = index.byFiscal.get(row.fiscalKey);
    if (found?.length) {
      const outcome = resolve(found, "fiscal_code", row, false);
      if (outcome) return outcome;
    }
  }

  // 4. POD mascherato: suffisso + nome, sempre da confermare
  if (row.podMaskedSuffix.length >= MASKED_SUFFIX_MIN) {
    const suffix = row.podMaskedSuffix.slice(-MASKED_SUFFIX_MIN);
    const bySuffix = index.byPodSuffix.get(suffix) ?? [];
    if (bySuffix.length > 0) {
      const byName =
        row.personKeys.length > 0
          ? bySuffix.filter((c) =>
              row.personKeys.some((key) => {
                const candidateKey = fuzzyPersonKey(c.clientName);
                return (
                  candidateKey === key ||
                  candidateKey.includes(key) ||
                  key.includes(candidateKey)
                );
              }),
            )
          : [];
      const pool = byName.length > 0 ? byName : bySuffix;
      const outcome = resolve(pool, "pod_masked_suffix", row, true);
      if (outcome) return outcome;
    }
  }

  // 5. Nome cliente + periodo compatibile
  for (const key of row.personKeys) {
    const found = index.byName.get(key);
    if (!found?.length) continue;
    const outcome = resolve(found, "name_period", row, true);
    if (outcome) return outcome;
  }

  return { status: "unmatched" };
}
