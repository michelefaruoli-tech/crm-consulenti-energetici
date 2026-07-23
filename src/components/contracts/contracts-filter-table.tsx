"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import type { ContractTableRow } from "@/lib/contract-row";

export function ContractsFilterTable({ rows }: { rows: ContractTableRow[] }) {
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
      key: "podPdr",
      label: "POD / PDR",
      getValue: (r) => String(r.podPdr ?? "") || "(vuoto)",
      render: (r) => {
        const code = String(r.podPdr ?? "").trim();
        if (!code) return <span className="text-slate-400">—</span>;
        return (
          <span className="font-mono text-sm font-semibold tracking-wide text-slate-900">
            {code}
          </span>
        );
      },
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
