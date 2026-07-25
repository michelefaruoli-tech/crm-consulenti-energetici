"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import {
  bulkConfirmCommissionsAction,
  bulkMarkPaidAction,
  bulkPayRecurringAction,
  confirmCommissionAction,
  updateCommissionFieldAction,
} from "@/lib/commission-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { StornoLegend } from "@/components/ui/storno-legend";
import { toPeriod, periodLabel } from "@/lib/recurring";
import { buildPageHref } from "@/lib/pagination";

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
  if (v.includes("ricor") || v.includes("mensil")) return "Ricor";
  if (v.includes("tantum") || v.includes("una") || !v.trim()) return "Gettone";
  return value;
}

function shortType(value: string): string {
  if (value === "Business") return "Bus";
  if (value === "Domestico") return "Dom";
  return value;
}

function settledOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(toPeriod(d));
  }
  return out;
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
  listQuery,
  serverSortKey = null,
  serverSortDir = "asc",
  page = 1,
  collaboratorByName,
}: {
  rows: ProvvigioneRow[];
  canDelete?: boolean;
  canConfirm?: boolean;
  /** Query da preservare quando si ordina Cliente sul database */
  listQuery?: { collab?: string | null; settled?: string | null };
  serverSortKey?: string | null;
  serverSortDir?: "asc" | "desc";
  /** Numero pagina corrente (per resettare i filtri colonna) */
  page?: number;
  /** Nome collaboratore → id (filtro colonna Collab. sul database) */
  collaboratorByName?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settleOpts = useMemo(() => settledOptions(), []);
  const [settledPeriod, setSettledPeriod] = useState(settleOpts[0] ?? toPeriod(new Date()));
  const [paidMonth, setPaidMonth] = useState(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  });

  const filterResetKey = [
    listQuery?.collab ?? "tutti",
    listQuery?.settled ?? "",
    String(page),
    serverSortKey ?? "",
    serverSortDir,
  ].join("|");

  // Cambio pagina / collaboratore: deseleziona checkbox (i filtri colonna li azzera ExcelFilterTable)
  useEffect(() => {
    setSelectedKeys(new Set());
    setMessage(null);
    setError(null);
  }, [filterResetKey]);

  function onServerSort(key: string) {
    if (key !== "clientName") return;
    const nextDir =
      serverSortKey === "client" && serverSortDir !== "desc" ? "desc" : "asc";
    router.push(
      buildPageHref("/provvigioni", {
        collab: listQuery?.collab,
        settled: listQuery?.settled,
        sort: "client",
        dir: nextDir,
      }),
    );
  }

  function onServerColumnFilter(columnKey: string, values: string[]) {
    if (columnKey !== "collaboratorName") return;
    if (values.length === 0) {
      router.push(
        buildPageHref("/provvigioni", {
          settled: listQuery?.settled,
          sort: serverSortKey === "client" ? "client" : undefined,
          dir: serverSortKey === "client" ? serverSortDir : undefined,
        }),
      );
      return;
    }
    const name = values[0];
    const id = collaboratorByName?.[name];
    if (!id) {
      setError(`Collaboratore non trovato: ${name}`);
      return;
    }
    router.push(
      buildPageHref("/provvigioni", {
        collab: id,
        settled: listQuery?.settled,
        sort: serverSortKey === "client" ? "client" : undefined,
        dir: serverSortKey === "client" ? serverSortDir : undefined,
      }),
    );
  }

  const selectedCount = selectedKeys.size;
  const selectedIds = useMemo(() => [...selectedKeys], [selectedKeys]);

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
    if (!row.commissionId) {
      setError("Questa riga non ha ancora una commissione collegata. Ricarica la pagina.");
      return;
    }

    const fd = new FormData();
    fd.set("commissionId", String(row.commissionId));
    fd.set("field", field);
    fd.set("value", value);
    await updateCommissionFieldAction(fd);
    router.refresh();
  }

  function runBulk(
    label: string,
    fn: () => Promise<{
      ok: true;
      count?: number;
      monthsPaid?: number;
      contracts?: number;
    }>,
  ) {
    if (selectedCount === 0) {
      setError("Seleziona almeno una riga (checkbox a sinistra).");
      return;
    }
    if (!window.confirm(`${label}\n\nRighe selezionate: ${selectedCount}. Continuare?`)) {
      return;
    }
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        const result = await fn();
        setSelectedKeys(new Set());
        const extra =
          result.monthsPaid != null
            ? ` · ${result.monthsPaid} mesi competenza · ${result.contracts ?? 0} contratti`
            : result.count != null
              ? ` · ${result.count} contratti`
              : "";
        setMessage(`${label} — ok${extra}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore azione multipla");
      }
    });
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
      label: "Tipo",
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
                ok ? "font-medium text-emerald-800" : "font-medium text-amber-900"
              }
            >
              {ok ? "OK" : "Da conf."}
            </span>
            {canConfirm && !ok && String(r.commissionId) ? (
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
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="text-xs font-medium text-slate-800">
          Azioni multiple {selectedCount > 0 ? `(${selectedCount} selezionate)` : ""}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Spunta le righe (o l’intestazione per tutta la pagina filtrata), poi scegli
          un’azione. Max 200 per volta.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-slate-600">
            Data pagato (Gettone)
            <input
              className="mt-0.5 block w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={paidMonth}
              onChange={(e) => setPaidMonth(e.target.value)}
              placeholder="MM/AAAA"
              title="Usata per «Segna pagato» (una tantum / riepilogo)"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={() =>
              runBulk("Segna pagato", async () => {
                const fd = new FormData();
                fd.set("commissionIds", selectedIds.join(","));
                fd.set("collectionMonth", paidMonth);
                return bulkMarkPaidAction(fd);
              })
            }
          >
            Segna pagato
          </button>

          {canConfirm ? (
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              onClick={() =>
                runBulk("Conferma gettoni", async () => {
                  const fd = new FormData();
                  fd.set("commissionIds", selectedIds.join(","));
                  return bulkConfirmCommissionsAction(fd);
                })
              }
            >
              Conferma gettone
            </button>
          ) : null}

          <label className="text-[11px] text-slate-600">
            Rendiconto ricorrenze
            <select
              className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={settledPeriod}
              onChange={(e) => setSettledPeriod(e.target.value)}
            >
              {settleOpts.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            title="Per ogni contratto ricorrente: paga il mese competenza MISSING più vecchio"
            onClick={() =>
              runBulk(
                `Ricorrenze: 1 mese mancante → rendiconto ${periodLabel(settledPeriod)}`,
                async () => {
                  const fd = new FormData();
                  fd.set("commissionIds", selectedIds.join(","));
                  fd.set("settledPeriod", settledPeriod);
                  fd.set("mode", "oldest");
                  return bulkPayRecurringAction(fd);
                },
              )
            }
          >
            Paga 1 mese ric.
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-950 disabled:opacity-50"
            title="Paga TUTTI i mesi MISSING dei selezionati con lo stesso rendiconto"
            onClick={() =>
              runBulk(
                `Ricorrenze: TUTTI i mesi mancanti → rendiconto ${periodLabel(settledPeriod)}`,
                async () => {
                  const fd = new FormData();
                  fd.set("commissionIds", selectedIds.join(","));
                  fd.set("settledPeriod", settledPeriod);
                  fd.set("mode", "all");
                  return bulkPayRecurringAction(fd);
                },
              )
            }
          >
            Paga tutti mesi ric.
          </button>

          {selectedCount > 0 ? (
            <button
              type="button"
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-300"
              onClick={() => setSelectedKeys(new Set())}
            >
              Deseleziona
            </button>
          ) : null}
        </div>

        {pending ? <p className="mt-2 text-xs text-slate-500">Elaborazione…</p> : null}
        {message ? <p className="mt-2 text-xs text-emerald-800">{message}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>

      <p className="text-xs text-slate-500">
        Pagato: <strong>Sì</strong>/<strong>No</strong>. Data: <strong>MM/AAAA</strong>.
        Bordo sinistro = stato gettone (ambra / verde).
        {canDelete ? " Elimina rimuove il contratto (doppioni)." : ""}
      </p>
      <ExcelFilterTable
        dense
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.commissionId || r.id)}
        onCellEdit={onCellEdit}
        selection={{ selectedKeys, onChange: setSelectedKeys }}
        resetKey={filterResetKey}
        serverSort={{
          keys: ["clientName"],
          key: serverSortKey === "client" ? "clientName" : null,
          dir: serverSortDir,
          onSort: onServerSort,
        }}
        serverColumnFilter={
          collaboratorByName
            ? {
                keys: ["collaboratorName"],
                onFilter: onServerColumnFilter,
              }
            : undefined
        }
        filterOptionsOverride={
          collaboratorByName
            ? { collaboratorName: Object.keys(collaboratorByName) }
            : undefined
        }
        getRowClassName={(r) => {
          const storno = String(r.stornoRowClass ?? "");
          const border = String(r.gettoneBorderClass ?? "");
          return [storno, border].filter(Boolean).join(" ") || undefined;
        }}
      />
      <StornoLegend />
      <p className="text-xs text-slate-500">
        Gettone: bordo ambra = da confermare · bordo verde = confermato
        {canConfirm ? " · Admin: usa «Conferma» o azione multipla." : ""}
      </p>
    </div>
  );
}
