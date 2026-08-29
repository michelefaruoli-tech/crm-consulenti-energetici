"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

type Row = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
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
      colClassName: "max-w-[14rem]",
      getValue: (r) => String(r.name ?? ""),
      render: (r) => {
        const alert = Boolean(r.nameAlert);
        const label = String(r.name || "—");
        return (
          <Link
            href={`/clienti/${String(r.id)}`}
            title={String(r.stornoLabel ?? "") || "Apri scheda cliente"}
            className={
              alert
                ? "block truncate font-bold text-red-800 underline-offset-2 hover:underline"
                : "block truncate font-semibold text-emerald-800 underline-offset-2 hover:underline"
            }
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </Link>
        );
      },
    },
    { key: "type", label: "Tipo", getValue: (r) => String(r.type ?? ""), colClassName: "w-[4.5rem]" },
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
    {
      key: "fiscalCode",
      label: "CF / P.IVA",
      getValue: (r) => String(r.fiscalCode ?? ""),
      colClassName: "max-w-[9rem]",
    },
    {
      key: "contacts",
      label: "Contatti",
      colClassName: "max-w-[11rem] whitespace-normal",
      getValue: (r) => {
        const phone = String(r.phone ?? "").trim();
        const email = String(r.email ?? "").trim();
        return [phone, email].filter((v) => v && v !== "—").join(" ");
      },
      render: (r) => {
        const phone = String(r.phone ?? "").trim();
        const email = String(r.email ?? "").trim();
        const hasPhone = phone && phone !== "—";
        const hasEmail = email && email !== "—";
        if (!hasPhone && !hasEmail) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <div className="min-w-0 space-y-0.5 text-xs leading-tight">
            {hasPhone ? (
              <a
                href={`tel:${phone.replace(/\s/g, "")}`}
                className="block truncate text-slate-800 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {phone}
              </a>
            ) : null}
            {hasEmail ? (
              <a
                href={`mailto:${email}`}
                className="block truncate text-slate-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {email}
              </a>
            ) : null}
          </div>
        );
      },
    },
    { key: "city", label: "Città", getValue: (r) => String(r.city ?? ""), colClassName: "max-w-[8rem]" },
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
      dense
      fitWidth
    />
  );
}
