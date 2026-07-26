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
  ricorrenza?: string;
  createdBy: string;
  rowClassName?: string;
  stornoLabel?: string;
  stornoKind?: string;
  /** Nome in rosso (es. ~1 mese fine storno) */
  nameAlert?: boolean;
};

export function ClientsFilterTable({
  rows,
  canDelete = false,
  showRicorrenza = false,
}: {
  rows: Row[];
  canDelete?: boolean;
  /** Mostra colonna R se il cliente ha contratti ricorrenti */
  showRicorrenza?: boolean;
}) {
  const router = useRouter();

  const columns: FilterColumn[] = [
    {
      key: "name",
      label: "Cliente",
      getValue: (r) => String(r.name ?? ""),
      render: (r) => {
        const alert = Boolean(r.nameAlert);
        const dark =
          String(r.stornoKind ?? "") === "ricorrente" ||
          String(r.rowClassName ?? "").includes("emerald-800");
        return (
          <Link
            href={`/clienti/${String(r.id)}`}
            title={String(r.stornoLabel ?? "") || undefined}
            className={
              alert
                ? "font-bold text-red-700 underline-offset-2 hover:underline"
                : dark
                  ? "font-medium text-emerald-50 underline-offset-2 hover:underline"
                  : "font-medium text-emerald-800 underline-offset-2 hover:underline"
            }
            onClick={(e) => e.stopPropagation()}
          >
            {String(r.name)}
          </Link>
        );
      },
    },
    { key: "type", label: "Tipo", getValue: (r) => String(r.type ?? "") },
  ];

  if (showRicorrenza) {
    columns.push({
      key: "ricorrenza",
      label: "Ricor.",
      getValue: (r) => String(r.ricorrenza ?? "—"),
      render: (r) => {
        const v = String(r.ricorrenza ?? "—");
        if (v === "R") {
          return (
            <span
              className="inline-flex rounded bg-teal-100 px-1.5 py-0.5 text-xs font-semibold text-teal-900"
              title="Ha almeno un contratto ricorrente (R in Provvigioni)"
            >
              R
            </span>
          );
        }
        return <span className="text-slate-400">—</span>;
      },
    });
  }

  columns.push(
    { key: "fiscalCode", label: "CF / P.IVA", getValue: (r) => String(r.fiscalCode ?? "") },
    { key: "phone", label: "Telefono", getValue: (r) => String(r.phone ?? "") },
    { key: "email", label: "Email", getValue: (r) => String(r.email ?? "") },
    { key: "city", label: "Città", getValue: (r) => String(r.city ?? "") },
    { key: "contracts", label: "Contratti", getValue: (r) => String(r.contracts ?? "") },
    { key: "createdBy", label: "Inserito da", getValue: (r) => String(r.createdBy ?? "") },
  );

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
      getRowClassName={(r) => String(r.rowClassName ?? "") || undefined}
    />
  );
}
