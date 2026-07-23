"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";

type Row = {
  id: string;
  clientName: string;
  supplierName: string;
  status: string;
  statusLabel: string;
  insertionDate: string;
  collaboratorName: string;
};

export function ContractsFilterTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const columns: FilterColumn[] = [
    {
      key: "clientName",
      label: "Cliente",
      getValue: (r) => String(r.clientName ?? ""),
      render: (r) => (
        <Link
          href={`/contratti/${String(r.id)}`}
          className="font-medium text-emerald-700 hover:underline"
        >
          {String(r.clientName)}
        </Link>
      ),
    },
    {
      key: "supplierName",
      label: "Fornitore",
      getValue: (r) => String(r.supplierName ?? ""),
    },
    {
      key: "statusLabel",
      label: "Stato",
      getValue: (r) => String(r.statusLabel ?? ""),
      render: (r) => <StatusBadge status={String(r.status)} />,
    },
    {
      key: "insertionDate",
      label: "Data inserimento",
      getValue: (r) => String(r.insertionDate ?? ""),
    },
    {
      key: "collaboratorName",
      label: "Collaboratore",
      getValue: (r) => String(r.collaboratorName ?? ""),
    },
  ];

  return (
    <ExcelFilterTable
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.id)}
      onRowClick={(r) => router.push(`/contratti/${r.id}`)}
    />
  );
}

export function toContractRow(contract: {
  id: string;
  status: string;
  insertionDate: Date | string;
  client: {
    type: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  supplier: { name: string };
  collaborator: { name: string };
}): Row {
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
    status,
    statusLabel: CONTRACT_STATUS_LABELS[status] ?? contract.status,
    insertionDate: insertion.split("-").reverse().join("/"),
    collaboratorName: contract.collaborator.name,
  };
}
