"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import type { ContractTableRow } from "@/lib/contract-row";
import { updateContractFieldAction } from "@/lib/contract-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

export function ContractsFilterTable({
  rows,
  editable = true,
  canDelete = false,
}: {
  rows: ContractTableRow[];
  editable?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();

  async function onCellEdit(row: Record<string, unknown>, key: string, value: string) {
    const map: Record<string, string> = {
      podPdr: "podPdr",
      statusLabel: "status",
      insertionDate: "insertionDate",
      supplyStartDate: "supplyStartDate",
      operationLabel: "operationType",
    };
    const field = map[key];
    if (!field) return;

    const fd = new FormData();
    fd.set("contractId", String(row.id));
    fd.set("field", field);
    fd.set("value", value);
    await updateContractFieldAction(fd);
    router.refresh();
  }

  const columns: FilterColumn[] = [
    {
      key: "clientName",
      label: "Cliente",
      getValue: (r) => String(r.clientName ?? ""),
      render: (r) => (
        <Link
          href={`/contratti/${String(r.id)}`}
          className="font-medium text-emerald-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
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
      key: "podPdr",
      label: "POD/PDR",
      getValue: (r) => String(r.podPdr ?? "").trim(),
      editable,
    },
    {
      key: "statusLabel",
      label: "Stato",
      getValue: (r) => String(r.statusLabel ?? ""),
      editable,
      render: editable ? undefined : (r) => <StatusBadge status={String(r.status)} />,
    },
    {
      key: "insertionDate",
      label: "Inserimento",
      getValue: (r) => String(r.insertionDate ?? ""),
      editable,
    },
    {
      key: "supplyStartDate",
      label: "Inizio fornitura",
      getValue: (r) => String(r.supplyStartDate ?? ""),
      editable,
    },
    {
      key: "operationLabel",
      label: "Operazione",
      getValue: (r) => String(r.operationLabel ?? ""),
      editable,
    },
    {
      key: "collaboratorName",
      label: "Collaboratore",
      getValue: (r) => String(r.collaboratorName ?? ""),
    },
  ];

  if (canDelete) {
    columns.push({
      key: "_del",
      label: "",
      getValue: () => "",
      render: (r) => <DeleteRowButton kind="contract" id={String(r.id)} />,
    });
  }

  return (
    <div className="space-y-2">
      {editable || canDelete ? (
        <p className="text-xs text-slate-500">
          {editable
            ? "Celle modificabili: POD/PDR, Stato, date, Operazione (Invio / click fuori)."
            : null}{" "}
          {canDelete ? "Elimina toglie la riga (utile per doppioni)." : null}
        </p>
      ) : null}
      <ExcelFilterTable
        dense
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.id)}
        onRowClick={(r) => router.push(`/contratti/${r.id}`)}
        onCellEdit={editable ? onCellEdit : undefined}
      />
    </div>
  );
}
