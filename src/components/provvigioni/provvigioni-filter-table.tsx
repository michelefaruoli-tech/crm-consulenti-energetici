"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import {
  bulkConfirmCommissionsAction,
  bulkMarkPaidAction,
  bulkPayRecurringAction,
  bulkUpdateCommissionFieldsAction,
} from "@/lib/commission-actions";
import { bulkDeleteContractsAction } from "@/lib/delete-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { StornoLegend } from "@/components/ui/storno-legend";
import { toPeriod, periodLabel } from "@/lib/recurring";
import { buildPageHref } from "@/lib/pagination";
import {
  PROVVIGIONE_OPERATION_OPTIONS,
  PROVVIGIONE_STATO_OPTIONS,
  formatCollaboratorShort,
  type ProvvigioneRow,
} from "@/lib/provvigioni-stato";

export type { ProvvigioneRow };

/** Chiave colonna UI → campo server */
const FIELD_MAP: Record<string, string> = {
  clientName: "clientName",
  podPdr: "podPdr",
  collaboratorName: "collaboratorName",
  supplierName: "supplierName",
  clientType: "clientType",
  amount: "expected",
  operationType: "operationType",
  stato: "stato",
  recurrence: "recurrence",
  collectionMonth: "collectionDate",
  stornoFlag: "storno",
  stornoMonth: "stornoDate",
  stornoAmount: "stornoAmount",
  notes: "notes",
};

function shortRecurrence(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === "r" || v.includes("ricor") || v.includes("mensil")) return "R";
  // G = Gettone / una tantum
  return "G";
}

