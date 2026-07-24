"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import {
  confirmCommissionAction,
  updateCommissionFieldAction,
} from "@/lib/commission-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { StornoLegend } from "@/components/ui/storno-legend";

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
  stornoLabel?: string;
  stornoRowClass?: string;
  warnOnEdit?: boolean;
  gettoneBorderClass?: string;
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

function ConfirmButton({ commissionId }: { commissionId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-800"
      title="Conferma gettone (passa a verde)"
      onClick={async (e) => {
        e.stopPropagation();
        const fd = new FormData();
        fd.set("commissionId", commissionId);
        await confirmCommissionAction(fd);
        router.refresh();
      }}
    >
      Conferma
    </button>
  );
}

export function ProvvigioniFilterTable({
  rows,
  canDelete = false,
  canConfirm = false,
}: {
  rows: ProvvigioneRow[];
  canDelete?: boolean;
  canConfirm?: boolean;
}) {
  const router = useRouter();

  async function onCellEdit(row: Record<string, unknown>, key: string, value: string) {
    if (row.warnOnEdit) {
      const ok = window.confirm(
        "Attenzione: questo contratto NON è fuori storno.\n\n" +
          "Confermi di voler modificare comunque?",
      );
      if (!ok) {
        router.refresh();
        return;
      }
    }

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
      label: "POD / PDR",
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
    {
      key: "stornoLabel",
      label: "Storno",
      getValue: (r) => String(r.stornoLabel ?? ""),
      sortKind: "text",
    },
    {
      key: "confirmed",
      label: "Gettone",
      getValue: (r) => String(r.confirmed ?? ""),
      sortKind: "text",
      render: (r) => {
        const ok = String(r.confirmed) === "Confermata";
        return (
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={
                ok
                  ? "font-medium text-emerald-800"
                  : "font-medium text-amber-900"
              }
            >
              {ok ? "OK" : "Da conf."}
            </span>
            {canConfirm && !ok ? (
              <ConfirmButton commissionId={String(r.commissionId)} />
            ) : null}
          </div>
        );
      },
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
        Pagato: <strong>Sì</strong>/<strong>No</strong>. Data: <strong>MM/AAAA</strong>.
        Bordo sinistro = stato gettone (ambra / verde).
        {canDelete ? " Elimina rimuove il contratto (doppioni)." : ""}
      </p>
      <ExcelFilterTable
        dense
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.commissionId)}
        onCellEdit={onCellEdit}
        getRowClassName={(r) => {
          const storno = String(r.stornoRowClass ?? "");
          const border = String(r.gettoneBorderClass ?? "");
          return [storno, border].filter(Boolean).join(" ") || undefined;
        }}
      />
      <StornoLegend />
      <p className="text-xs text-slate-500">
        Gettone: bordo ambra = da confermare · bordo verde = confermato
        {canConfirm ? " · Admin: usa «Conferma»." : ""}
      </p>
    </div>
  );
}
