import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";

export type ContractTableRow = {
  id: string;
  clientName: string;
  supplierName: string;
  podPdr: string;
  status: string;
  statusLabel: string;
  insertionDate: string;
  collaboratorName: string;
};

export function toContractRow(contract: {
  id: string;
  status: string;
  insertionDate: Date | string;
  podPdr?: string | null;
  client: {
    type: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  supplier: { name: string };
  collaborator: { name: string };
}): ContractTableRow {
  const clientName =
    contract.client.type === "AZIENDA" && contract.client.companyName
      ? contract.client.companyName
      : [contract.client.firstName, contract.client.lastName].filter(Boolean).join(" ") ||
        "Cliente senza nome";

  const insertion =
    typeof contract.insertionDate === "string"
      ? contract.insertionDate.slice(0, 10)
      : contract.insertionDate.toISOString().slice(0, 10);

  const status = contract.status as AppContractStatus;

  return {
    id: contract.id,
    clientName,
    supplierName: contract.supplier.name,
    podPdr: contract.podPdr?.trim() || "",
    status,
    statusLabel: CONTRACT_STATUS_LABELS[status] ?? contract.status,
    insertionDate: insertion.split("-").reverse().join("/"),
    collaboratorName: contract.collaborator.name,
  };
}
