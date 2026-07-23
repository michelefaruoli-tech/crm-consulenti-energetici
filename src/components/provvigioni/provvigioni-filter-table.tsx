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
      label: "POD / PDR (codice completo)",
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
      getValue: (r) => String(r.collectionMonth || r.confirmed || ""),
      render: (r) => {
        const month = String(r.collectionMonth ?? "").trim();
        const paid = /incass/i.test(String(r.paymentStatus ?? ""));
        // Se incassato: solo mese/anno verde. La gialla sparisce.
        if (paid && month) {
          return (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              {month}
            </span>
          );
        }
        const ok = String(r.confirmed) === "Confermata";
        return (
          <span
            className={
              ok
                ? "w-fit rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                : "w-fit rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
            }
          >
            {ok ? "Verde" : "Gialla"}
          </span>
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
