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

function shortRecurrence(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("ricor")) return "Ric";
  if (v.includes("tantum") || v.includes("una")) return "UT";
  return value || "UT";
}

function shortType(value: string): string {
  if (value === "Business") return "Bus";
  if (value === "Domestico") return "Dom";
  return value;
}

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
      label: "POD/PDR",
      getValue: (r) => String(r.podPdr ?? ""),
      editable: true,
    },
    {
      key: "collaboratorName",
      label: "Collab.",
      getValue: (r) => String(r.collaboratorName ?? ""),
    },
    {
      key: "supplierName",
      label: "Forn.",
      getValue: (r) => String(r.supplierName ?? ""),
    },
    {
      key: "clientType",
      label: "Tipologia",
      getValue: (r) => String(r.clientType ?? ""),
      render: (r) => shortType(String(r.clientType ?? "")),
    },
    {
      key: "amount",
      label: "Gettone",
      getValue: (r) => String(r.amount ?? ""),
      editable: true,
    },
    {
      key: "recurrence",
      label: "Ricorrenza",
      getValue: (r) => shortRecurrence(String(r.recurrence ?? "")),
      editable: true,
    },
    {
      key: "paymentStatus",
      label: "Pagato",
      getValue: (r) => (/incass/i.test(String(r.paymentStatus ?? "")) ? "Sì" : "No"),
      editable: true,
    },
    {
      key: "confirmed",
      label: "Conf.",
      getValue: (r) => String(r.collectionMonth || r.confirmed || ""),
      render: (r) => {
        const month = String(r.collectionMonth ?? "").trim();
        const paid = /incass/i.test(String(r.paymentStatus ?? ""));
        if (paid && month) {
          return (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
              {month}
            </span>
          );
        }
        const ok = String(r.confirmed) === "Confermata";
        return (
          <span
            className={
              ok
                ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800"
                : "rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800"
            }
          >
            {ok ? "OK" : "—"}
          </span>
        );
      },
    },
  ];

  return (
    <ExcelFilterTable
      dense
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.commissionId)}
      onCellEdit={onCellEdit}
    />
  );
}
