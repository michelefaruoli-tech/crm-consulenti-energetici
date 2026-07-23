"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { updateCommissionFieldAction } from "@/lib/commission-actions";

export type ProvvigioneRow = {
  id: string;
  clientId: string;
  commissionId: string;
  clientName: string;
  podPdr: string;
  collaboratorName: string;
  supplierName: string;
  clientType: string;
  amount: string;
  recurrence: string;
  paymentStatus: string;
  confirmed: string;
  collectionMonth: string;
};

export function ProvvigioniFilterTable({ rows }: { rows: ProvvigioneRow[] }) {
  const router = useRouter();

  async function onCellEdit(row: Record<string, unknown>, key: string, value: string) {
    const map: Record<string, string> = {
      amount: "expected",
      recurrence: "recurrence",
      paymentStatus: "paymentStatus",
      podPdr: "podPdr",
    };
    const field = map[key];
    if (!field) return;

    const fd = new FormData();
    fd.set("commissionId", String(row.commissionId));
    fd.set("field", field);
    fd.set("value", value);
    await updateCommissionFieldAction(fd);
    router.refresh();
  }

  const columns: FilterColumn[] = [
    {
      key: "clientName",
      label: "Cliente",
      getValue: (r) => String(r.clientName ?? ""),
      render: (r) => (
        <Link
          href={`/clienti/${String(r.clientId)}`}
          className="font-medium text-emerald-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(r.clientName)}
        </Link>
      ),
    },
    {
      key: "podPdr",
      label: "POD / PDR",
      getValue: (r) => String(r.podPdr ?? ""),
      editable: true,
    },
    {
      key: "collaboratorName",
      label: "Collaboratore",
      getValue: (r) => String(r.collaboratorName ?? ""),
    },
    {
      key: "supplierName",
      label: "Fornitore",
      getValue: (r) => String(r.supplierName ?? ""),
    },
    {
      key: "clientType",
      label: "Tipo (Domestico/Business)",
      getValue: (r) => String(r.clientType ?? ""),
    },
    {
      key: "amount",
      label: "Valore gettone",
      getValue: (r) => String(r.amount ?? ""),
      editable: true,
    },
    {
      key: "recurrence",
      label: "Una tantum / Ricorrente",
      getValue: (r) => String(r.recurrence ?? ""),
      editable: true,
    },
    {
      key: "paymentStatus",
      label: "Pagato / Non pagato",
      getValue: (r) => String(r.paymentStatus ?? ""),
      editable: true,
    },
    {
      key: "confirmed",
      label: "Conferma",
      getValue: (r) => String(r.confirmed ?? ""),
      render: (r) => {
        const ok = String(r.confirmed) === "Confermata";
        const month = String(r.collectionMonth ?? "");
        const paid = /incass/i.test(String(r.paymentStatus ?? ""));
        return (
          <div className="flex flex-col gap-0.5">
            <span
              className={
                ok
                  ? "w-fit rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                  : "w-fit rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              }
            >
              {ok ? "Verde" : "Gialla"}
            </span>
            {paid && month ? (
              <span className="text-xs font-medium text-emerald-700">{month}</span>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <ExcelFilterTable
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.commissionId)}
      onCellEdit={onCellEdit}
    />
  );
}
