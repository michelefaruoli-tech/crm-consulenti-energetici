/**
 * P1.2 B3 — peer sullo stesso POD normalizzato (solo lettura / UI).
 * Non tocca markLatest (cliente+fornitore+POD) né archivio/provvigioni.
 */

import { clientDisplayName } from "@/lib/utils";
import {
  computeSupplyStartDate,
  formatItDate,
  normalizeOperationType,
  OPERATION_TYPE_LABELS,
  type OperationType,
} from "@/lib/supply-dates";
import { resolveUtilityDisplay } from "@/lib/utility-display";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  normalizePodKey,
  resolveStornoInfo,
} from "@/lib/storno-status";
import {
  resolveStornoBadges,
  type StornoBadgeDef,
} from "@/lib/storno-badges";

export type PodPeerSwitchHint = "switch_certo" | "switch_possibile";

export type ContractPodPeerInput = {
  id: string;
  contractNumber: string;
  clientId: string;
  supplierId: string;
  status: string;
  operationType?: string | null;
  podPdr?: string | null;
  pod?: string | null;
  pdr?: string | null;
  utilityType?: string | null;
  serviceOther?: string | null;
  productName?: string | null;
  supplyStartDate?: Date | null;
  insertionDate: Date;
  createdAt: Date;
  collectionDate?: Date | null;
  stornoEndDate?: Date | null;
  expiryDate?: Date | null;
  durationMonths?: number | null;
  isHistorical?: boolean;
  recurrence?: string | null;
  client: {
    type: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  supplier: { name: string; stornoMonths?: number | null };
  service?: { name: string } | null;
  commission?: { stornoDate?: Date | null } | null;
};

export type ContractPodPeerRow = {
  id: string;
  contractNumber: string;
  clientName: string;
  supplierName: string;
  serviceLabel: string;
  operationType: OperationType | null;
  operationLabel: string | null;
  supplyStartDate: Date | null;
  supplyStartLabel: string;
  supplySortMs: number;
  switchHint: PodPeerSwitchHint;
  switchHintLabel: string;
  isCurrent: boolean;
  badges: StornoBadgeDef[];
};

/** CAMBIO / SWITCH (e alias diretti) → switch certo; altrimenti possibile. */
export function resolvePodPeerSwitchHint(
  operationType: string | null | undefined,
): PodPeerSwitchHint {
  const raw = String(operationType ?? "")
    .trim()
    .toUpperCase();
  if (
    raw === "CAMBIO" ||
    raw === "SWITCH" ||
    raw === "CAMBIO_FORNITORE"
  ) {
    return "switch_certo";
  }
  return "switch_possibile";
}

export function podPeerSwitchHintLabel(hint: PodPeerSwitchHint): string {
  return hint === "switch_certo" ? "switch certo" : "switch possibile";
}

function resolvedSupplyStart(c: ContractPodPeerInput): Date | null {
  if (c.supplyStartDate) return c.supplyStartDate;
  if (!c.operationType && !c.insertionDate) return null;
  // Solo se c’è un tipo noto: altrimenti non forzare CAMBIO di default
  const raw = String(c.operationType ?? "").trim();
  if (!raw) return c.supplyStartDate ?? null;
  return computeSupplyStartDate(c.insertionDate, c.operationType);
}

function operationLabelOf(
  operationType: string | null | undefined,
): { type: OperationType | null; label: string | null } {
  const raw = String(operationType ?? "").trim();
  if (!raw) return { type: null, label: null };
  const type = normalizeOperationType(operationType);
  return { type, label: OPERATION_TYPE_LABELS[type] };
}

/**
 * Filtra per POD normalizzato, ordina per data inizio fornitura (recente → vecchio),
 * calcola badge storno con le stesse mappe latest/early già usate in lista.
 * `markLatestContractsByPod` resta su chiave cliente+fornitore+POD (invariata).
 */
export function buildContractPodPeerRows(
  contracts: ContractPodPeerInput[],
  opts: { currentId: string; podKey: string },
): ContractPodPeerRow[] {
  const key = normalizePodKey(opts.podKey);
  if (!key || key.length < 6) return [];

  const samePod = contracts.filter(
    (c) => normalizePodKey(c.podPdr || c.pod || c.pdr) === key,
  );
  if (samePod.length === 0) return [];

  const forMark = samePod.map((c) => ({
    id: c.id,
    clientId: c.clientId,
    supplierId: c.supplierId,
    podPdr: c.podPdr || c.pod || c.pdr,
    supplyStartDate: resolvedSupplyStart(c),
    insertionDate: c.insertionDate,
    createdAt: c.createdAt,
    collectionDate: c.collectionDate,
    stornoMonths: c.supplier.stornoMonths ?? null,
    stornoEndDate: c.stornoEndDate,
  }));
  const latestMap = markLatestContractsByPod(forMark);
  const earlyMap = markEarlyReswitchContracts(forMark);
  const hasActivePeer = samePod.some(
    (c) => c.id !== opts.currentId && !c.isHistorical,
  );

  const rows: ContractPodPeerRow[] = samePod.map((c) => {
    const supply = resolvedSupplyStart(c);
    const op = operationLabelOf(c.operationType);
    const utility = resolveUtilityDisplay({
      utilityType: c.utilityType,
      pod: c.pod,
      pdr: c.pdr,
      podPdr: c.podPdr,
      serviceOther: c.serviceOther,
    });
    const serviceLabel =
      c.productName?.trim() ||
      c.service?.name?.trim() ||
      utility.serviceLabel ||
      "—";

    const stornoInfo = resolveStornoInfo({
      status: c.status,
      recurrence: c.recurrence,
      supplyStartDate: supply,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
      expiryDate: c.expiryDate,
      durationMonths: c.durationMonths,
      isLatestForPod: latestMap.get(c.id) ?? true,
      collectionDate: c.collectionDate,
      isEarlyReswitch: earlyMap.get(c.id) ?? false,
    });

    const badges = resolveStornoBadges({
      stornoKind: stornoInfo.kind,
      isHistorical: c.isHistorical === true,
      isEarlyReswitch: earlyMap.get(c.id) === true,
      isStornato:
        c.status === "STORNATO" || Boolean(c.commission?.stornoDate),
      hasActivePodPeer: hasActivePeer || samePod.length > 1,
    });

    const switchHint = resolvePodPeerSwitchHint(c.operationType);

    return {
      id: c.id,
      contractNumber: c.contractNumber,
      clientName: clientDisplayName(c.client),
      supplierName: c.supplier.name,
      serviceLabel,
      operationType: op.type,
      operationLabel: op.label,
      supplyStartDate: supply,
      supplyStartLabel: supply ? formatItDate(supply) : "—",
      supplySortMs: supply?.getTime() ?? 0,
      switchHint,
      switchHintLabel: podPeerSwitchHintLabel(switchHint),
      isCurrent: c.id === opts.currentId,
      badges,
    };
  });

  rows.sort((a, b) => {
    if (b.supplySortMs !== a.supplySortMs) return b.supplySortMs - a.supplySortMs;
    return a.contractNumber.localeCompare(b.contractNumber, "it");
  });

  return rows;
}
