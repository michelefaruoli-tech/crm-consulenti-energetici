"use client";

import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";

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

export function ClientsFilterTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const columns: FilterColumn[] = [
    { key: "name", label: "Cliente", getValue: (r) => String(r.name ?? "") },
    { key: "type", label: "Tipo", getValue: (r) => String(r.type ?? "") },
    { key: "fiscalCode", label: "CF / P.IVA", getValue: (r) => String(r.fiscalCode ?? "") },
    { key: "phone", label: "Telefono", getValue: (r) => String(r.phone ?? "") },
    { key: "email", label: "Email", getValue: (r) => String(r.email ?? "") },
    { key: "city", label: "Città", getValue: (r) => String(r.city ?? "") },
    { key: "contracts", label: "Contratti", getValue: (r) => String(r.contracts ?? "") },
    { key: "createdBy", label: "Inserito da", getValue: (r) => String(r.createdBy ?? "") },
  ];

  return (
    <ExcelFilterTable
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.id)}
      onRowClick={(r) => router.push(`/clienti/${r.id}`)}
    />
  );
}
