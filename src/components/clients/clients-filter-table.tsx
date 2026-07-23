"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

type Row = {
  id: string;
  name: string;
  type: string;
  fiscalCode: string;
  phone: string;
  email: string;
  city: string;
  contracts: string;
  createdBy: string;
};

export function ClientsFilterTable({
  rows,
  canDelete = false,
}: {
  rows: Row[];
  canDelete?: boolean;
}) {
  const router = useRouter();

  const columns: FilterColumn[] = [
    {
      key: "name",
      label: "Cliente",
      getValue: (r) => String(r.name ?? ""),
      render: (r) => (
        <Link
          href={`/clienti/${String(r.id)}`}
          className="font-medium text-emerald-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(r.name)}
        </Link>
      ),
    },
    { key: "type", label: "Tipo", getValue: (r) => String(r.type ?? "") },
    { key: "fiscalCode", label: "CF / P.IVA", getValue: (r) => String(r.fiscalCode ?? "") },
    { key: "phone", label: "Telefono", getValue: (r) => String(r.phone ?? "") },
    { key: "email", label: "Email", getValue: (r) => String(r.email ?? "") },
    { key: "city", label: "Città", getValue: (r) => String(r.city ?? "") },
    { key: "contracts", label: "Contratti", getValue: (r) => String(r.contracts ?? "") },
    { key: "createdBy", label: "Inserito da", getValue: (r) => String(r.createdBy ?? "") },
  ];

  if (canDelete) {
    columns.push({
      key: "_del",
      label: "",
      getValue: () => "",
      render: (r) => <DeleteRowButton kind="client" id={String(r.id)} />,
    });
  }

  return (
    <ExcelFilterTable
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.id)}
      onRowClick={(r) => router.push(`/clienti/${r.id}`)}
    />
  );
}
