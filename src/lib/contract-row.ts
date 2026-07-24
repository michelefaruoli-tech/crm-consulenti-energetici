import { CONTRACT_STATUS_LABELS, ROLE_LABELS, type AppContractStatus, type AppRole } from "@/lib/constants";
import {
  computeSupplyStartDate,
  formatItDate,
  normalizeOperationType,
} from "@/lib/supply-dates";
import { resolveUtilityDisplay } from "@/lib/utility-display";
import {
  markLatestContractsByPod,
  resolveStornoInfo,
  type StornoKind,
} from "@/lib/storno-status";

export type CollaboratorOption = {
  id: string;
  name: string;
  active: boolean;
  role: string;
  roleLabel: string;
};

export type ContractTableRow = {
  id: string;
  clientId: string;
  clientName: string;
  supplierName: string;
  podPdr: string;
  utilityType: string;
  serviceLabel: string;
  techLines: string[];
  utilityFilter: string;
  status: string;
  statusLabel: string;
  insertionDate: string;
  supplyStartDate: string;
  operationType: string;
  operationLabel: string;
  collaboratorId: string;
  collaboratorName: string;
  archiveLabel: string;
  createdAtSort: string;
  stornoKind: StornoKind;
  stornoLabel: string;
  stornoRowClass: string;
  warnOnEdit: boolean;
};

type ContractForRow = {
  id: string;
  clientId?: string;
  status: string;
  insertionDate: Date | string;
  createdAt?: Date | string | null;
  supplyStartDate?: Date | string | null;
  operationType?: string | null;
  utilityType?: string | null;
  podPdr?: string | null;
  pod?: string | null;
  pdr?: string | null;
  serviceOther?: string | null;
  archiveLabel?: string | null;
  isHistorical?: boolean;
  collaboratorId?: string;
  recurrence?: string | null;
  expiryDate?: Date | string | null;
  durationMonths?: number | null;
  stornoEndDate?: Date | string | null;
  client: {
    type: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  supplier: { id?: string; name: string; stornoMonths?: number | null };
  collaborator: { id?: string; name: string };
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toContractRow(
  contract: ContractForRow,
  options?: { isLatestForPod?: boolean },
): ContractTableRow {
  const clientName =
    contract.client.type === "AZIENDA" && contract.client.companyName
      ? contract.client.companyName
      : [contract.client.firstName, contract.client.lastName].filter(Boolean).join(" ") ||
        "Cliente senza nome";

  const insertion =
    typeof contract.insertionDate === "string"
      ? contract.insertionDate.slice(0, 10)
      : contract.insertionDate.toISOString().slice(0, 10);

  const created =
    contract.createdAt == null
      ? insertion
      : typeof contract.createdAt === "string"
        ? contract.createdAt
        : contract.createdAt.toISOString();

  const status = contract.status as AppContractStatus;
  const supply =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate, contract.operationType);
  const op = normalizeOperationType(contract.operationType);

  const opLabels = {
    CAMBIO: "Switch",
    VOLTURA: "Voltura",
    ATTIVAZIONE: "Attivazione",
  } as const;

  const utility = resolveUtilityDisplay({
    utilityType: contract.utilityType,
    pod: contract.pod,
    pdr: contract.pdr,
    podPdr: contract.podPdr,
    serviceOther: contract.serviceOther,
  });

  const supplyDate = toDate(supply);
  const storno = resolveStornoInfo({
    status: contract.status,
    recurrence: contract.recurrence,
    supplyStartDate: supplyDate,
    stornoMonths: contract.supplier.stornoMonths,
    stornoEndDate: toDate(contract.stornoEndDate),
    expiryDate: toDate(contract.expiryDate),
    durationMonths: contract.durationMonths,
    isLatestForPod: options?.isLatestForPod,
  });

  return {
    id: contract.id,
    clientId: contract.clientId ?? "",
    clientName,
    supplierName: contract.supplier.name,
    podPdr: contract.podPdr?.trim() || utility.techLines.join(" · ") || "",
    utilityType: utility.kind,
    serviceLabel: utility.serviceLabel,
    techLines: utility.techLines,
    utilityFilter: utility.filterText,
    status,
    statusLabel: CONTRACT_STATUS_LABELS[status] ?? contract.status,
    insertionDate: insertion.split("-").reverse().join("/"),
    supplyStartDate: formatItDate(supply),
    operationType: op,
    operationLabel: opLabels[op],
    collaboratorId: contract.collaboratorId ?? contract.collaborator.id ?? "",
    collaboratorName: contract.collaborator.name,
    archiveLabel: contract.archiveLabel ?? "",
    createdAtSort: created,
    stornoKind: storno.kind,
    stornoLabel: storno.label,
    stornoRowClass: storno.rowClassName,
    warnOnEdit: storno.warnOnEdit,
  };
}

/** Costruisce le righe tabella applicando la regola “POD più recente”. */
export function toContractRows(contracts: ContractForRow[]): ContractTableRow[] {
  const forMark = contracts.map((c) => ({
    id: c.id,
    clientId: c.clientId ?? "",
    supplierId: c.supplier.id ?? null,
    podPdr: c.podPdr?.trim() || c.pod || c.pdr || null,
    supplyStartDate: toDate(c.supplyStartDate),
    insertionDate: toDate(c.insertionDate),
    createdAt: toDate(c.createdAt),
  }));
  const latestMap = markLatestContractsByPod(forMark);
  return contracts.map((c) =>
    toContractRow(c, { isLatestForPod: latestMap.get(c.id) ?? true }),
  );
}

export function toCollaboratorOption(user: {
  id: string;
  name: string;
  active: boolean;
  role: string;
}): CollaboratorOption {
  return {
    id: user.id,
    name: user.name,
    active: user.active,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role as AppRole] ?? user.role,
  };
}
