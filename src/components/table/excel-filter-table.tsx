"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type FilterColumn = {
  key: string;
  label: string;
  /** valore grezzo per filtri (string) */
  getValue: (row: Record<string, unknown>) => string;
  /** contenuto cella renderizzato */
  render?: (row: Record<string, unknown>) => React.ReactNode;
  /** se true, la cella è editabile inline (callback onEdit) */
  editable?: boolean;
  /** tipo ordinamento: testo A-Z, data, numero */
  sortKind?: "text" | "date" | "number";
};

type Props = {
  rows: Record<string, unknown>[];
  columns: FilterColumn[];
  rowKey: (row: Record<string, unknown>) => string;
  onRowClick?: (row: Record<string, unknown>) => void;
  onCellEdit?: (row: Record<string, unknown>, key: string, value: string) => void | Promise<void>;
  emptyMessage?: string;
  /** Celle più compatte per stare in una schermata */
  dense?: boolean;
  /** Classi CSS aggiuntive per riga (es. colori stato) */
  getRowClassName?: (row: Record<string, unknown>) => string | undefined;
  /** Selezione multipla (checkbox) */
  selection?: {
    selectedKeys: Set<string>;
    onChange: (next: Set<string>) => void;
  };
};

export function ExcelFilterTable({
  rows,
  columns,
  rowKey,
  onRowClick,
  onCellEdit,
  emptyMessage = "Nessun risultato",
  dense = false,
  getRowClassName,
  selection,
}: Props) {
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const optionsByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      const set = new Set<string>();
      for (const row of rows) {
        const v = col.getValue(row) || "(vuoto)";
        set.add(v);
      }
      map[col.key] = [...set].sort((a, b) => a.localeCompare(b, "it"));
    }
    return map;
  }, [rows, columns]);

  function sortValue(col: FilterColumn, row: Record<string, unknown>): string | number {
    const raw = col.getValue(row) || "";
    if (col.sortKind === "number") {
      const n = Number(String(raw).replace(",", ".").replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    if (col.sortKind === "date") {
      // MM/AAAA oppure GG/MM/AAAA
      const my = raw.match(/^(\d{1,2})[/.-](\d{4})$/);
      if (my) return Number(my[2]) * 100 + Number(my[1]);
      const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
      const t = Date.parse(raw);
      return Number.isNaN(t) ? 0 : t;
    }
    return raw.toLowerCase();
  }

  const filtered = useMemo(() => {
    let list = rows.filter((row) =>
      columns.every((col) => {
        const sel = selected[col.key];
        if (!sel || sel.size === 0) return true;
        const v = col.getValue(row) || "(vuoto)";
        return sel.has(v);
      }),
    );

    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        list = [...list].sort((a, b) => {
          const av = sortValue(col, a);
          const bv = sortValue(col, b);
          let cmp = 0;
          if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
          else cmp = String(av).localeCompare(String(bv), "it", { numeric: true });
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [rows, columns, selected, sortKey, sortDir]);

  function toggleValue(colKey: string, value: string) {
    setSelected((prev) => {
      const current = new Set(prev[colKey] ?? []);
      if (current.has(value)) current.delete(value);
      else current.add(value);
      return { ...prev, [colKey]: current };
    });
  }

  function selectAll(colKey: string) {
    setSelected((prev) => ({
      ...prev,
      [colKey]: new Set(optionsByColumn[colKey] ?? []),
    }));
  }

  function clearCol(colKey: string) {
    setSelected((prev) => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }

  function clearAllFilters() {
    setSelected({});
  }

  const hasAnyFilter = Object.values(selected).some((s) => s && s.size > 0);

  function toggleSort(colKey: string) {
    if (sortKey === colKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colKey);
      setSortDir("asc");
    }
  }

  const filteredKeys = useMemo(() => filtered.map((r) => rowKey(r)), [filtered, rowKey]);
  const allFilteredSelected =
    Boolean(selection) &&
    filteredKeys.length > 0 &&
    filteredKeys.every((k) => selection!.selectedKeys.has(k));
  const someFilteredSelected =
    Boolean(selection) && filteredKeys.some((k) => selection!.selectedKeys.has(k));

  function toggleSelectAllFiltered() {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (allFilteredSelected) {
      for (const k of filteredKeys) next.delete(k);
    } else {
      for (const k of filteredKeys) next.add(k);
    }
    selection.onChange(next);
  }

  function toggleOne(key: string) {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  }

  const colSpan = columns.length + (selection ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {hasAnyFilter ? (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <span>
            Filtri attivi: vedi {filtered.length} di {rows.length} righe. Se mancano
            collaboratori, probabilmente hai filtrato la colonna Collaboratore.
          </span>
          <button
            type="button"
            className="rounded bg-amber-800 px-2 py-1 font-medium text-white hover:bg-amber-900"
            onClick={clearAllFilters}
          >
            Azzera filtri
          </button>
        </div>
      ) : null}
      <table className={cn("w-full text-left", dense ? "min-w-0 text-xs" : "min-w-full text-sm")}>
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {selection ? (
              <th className={cn("align-middle", dense ? "px-1.5 py-1.5" : "px-3 py-2")}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                  }}
                  onChange={toggleSelectAllFiltered}
                  title="Seleziona / deseleziona tutte le righe visibili"
                  aria-label="Seleziona tutte"
                />
              </th>
            ) : null}
            {columns.map((col) => {
              const active = (selected[col.key]?.size ?? 0) > 0;
              return (
                <th
                  key={col.key}
                  className={cn(
                    "relative align-bottom whitespace-nowrap",
                    dense ? "px-1.5 py-1.5" : "px-3 py-2",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="font-medium hover:text-slate-900"
                      onClick={() => toggleSort(col.key)}
                      title={
                        col.sortKind === "date"
                          ? "Ordina per data"
                          : "Ordina A→Z / Z→A"
                      }
                    >
                      {col.label}
                      {sortKey === col.key
                        ? sortDir === "asc"
                          ? col.sortKind === "date"
                            ? " ↑"
                            : " A↑"
                          : col.sortKind === "date"
                            ? " ↓"
                            : " Z↓"
                        : ""}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-1 text-xs",
                        active ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700",
                      )}
                      onClick={() =>
                        setOpenFilter((k) => (k === col.key ? null : col.key))
                      }
                      title="Filtro"
                    >
                      ▾
                    </button>
                  </div>
                  {openFilter === col.key ? (
                    <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                      <div className="mb-2 flex gap-2 text-xs">
                        <button
                          type="button"
                          className="text-emerald-700"
                          onClick={() => selectAll(col.key)}
                        >
                          Tutti
                        </button>
                        <button
                          type="button"
                          className="text-slate-500"
                          onClick={() => clearCol(col.key)}
                        >
                          Nessuno
                        </button>
                      </div>
                      {(optionsByColumn[col.key] ?? []).map((opt) => {
                        const isActive = (selected[col.key]?.size ?? 0) > 0;
                        return (
                          <label
                            key={opt}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={isActive ? selected[col.key].has(opt) : true}
                              onChange={() => {
                                if (!isActive) {
                                  setSelected((prev) => ({
                                    ...prev,
                                    [col.key]: new Set([opt]),
                                  }));
                                } else {
                                  toggleValue(col.key, opt);
                                }
                              }}
                            />
                            <span className="truncate">{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-8 text-center text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            filtered.map((row) => {
              const key = rowKey(row);
              return (
              <tr
                key={key}
                className={cn(
                  "border-t border-slate-100",
                  onRowClick && "cursor-pointer hover:bg-slate-50",
                  selection?.selectedKeys.has(key) && "bg-emerald-50/60",
                  getRowClassName?.(row),
                )}
                onClick={() => onRowClick?.(row)}
              >
                {selection ? (
                  <td
                    className={cn(dense ? "px-1.5 py-1" : "px-3 py-2")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selection.selectedKeys.has(key)}
                      onChange={() => toggleOne(key)}
                      aria-label="Seleziona riga"
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(dense ? "px-1.5 py-1" : "px-3 py-2")}
                    onClick={(e) => {
                      // Solo le celle editabili bloccano il click sulla riga
                      if (col.editable) e.stopPropagation();
                    }}
                  >
                    {col.editable && onCellEdit ? (
                      <input
                        className={cn(
                          "w-full rounded border border-transparent bg-transparent hover:border-slate-200 focus:border-emerald-500 focus:outline-none",
                          dense ? "min-w-0 px-0.5 py-0.5 text-xs" : "min-w-[10rem] px-1 py-0.5",
                        )}
                        defaultValue={
                          col.getValue(row) === "(vuoto)" ? "" : col.getValue(row)
                        }
                        title="Modifica e premi Invio oppure clicca fuori per salvare"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          const next = e.target.value;
                          const prev =
                            col.getValue(row) === "(vuoto)" ? "" : col.getValue(row);
                          if (next !== prev) {
                            void onCellEdit(row, col.key, next);
                          }
                        }}
                      />
                    ) : col.render ? (
                      col.render(row)
                    ) : (
                      col.getValue(row)
                    )}
                  </td>
                ))}
              </tr>
            );
            })
          )}
        </tbody>
      </table>
      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        {filtered.length} di {rows.length} righe
        {selection && selection.selectedKeys.size > 0
          ? ` · ${selection.selectedKeys.size} selezionate`
          : ""}
      </div>
    </div>
  );
}
