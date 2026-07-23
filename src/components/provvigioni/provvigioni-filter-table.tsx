"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { updateCommissionFieldAction } from "@/lib/commission-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

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

export function ProvvigioniFilterTable({
  rows,
  canDelete = false,
}: {
  rows: ProvvigioneRow[];
  canDelete?: boolean;
}) {
  const router = useRouter();

  async function onCellEdit(row: Record<string, unknown>, key: string, value: string) {
    const map: Record<string, string> = {
      amount: "expected",
      recurrence: "recurrence",
      paymentStatus: "paymentStatus",
      podPdr: "podPdr",
      collectionMonth: "collectionDate",
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
      sortKind: "text",
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
      sortKind: "text",
    },
    {
      key: "collaboratorName",
      label: "Collab.",
      getValue: (r) => String(r.collaboratorName ?? ""),
      sortKind: "text",
    },
    {
      key: "supplierName",
      label: "Forn.",
      getValue: (r) => String(r.supplierName ?? ""),
      sortKind: "text",
    },
    {
      key: "clientType",
      label: "Tipologia",
      getValue: (r) => String(r.clientType ?? ""),
      sortKind: "text",
      render: (r) => shortType(String(r.clientType ?? "")),
    },
    {
      key: "amount",
      label: "Gettone",
      getValue: (r) => String(r.amount ?? ""),
      editable: true,
      sortKind: "number",
    },
    {
      key: "recurrence",
      label: "Ricorrenza",
      getValue: (r) => shortRecurrence(String(r.recurrence ?? "")),
      editable: true,
      sortKind: "text",
    },
    {
      key: "paymentStatus",
      label: "Pagato",
      // No se non c'è data
      getValue: (r) => (String(r.collectionMonth ?? "").trim() ? "Sì" : "No"),
      editable: true,
      sortKind: "text",
    },
    {
      key: "collectionMonth",
      label: "Data",
      getValue: (r) => String(r.collectionMonth ?? ""),
      editable: true,
      sortKind: "date",
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
      <p className="text-xs text-slate-500">
        Pagato: <strong>Sì</strong>/<strong>No</strong> (inserisce la data). Data:{" "}
        <strong>MM/AAAA</strong>.
        {canDelete ? " Elimina rimuove il contratto (doppioni)." : ""}
      </p>
      <ExcelFilterTable
        dense
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.commissionId)}
        onCellEdit={onCellEdit}
      />
    </div>
  );
}