function shortClientType(value: string): string {
  const v = value.toLowerCase();
  if (v.startsWith("bus") || v.includes("azi") || v === "b") return "Bus";
  return "Dom";
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

function rowId(row: { commissionId?: string; id?: string } | Record<string, unknown>) {
  return String(row.commissionId || row.id || "");
}

function originalCellValue(row: ProvvigioneRow, key: string): string {
  switch (key) {
    case "clientName":
      return row.clientName ?? "";
    case "podPdr":
      return row.podPdr ?? "";
    case "collaboratorName":
      return row.collaboratorName ?? "";
    case "supplierName":
      return row.supplierName ?? "";
    case "clientType":
      return shortClientType(row.clientType ?? "");
    case "amount":
      return row.amount ?? "";
    case "operationType":
      return row.operationType ?? "";
    case "stato":
      return row.stato ?? "";
    case "recurrence":
      return shortRecurrence(row.recurrence ?? "");
    case "collectionMonth":
      return row.collectionMonth ?? "";
    case "stornoFlag":
      return row.stornoFlag ?? "No";
    case "stornoMonth":
      return row.stornoMonth ?? "";
    case "stornoAmount":
      return row.stornoAmount ?? "";
    case "notes":
      return row.notes ?? "";
    default:
      return "";
  }
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
  supplierNames,
}: {
  rows: ProvvigioneRow[];
  canDelete?: boolean;
  canConfirm?: boolean;
  listQuery?: {
    collab?: string | null;
    settled?: string | null;
    supplier?: string | null;
    stato?: string | null;
    tipologia?: string | null;
    q?: string | null;
    vista?: string | null;
  };
  serverSortKey?: string | null;
  serverSortDir?: "asc" | "desc";
  page?: number;
  collaboratorByName?: Record<string, string>;
  /** Nomi fornitori (per modifica colonna Forn. e filtro server) */
  supplierNames?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bozze: rowId → { colonna → valore } */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const settleOpts = useMemo(() => settledOptions(), []);
  const [settledPeriod, setSettledPeriod] = useState(settleOpts[0] ?? toPeriod(new Date()));
  const [paidMonth, setPaidMonth] = useState(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  });

  const filterResetKey = [
    listQuery?.collab ?? "tutti",
    listQuery?.settled ?? "",
    listQuery?.supplier ?? "",
    listQuery?.stato ?? "",
    listQuery?.tipologia ?? "",
    listQuery?.q ?? "",
    listQuery?.vista ?? "gettoni",
    String(page),
    serverSortKey ?? "",
    serverSortDir,
  ].join("|");

  useEffect(() => {
    setSelectedKeys(new Set());
    setDrafts({});
    setMessage(null);
    setError(null);
  }, [filterResetKey]);

  const draftCount = useMemo(() => {
    let n = 0;
    for (const cells of Object.values(drafts)) n += Object.keys(cells).length;
    return n;
  }, [drafts]);

  function baseQuery(extra: Record<string, string | undefined | null> = {}) {
    return {
      collab: listQuery?.collab,
      settled: listQuery?.settled,
      supplier: listQuery?.supplier,
      stato: listQuery?.stato,
      tipologia: listQuery?.tipologia,
      q: listQuery?.q,
      vista: listQuery?.vista,
      sort: serverSortKey === "client" ? "client" : undefined,
      dir: serverSortKey === "client" ? serverSortDir : undefined,
      ...extra,
    };
  }

  function confirmLeaveDrafts(): boolean {
    if (draftCount <= 0) return true;
    return window.confirm(
      `Hai ${draftCount} modifiche non salvate. Continuando le perdi. Procedere?`,
    );
  }

  function onServerSort(key: string) {
    if (key !== "clientName") return;
    if (!confirmLeaveDrafts()) return;
    const nextDir =
      serverSortKey === "client" && serverSortDir !== "desc" ? "desc" : "asc";
    router.push(
      buildPageHref("/provvigioni", {
        ...baseQuery(),
        sort: "client",
        dir: nextDir,
      }),
    );
  }

  function onServerColumnFilter(columnKey: string, values: string[]) {
    if (!confirmLeaveDrafts()) return;

    const value = values[0] ?? "";

    if (columnKey === "collaboratorName") {
      if (values.length === 0) {
        router.push(buildPageHref("/provvigioni", baseQuery({ collab: null })));
        return;
      }
      const id = collaboratorByName?.[value];
      if (!id) {
        setError(`Collaboratore non trovato: ${value}`);
        return;
      }
      router.push(buildPageHref("/provvigioni", baseQuery({ collab: id })));
      return;
    }

    if (columnKey === "supplierName") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({ supplier: values.length ? value : null }),
        }),
      );
      return;
    }

    if (columnKey === "stato") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({ stato: values.length ? value : null }),
        }),
      );
      return;
    }

    if (columnKey === "clientType") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({ tipologia: values.length ? value : null }),
        }),
      );
      return;
    }
  }

  const selectedCount = selectedKeys.size;
  const selectedIds = useMemo(() => [...selectedKeys], [selectedKeys]);
  const selectedContractIds = useMemo(
    () =>
      rows
        .filter((r) => selectedKeys.has(String(r.commissionId || r.id)))
        .map((r) => r.id),
    [rows, selectedKeys],
  );

  const displayRows = useMemo(() => {
    return rows.map((r) => {
      const id = rowId(r);
      const d = drafts[id];
      if (!d) return r;
      return { ...r, ...d } as ProvvigioneRow;
    });
  }, [rows, drafts]);

  function queueDraft(row: Record<string, unknown>, key: string, value: string) {
    const id = rowId(row);
    if (!id) return;
    const base = rows.find((r) => rowId(r) === id);
    const original = base ? originalCellValue(base, key) : "";
    setDrafts((prev) => {
      const nextRow = { ...(prev[id] ?? {}) };
      if (value === original) {
        delete nextRow[key];
      } else {
        nextRow[key] = value;
      }
      const next = { ...prev };
      if (Object.keys(nextRow).length === 0) delete next[id];
      else next[id] = nextRow;
      return next;
    });
    setError(null);
  }

  function getDraftValue(row: Record<string, unknown>, key: string): string {
    const id = rowId(row);
    const drafted = drafts[id]?.[key];
    if (drafted != null) return drafted;
    const base = rows.find((r) => rowId(r) === id);
    return base ? originalCellValue(base, key) : String(row[key] ?? "");
  }

  function isDraftDirty(row: Record<string, unknown>, key: string): boolean {
    const id = rowId(row);
    return Boolean(drafts[id] && key in drafts[id]);
  }

  function discardDrafts() {
    if (draftCount === 0) return;
    if (!window.confirm(`Annullare ${draftCount} modifiche non salvate?`)) return;
    setDrafts({});
    setMessage("Bozze annullate");
  }

  function saveAllDrafts() {
    if (draftCount === 0) {
      setError("Nessuna modifica in bozza da salvare.");
      return;
    }
    if (
      !window.confirm(
        `Salvare ${draftCount} modifiche insieme?\n\nLe celle gialle verranno scritte nel database.`,
      )
    ) {
      return;
    }

    const changes: Array<{ commissionId: string; field: string; value: string }> = [];
    for (const [id, cells] of Object.entries(drafts)) {
      for (const [colKey, value] of Object.entries(cells)) {
        const field = FIELD_MAP[colKey];
        if (!field) continue;
        changes.push({ commissionId: id, field, value });
      }
    }

    setError(null);
    setMessage(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("changes", JSON.stringify(changes));
        const res = await bulkUpdateCommissionFieldsAction(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDrafts({});
        setMessage(`Salvate ${res.count} modifiche`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore salvataggio");
      }
    });
  }

  function runBulk(
    label: string,
    fn: () => Promise<
      | {
          ok: true;
          count?: number;
          monthsPaid?: number;
          contracts?: number;
        }
      | { ok: false; error: string }
    >,
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
        if (!result.ok) {
          setError(result.error);
          return;
        }
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
      editable: true,
      sortKind: "text",
      inputClassName:
        "min-w-[11rem] text-[13px] font-semibold tracking-tight text-slate-900",
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
      render: (r) => {
        const full = getDraftValue(r, "collaboratorName");
        const dirty = isDraftDirty(r, "collaboratorName");
        if (!collaboratorByName) {
          return (
            <span className="whitespace-nowrap text-[11px] text-slate-700">
              {formatCollaboratorShort(full)}
            </span>
          );
        }
        const names = Object.keys(collaboratorByName);
        return (
          <select
            className={`max-w-[7.5rem] rounded border px-0.5 py-0.5 text-[11px] ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={full}
            title={full}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => queueDraft(r, "collaboratorName", e.target.value)}
          >
            {names.map((n) => (
              <option key={n} value={n}>
                {formatCollaboratorShort(n)}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "supplierName",
      label: "Forn.",
      getValue: (r) => String(r.supplierName ?? ""),
      editable: Boolean(supplierNames?.length),
      sortKind: "text",
    },
    {
      key: "clientType",
      label: "Tip.",
      getValue: (r) => shortClientType(String(r.clientType ?? "")),
      editable: true,
      sortKind: "text",
      inputClassName: "max-w-[3rem] text-center",
    },
    {
      key: "amount",
      label: "Gettone",
      getValue: (r) => String(r.amount ?? ""),
      editable: true,
      sortKind: "number",
      inputClassName: "max-w-[4.5rem] text-right tabular-nums",
    },
    {
      key: "operationType",
      label: "Tipo op.",
      getValue: (r) => getDraftValue(r, "operationType"),
      sortKind: "text",
      render: (r) => {
        const current = getDraftValue(r, "operationType") || "Switch";
        const options = [...PROVVIGIONE_OPERATION_OPTIONS];
        const dirty = isDraftDirty(r, "operationType");
        const value = options.includes(
          current as (typeof options)[number],
        )
          ? current
          : current;
        return (
          <select
            className={`max-w-[9.5rem] rounded border px-1 py-0.5 text-[11px] ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={value}
            title="Tipo operazione: Switch, Voltura, Cessazione…"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => queueDraft(r, "operationType", e.target.value)}
          >
            {!options.includes(current as (typeof options)[number]) && current ? (
              <option value={current}>{current}</option>
            ) : null}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "stato",
      label: "Stato",
      getValue: (r) => getDraftValue(r, "stato"),
      sortKind: "text",
      render: (r) => {
        const current = getDraftValue(r, "stato") || "Da incassare";
        const options = [...PROVVIGIONE_STATO_OPTIONS];
        const dirty = isDraftDirty(r, "stato");
        return (
          <select
            className={`max-w-[9.5rem] rounded border px-1 py-0.5 text-[11px] ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={
              options.includes(current as (typeof options)[number])
                ? current
                : "Da incassare"
            }
            title="Bozza: cambia e poi Salva tutte"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => queueDraft(r, "stato", e.target.value)}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "recurrence",
      label: "R/G",
      getValue: (r) => shortRecurrence(String(r.recurrence ?? "")),
      editable: true,
      sortKind: "text",
      inputClassName: "max-w-[2.5rem] text-center font-semibold",
    },
    {
      key: "collectionMonth",
      label: "Data",
      getValue: (r) => String(r.collectionMonth ?? ""),
      editable: true,
      sortKind: "date",
    },
    {
      key: "stornoFlag",
      label: "Storno",
      getValue: (r) => getDraftValue(r, "stornoFlag"),
      sortKind: "text",
      render: (r) => {
        const current = getDraftValue(r, "stornoFlag") || "No";
        const dirty = isDraftDirty(r, "stornoFlag");
        return (
          <select
            className={`max-w-[4.5rem] rounded border px-1 py-0.5 text-[11px] ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={current === "Sì" ? "Sì" : "No"}
            title="Segna storno gettone (importo = gettone incassato)"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value;
              queueDraft(r, "stornoFlag", v);
              if (v === "Sì") {
                const amount = String(r.amount ?? "").trim();
                if (amount && !getDraftValue(r, "stornoAmount")) {
                  queueDraft(r, "stornoAmount", amount);
                }
                if (!getDraftValue(r, "stornoMonth")) {
                  const d = new Date();
                  queueDraft(
                    r,
                    "stornoMonth",
                    `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
                  );
                }
              } else {
                queueDraft(r, "stornoMonth", "");
                queueDraft(r, "stornoAmount", "");
              }
            }}
          >
            <option value="No">No</option>
            <option value="Sì">Sì</option>
          </select>
        );
      },
    },
    {
      key: "stornoMonth",
      label: "Data storno",
      getValue: (r) => getDraftValue(r, "stornoMonth"),
      editable: true,
      sortKind: "date",
    },
    {
      key: "stornoAmount",
      label: "Gettone storno",
      getValue: (r) => getDraftValue(r, "stornoAmount"),
      editable: true,
      sortKind: "number",
    },
    {
      key: "notes",
      label: "Note",
      getValue: (r) => String(r.notes ?? ""),
      editable: true,
      sortKind: "text",
    },
  ];

  if (canDelete) {
    columns.push({
      key: "_del",
      label: "",
      getValue: () => "",
      render: (r) => (
        <DeleteRowButton kind="contract" id={String(r.id)} compact />
      ),
    });
  }

  return (
    <div className="space-y-2">
      {draftCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            <strong>{draftCount}</strong> modifiche in bozza (celle gialle). Non ancora
            salvate nel database.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              onClick={saveAllDrafts}
            >
              Salva tutte le modifiche
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              onClick={discardDrafts}
            >
              Annulla bozze
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="text-xs font-medium text-slate-800">
          Azioni multiple {selectedCount > 0 ? `(${selectedCount} selezionate)` : ""}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Modifica le celle liberamente (restano in bozza gialla), poi{" "}
          <strong>Salva tutte le modifiche</strong>. Oppure spunta le righe per azioni
          rapide. Max 200 per azioni multiple / 500 celle per salvataggio bozze.
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

          {canDelete ? (
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              title="Archivia (soft delete) tutti i contratti selezionati"
              onClick={() =>
                runBulk(
                  "Elimina le righe selezionate\n\nI contratti vengono archiviati e spariscono da Provvigioni (come Elimina singolo).",
                  async () => {
                    const fd = new FormData();
                    fd.set("contractIds", selectedContractIds.join(","));
                    const res = await bulkDeleteContractsAction(fd);
                    if (!res.ok) return res;
                    return { ok: true as const, count: res.count };
                  },
                )
              }
            >
              Elimina selezionate
            </button>
          ) : null}

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
        Celle modificabili = bozza (giallo) finché non salvi. Usa le frecce{" "}
        <strong>← →</strong> sotto la tabella per scorrere.{" "}
        <strong>Gettone</strong>: valore in € (modificabile in bozza).{" "}
        <strong>R/G</strong>: R = ricorrente (entra in Clienti → A ricorrenza) · G =
        gettone una tantum. <strong>Tip.</strong>: Dom / Bus.{" "}
        <strong>Stato</strong>: KO/Cessato · Da incassare · Incassato.{" "}
        <strong>Storno</strong> + data + importo. Fornitore / Stato / Tip. filtrano
        su tutto il database. Privati: Dolomiti 45 · Plenitude 60 · Enel 65.
        {canDelete ? " × rossa = elimina." : ""}
      </p>
      <ExcelFilterTable
        dense
        rows={displayRows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.commissionId || r.id)}
        draftMode
        getDraftValue={getDraftValue}
        isDraftDirty={isDraftDirty}
        onCellDraft={queueDraft}
        selection={{ selectedKeys, onChange: setSelectedKeys }}
        resetKey={filterResetKey}
        serverSort={{
          keys: ["clientName"],
          key: serverSortKey === "client" ? "clientName" : null,
          dir: serverSortDir,
          onSort: onServerSort,
        }}
        serverColumnFilter={{
          keys: [
            ...(collaboratorByName ? (["collaboratorName"] as const) : []),
            "supplierName",
            "stato",
            "clientType",
          ],
          onFilter: onServerColumnFilter,
          activeValues: {
            ...(listQuery?.collab && collaboratorByName
              ? {
                  collaboratorName: [
                    Object.entries(collaboratorByName).find(
                      ([, id]) => id === listQuery.collab,
                    )?.[0] ?? "",
                  ].filter(Boolean),
                }
              : {}),
            ...(listQuery?.supplier
              ? { supplierName: [listQuery.supplier] }
              : {}),
            ...(listQuery?.stato ? { stato: [listQuery.stato] } : {}),
            ...(listQuery?.tipologia
              ? { clientType: [listQuery.tipologia] }
              : {}),
          },
        }}
        filterOptionsOverride={{
          ...(collaboratorByName
            ? { collaboratorName: Object.keys(collaboratorByName) }
            : {}),
          ...(supplierNames?.length ? { supplierName: supplierNames } : {}),
          stato: [...PROVVIGIONE_STATO_OPTIONS],
          clientType: ["Business", "Domestico"],
          operationType: [...PROVVIGIONE_OPERATION_OPTIONS],
        }}
        getRowClassName={(r) => {
          const storno = String(r.stornoRowClass ?? "");
          const border = String(r.gettoneBorderClass ?? "");
          return [storno, border].filter(Boolean).join(" ") || undefined;
        }}
      />
      <StornoLegend />
      <p className="text-xs text-slate-500">
        Gettone: bordo ambra = da confermare · bordo verde = confermato
        {canConfirm ? " · Admin: usa «Conferma gettone» nelle azioni multiple." : ""}
      </p>
    </div>
  );
}
