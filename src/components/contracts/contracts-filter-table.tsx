"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import type { ContractTableRow } from "@/lib/contract-row";
import { updateContractFieldAction } from "@/lib/contract-actions";

export function ContractsFilterTable({
  rows,
  editable = true,
}: {
  rows: ContractTableRow[];
  editable?: boolean;
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
      getValue: (r) => {
        const v = String(r.podPdr ?? "").trim();
        return v || "";
      },
      editable,
    },
    {
      key: "statusLabel",
      label: "Stato",
      getValue: (r) => String(r.statusLabel ?? ""),
      editable,
      render: editable
        ? undefined
        : (r) => <StatusBadge status={String(r.status)} />,
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

  return (
    <div className="space-y-2">
      {editable ? (
        <p className="text-xs text-slate-500">
          Celle modificabili: POD/PDR, Stato, Inserimento, Inizio fornitura, Operazione (Cambio /
          Voltura / Attivazione). Salva con Invio o click fuori.
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
