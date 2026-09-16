"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const FILTER_MENU_WIDTH_PX = 240;
const FILTER_MENU_MAX_HEIGHT_PX = 288;

/** Sfondo/testo su tutte le celle; bordo sinistro solo sulla prima. */
function splitRowChrome(cls: string | undefined): { surface: string; accent: string } {
  if (!cls) return { surface: "", accent: "" };
  const accent: string[] = [];
  const surface: string[] = [];
  for (const token of cls.split(/\s+/).filter(Boolean)) {
    if (token === "border-l-4" || token.startsWith("border-l-")) {
      accent.push(token);
    } else {
      surface.push(token);
    }
  }
  return { surface: surface.join(" "), accent: accent.join(" ") };
}

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
  /** Classi extra sull’input editabile (es. nome cliente in evidenza) */
  inputClassName?: string;
  /** Classi sulla colonna (th/td), es. larghezza in vista fitWidth */
  colClassName?: string;
  /** Testo secondario sotto la cella editabile (es. competenza mensile) */
  cellExtra?: (row: Record<string, unknown>) => React.ReactNode;
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
  /**
   * Ordinamento lato server (tutto il database filtrato, non solo la pagina).
   * Se una colonna è in `keys`, il click chiama `onSort` invece di ordinare solo le righe caricate.
   */
  serverSort?: {
    keys: string[];
    key: string | null;
    dir: "asc" | "desc";
    onSort: (key: string) => void;
  };
  /**
   * Se cambia (es. collaboratore / pagina), azzera i filtri colonna.
   * Serve perché in Next.js lo stato client resta al cambio query.
   */
  resetKey?: string;
  /**
   * Filtri gestiti dal server: invece di ridurre le 100 righe in pagina,
   * chiamano `onFilter` (es. Collaboratore → ?collab=…).
   * `values` vuoto = nessun filtro / tutti.
   */
  serverColumnFilter?: {
    keys: string[];
    onFilter: (columnKey: string, values: string[]) => void;
    /** Valori attivi da URL (es. fornitore Enel) per evidenziare il filtro */
    activeValues?: Record<string, string[]>;
    /**
     * Colonne con multi-selezione: spunta più checkbox, poi «Applica».
     * (es. Stato → Da incassare + Incassato insieme)
     */
    multiSelectKeys?: string[];
    /** Colonne a testo libero: filtro «contiene» applicato dal server. */
    textKeys?: string[];
    /** Testo attivo per colonna (da URL). */
    activeText?: Record<string, string>;
    onTextFilter?: (columnKey: string, value: string) => void;
    /**
     * Opzioni lette dal database all'apertura del menu: riguardano tutte le
     * righe filtrate, non solo quelle caricate in pagina.
     */
    loadOptions?: (columnKey: string) => Promise<string[]>;
    /** Etichetta leggibile di un valore (es. `2026-09` → «set 2026»). */
    optionLabel?: (columnKey: string, value: string) => string;
  };
  /**
   * Opzioni filtro forzate per colonna (es. tutti i collaboratori, non solo quelli in pagina).
   */
  filterOptionsOverride?: Record<string, string[]>;
  /**
   * Modalità bozza: le modifiche restano locali (onCellDraft) finché non salvi.
   * Gli input sono controllati via getDraftValue.
   */
  draftMode?: boolean;
  getDraftValue?: (row: Record<string, unknown>, key: string) => string;
  isDraftDirty?: (row: Record<string, unknown>, key: string) => boolean;
  onCellDraft?: (row: Record<string, unknown>, key: string, value: string) => void;
  /**
   * Tabella a tutta larghezza senza min-width forzata (vista semplificata).
   * Se false (default), resta scroll orizzontale con barra sticky in basso.
   */
  fitWidth?: boolean;
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
  serverSort,
  resetKey,
  serverColumnFilter,
  filterOptionsOverride,
  draftMode = false,
  getDraftValue,
  isDraftDirty,
  onCellDraft,
  fitWidth = false,
}: Props) {
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [filterMenuPos, setFilterMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  /** Bozza multi-selezione filtri server (prima di «Applica») */
  const [draftServerFilter, setDraftServerFilter] = useState<
    Record<string, Set<string>>
  >({});
  /** Opzioni caricate dal database per colonna (menu filtro). */
  const [remoteOptions, setRemoteOptions] = useState<Record<string, string[]>>(
    {},
  );
  const [optionsLoading, setOptionsLoading] = useState<string | null>(null);
  const [optionSearch, setOptionSearch] = useState<Record<string, string>>({});
  const [textDraft, setTextDraft] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [scrollWidth, setScrollWidth] = useState(0);
  const [needsHScroll, setNeedsHScroll] = useState(false);
  /** Barra orizzontale fissa in basso allo schermo (sempre visibile a metà tabella) */
  const [fixedBar, setFixedBar] = useState<{
    left: number;
    width: number;
    visible: boolean;
  }>({ left: 0, width: 0, visible: false });
  const serverSortKeys = useMemo(
    () => new Set(serverSort?.keys ?? []),
    [serverSort?.keys],
  );
  const serverFilterKeys = useMemo(
    () => new Set(serverColumnFilter?.keys ?? []),
    [serverColumnFilter?.keys],
  );
  const multiSelectServerKeys = useMemo(
    () => new Set(serverColumnFilter?.multiSelectKeys ?? []),
    [serverColumnFilter?.multiSelectKeys],
  );
  const textServerKeys = useMemo(
    () => new Set(serverColumnFilter?.textKeys ?? []),
    [serverColumnFilter?.textKeys],
  );
  const loadOptions = serverColumnFilter?.loadOptions;

  const closeColumnFilter = useCallback(() => {
    setOpenFilter(null);
    setFilterMenuPos(null);
    filterTriggerRef.current = null;
  }, []);

  function computeFilterMenuPos(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + FILTER_MENU_WIDTH_PX > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - FILTER_MENU_WIDTH_PX - 8);
    }
    if (top + FILTER_MENU_MAX_HEIGHT_PX > window.innerHeight - 8) {
      top = Math.max(8, rect.top - FILTER_MENU_MAX_HEIGHT_PX - 4);
    }
    return { top, left };
  }

  /**
   * Apertura menu filtro: i valori arrivano dal database (tutte le righe che
   * rispettano gli altri filtri), non dalle righe caricate in pagina.
   * Il menu è in portal (fixed) per non essere tagliato da overflow-x della tabella.
   */
  function openColumnFilter(columnKey: string, anchor: HTMLElement) {
    if (openFilter === columnKey) {
      closeColumnFilter();
      return;
    }
    filterTriggerRef.current = anchor;
    setFilterMenuPos(computeFilterMenuPos(anchor));
    setOpenFilter(columnKey);
    if (!loadOptions) return;
    if (!serverFilterKeys.has(columnKey)) return;
    if (textServerKeys.has(columnKey)) return;
    if (remoteOptions[columnKey]) return;
    setOptionsLoading(columnKey);
    loadOptions(columnKey)
      .then((values) =>
        setRemoteOptions((prev) => ({ ...prev, [columnKey]: values })),
      )
      .catch(() => setRemoteOptions((prev) => ({ ...prev, [columnKey]: [] })))
      .finally(() => setOptionsLoading(null));
  }
  const optionLabelOf = (columnKey: string, value: string) =>
    serverColumnFilter?.optionLabel?.(columnKey, value) ?? value;

  // Cambio collaboratore / pagina → mostra di nuovo tutte le righe caricate (fino a 100)
  useEffect(() => {
    setSelected({});
    closeColumnFilter();
    setDraftServerFilter({});
    setRemoteOptions({});
    setOptionSearch({});
    setTextDraft({});
    setSortKey(null);
    setSortDir("asc");
  }, [resetKey, closeColumnFilter]);

  useEffect(() => {
    if (!openFilter) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (filterPopoverRef.current?.contains(target)) return;
      if (filterTriggerRef.current?.contains(target)) return;
      closeColumnFilter();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openFilter, closeColumnFilter]);

  useEffect(() => {
    if (!openFilter) return;
    const onDismiss = () => closeColumnFilter();
    const scrollEl = scrollRef.current;
    scrollEl?.addEventListener("scroll", onDismiss, { passive: true });
    window.addEventListener("scroll", onDismiss, { passive: true });
    window.addEventListener("resize", onDismiss);
    return () => {
      scrollEl?.removeEventListener("scroll", onDismiss);
      window.removeEventListener("scroll", onDismiss);
      window.removeEventListener("resize", onDismiss);
    };
  }, [openFilter, closeColumnFilter]);

  // Apri filtro multi: copia i valori attivi dall’URL nella bozza
  useEffect(() => {
    if (!openFilter || !multiSelectServerKeys.has(openFilter)) return;
    const active = serverColumnFilter?.activeValues?.[openFilter] ?? [];
    setDraftServerFilter((prev) => ({
      ...prev,
      [openFilter]: new Set(active),
    }));
  }, [openFilter, multiSelectServerKeys, serverColumnFilter?.activeValues]);

  const optionsByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      if (remoteOptions[col.key]) {
        map[col.key] = remoteOptions[col.key]!;
        continue;
      }
      if (filterOptionsOverride?.[col.key]?.length) {
        map[col.key] = [...filterOptionsOverride[col.key]].sort((a, b) =>
          a.localeCompare(b, "it"),
        );
        continue;
      }
      const set = new Set<string>();
      for (const row of rows) {
        const v = col.getValue(row) || "(vuoto)";
        set.add(v);
      }
      map[col.key] = [...set].sort((a, b) => a.localeCompare(b, "it"));
    }
    return map;
  }, [rows, columns, filterOptionsOverride, remoteOptions]);

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
        // I filtri server non riducono la pagina: ricaricano il database
        if (serverFilterKeys.has(col.key)) return true;
        const sel = selected[col.key];
        if (!sel || sel.size === 0) return true;
        const v = col.getValue(row) || "(vuoto)";
        return sel.has(v);
      }),
    );

    // Ordinamento locale solo se la colonna NON è gestita dal server
    if (sortKey && !serverSortKeys.has(sortKey)) {
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
  }, [rows, columns, selected, sortKey, sortDir, serverSortKeys, serverFilterKeys]);

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
    if (serverSort && serverSortKeys.has(colKey)) {
      serverSort.onSort(colKey);
      return;
    }
    if (sortKey === colKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(colKey);
      setSortDir("asc");
    }
  }

  function activeSortKey(colKey: string): boolean {
    if (serverSort && serverSortKeys.has(colKey)) {
      return serverSort.key === colKey;
    }
    return sortKey === colKey;
  }

  function activeSortDir(colKey: string): "asc" | "desc" {
    if (serverSort && serverSortKeys.has(colKey) && serverSort.key === colKey) {
      return serverSort.dir;
    }
    return sortDir;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);

  function measureScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setScrollWidth(el.scrollWidth);
    setNeedsHScroll(el.scrollWidth > el.clientWidth + 2);
  }

  function updateFixedBarPosition() {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const vh = window.innerHeight;
    // Tabella almeno parzialmente in vista → mostra la barra in basso allo schermo
    const inView = rect.bottom > 48 && rect.top < vh - 24;
    setFixedBar({
      left: Math.max(0, Math.round(rect.left)),
      width: Math.max(0, Math.round(rect.width)),
      visible: inView,
    });
  }

  function getVerticalScrollParent(el: HTMLElement | null): HTMLElement | null {
    let node = el?.parentElement ?? null;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (
        overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay"
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  useEffect(() => {
    measureScroll();
    updateFixedBarPosition();
    const el = scrollRef.current;
    const root = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      measureScroll();
      updateFixedBarPosition();
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    if (root) ro.observe(root);

    const scrollParent = getVerticalScrollParent(root);
    const onScrollOrResize = () => updateFixedBarPosition();
    window.addEventListener("resize", onScrollOrResize);
    scrollParent?.addEventListener("scroll", onScrollOrResize, {
      passive: true,
    });
    window.addEventListener("scroll", onScrollOrResize, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize);
      scrollParent?.removeEventListener("scroll", onScrollOrResize);
    };
  }, [columns, rows, fitWidth, dense]);

  useEffect(() => {
    updateFixedBarPosition();
  }, [needsHScroll]);

  function syncFromMain() {
    const main = scrollRef.current;
    const sticky = stickyScrollRef.current;
    if (!main || !sticky || syncingScroll.current) return;
    syncingScroll.current = true;
    sticky.scrollLeft = main.scrollLeft;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }

  function syncFromSticky() {
    const main = scrollRef.current;
    const sticky = stickyScrollRef.current;
    if (!main || !sticky || syncingScroll.current) return;
    syncingScroll.current = true;
    main.scrollLeft = sticky.scrollLeft;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }

  function scrollTable(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -280 : 280, behavior: "smooth" });
  }

  const showFixedHScroll =
    needsHScroll && fixedBar.visible && fixedBar.width > 0;

  // Quando la barra fissa riappare, allinea lo scroll alla tabella
  useEffect(() => {
    if (!showFixedHScroll) return;
    const main = scrollRef.current;
    const sticky = stickyScrollRef.current;
    if (!main || !sticky) return;
    sticky.scrollLeft = main.scrollLeft;
  }, [showFixedHScroll, scrollWidth]);

  const showHScrollChrome = needsHScroll;

  const activeFilterCol = openFilter
    ? columns.find((c) => c.key === openFilter)
    : null;

  function renderColumnFilterMenu(col: FilterColumn) {
    if (!filterMenuPos) return null;
    const isTextFilter = textServerKeys.has(col.key);

    return (
      <div
        ref={filterPopoverRef}
        role="dialog"
        aria-label={`Filtro ${col.label}`}
        className="fixed z-[100] flex w-60 max-h-[min(18rem,calc(100vh-1rem))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        style={{ top: filterMenuPos.top, left: filterMenuPos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {isTextFilter && serverColumnFilter ? (
          <div className="space-y-2 p-2">
            <p className="text-[10px] leading-snug text-slate-500">
              Cerca su tutto il database: mostra le righe che contengono il testo.
            </p>
            <input
              autoFocus
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder={`Contiene… (${col.label})`}
              value={
                textDraft[col.key] ??
                serverColumnFilter.activeText?.[col.key] ??
                ""
              }
              onChange={(e) =>
                setTextDraft((prev) => ({
                  ...prev,
                  [col.key]: e.target.value,
                }))
              }
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                serverColumnFilter.onTextFilter?.(
                  col.key,
                  (textDraft[col.key] ?? "").trim(),
                );
                closeColumnFilter();
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-md bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                onClick={() => {
                  serverColumnFilter.onTextFilter?.(
                    col.key,
                    (
                      textDraft[col.key] ??
                      serverColumnFilter.activeText?.[col.key] ??
                      ""
                    ).trim(),
                  );
                  closeColumnFilter();
                }}
              >
                Applica
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                onClick={() => {
                  setTextDraft((prev) => ({
                    ...prev,
                    [col.key]: "",
                  }));
                  serverColumnFilter.onTextFilter?.(col.key, "");
                  closeColumnFilter();
                }}
              >
                Pulisci
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-2 p-2 pb-1">
              {serverFilterKeys.has(col.key) ? (
                <p className="text-[10px] leading-snug text-slate-500">
                  {multiSelectServerKeys.has(col.key)
                    ? "Valori presi da tutto il database (con gli altri filtri attivi). Spunta e premi Applica."
                    : "Questo filtro vale su tutto il database, non solo su questa pagina."}
                </p>
              ) : null}
              {(optionsByColumn[col.key]?.length ?? 0) > 12 ? (
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  placeholder="Cerca nell'elenco…"
                  value={optionSearch[col.key] ?? ""}
                  onChange={(e) =>
                    setOptionSearch((prev) => ({
                      ...prev,
                      [col.key]: e.target.value,
                    }))
                  }
                />
              ) : null}
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="text-emerald-700"
                  onClick={() => {
                    if (serverFilterKeys.has(col.key) && serverColumnFilter) {
                      if (multiSelectServerKeys.has(col.key)) {
                        setDraftServerFilter((prev) => ({
                          ...prev,
                          [col.key]: new Set(optionsByColumn[col.key] ?? []),
                        }));
                        return;
                      }
                      serverColumnFilter.onFilter(col.key, []);
                      closeColumnFilter();
                      return;
                    }
                    selectAll(col.key);
                  }}
                >
                  Tutti
                </button>
                <button
                  type="button"
                  className="text-slate-500"
                  onClick={() => {
                    if (serverFilterKeys.has(col.key) && serverColumnFilter) {
                      if (multiSelectServerKeys.has(col.key)) {
                        setDraftServerFilter((prev) => ({
                          ...prev,
                          [col.key]: new Set(),
                        }));
                        return;
                      }
                      serverColumnFilter.onFilter(col.key, []);
                      closeColumnFilter();
                      return;
                    }
                    clearCol(col.key);
                  }}
                >
                  Nessuno
                </button>
              </div>
            </div>
            <div className="min-h-[4.5rem] flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
              {optionsLoading === col.key ? (
                <p className="px-1 py-2 text-xs text-slate-500">
                  Carico i valori dal database…
                </p>
              ) : null}
              {(optionsByColumn[col.key] ?? [])
                .filter((opt) => {
                  const search = (optionSearch[col.key] ?? "").trim();
                  if (!search) return true;
                  return optionLabelOf(col.key, opt)
                    .toLowerCase()
                    .includes(search.toLowerCase());
                })
                .map((opt) => {
                  const isServerCol = serverFilterKeys.has(col.key);
                  const isMulti = multiSelectServerKeys.has(col.key);
                  const isActive = (selected[col.key]?.size ?? 0) > 0;
                  const serverChecked =
                    serverColumnFilter?.activeValues?.[col.key]?.includes(opt) ??
                    false;
                  const draftChecked =
                    draftServerFilter[col.key]?.has(opt) ?? false;
                  const checked = isServerCol
                    ? isMulti
                      ? draftChecked
                      : serverChecked
                    : isActive
                      ? selected[col.key].has(opt)
                      : true;
                  return (
                    <label
                      key={opt}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={checked}
                        onChange={() => {
                          if (isServerCol && serverColumnFilter) {
                            if (isMulti) {
                              setDraftServerFilter((prev) => {
                                const cur = new Set(
                                  prev[col.key] ??
                                    serverColumnFilter.activeValues?.[col.key] ??
                                    [],
                                );
                                if (cur.has(opt)) cur.delete(opt);
                                else cur.add(opt);
                                return { ...prev, [col.key]: cur };
                              });
                              return;
                            }
                            if (serverChecked) {
                              serverColumnFilter.onFilter(col.key, []);
                            } else {
                              serverColumnFilter.onFilter(col.key, [opt]);
                            }
                            closeColumnFilter();
                            return;
                          }
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
                      <span className="min-w-0 break-words text-xs">
                        {optionLabelOf(col.key, opt)}
                      </span>
                    </label>
                  );
                })}
            </div>
            {serverFilterKeys.has(col.key) &&
            multiSelectServerKeys.has(col.key) &&
            serverColumnFilter ? (
              <div className="shrink-0 flex gap-2 border-t border-slate-100 bg-white p-2">
                <button
                  type="button"
                  className="flex-1 rounded-md bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                  onClick={() => {
                    const vals = [...(draftServerFilter[col.key] ?? new Set())];
                    const allOpts = optionsByColumn[col.key] ?? [];
                    const apply =
                      vals.length === 0 ||
                      (allOpts.length > 0 && vals.length === allOpts.length)
                        ? []
                        : vals;
                    serverColumnFilter.onFilter(col.key, apply);
                    closeColumnFilter();
                  }}
                >
                  Applica
                  {(draftServerFilter[col.key]?.size ?? 0) > 0
                    ? ` (${draftServerFilter[col.key]!.size})`
                    : ""}
                </button>
                <button
                  type="button"
                  className="rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                  onClick={closeColumnFilter}
                >
                  Chiudi
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative -mx-3 rounded-none border-y border-slate-200 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:border",
        showFixedHScroll ? "pb-6" : null,
      )}
    >
      {hasAnyFilter ? (
        <div className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Filtri locali attivi: vedi {filtered.length} di {rows.length} righe
            di questa pagina (le colonne con filtro sul database non sono
            interessate).
          </span>
          <button
            type="button"
            className="rounded bg-amber-800 px-2 py-1.5 font-medium text-white hover:bg-amber-900"
            onClick={clearAllFilters}
          >
            Azzera filtri
          </button>
        </div>
      ) : null}

      {showHScrollChrome ? (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-[11px] leading-snug text-slate-600 sm:text-xs">
            Scorri in orizzontale se serve (barra fissa in basso)
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100"
              title="Scorri a sinistra"
              onClick={() => scrollTable("left")}
            >
              ←
            </button>
            <button
              type="button"
              className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100"
              title="Scorri a destra"
              onClick={() => scrollTable("right")}
            >
              →
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="hide-native-scrollbar overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        onScroll={syncFromMain}
      >
      <table
        className={cn(
          "border-separate border-spacing-0 text-left",
          fitWidth
            ? "w-full min-w-0 table-fixed text-xs"
            : dense
              ? "w-max min-w-[1200px] text-xs"
              : "min-w-[1200px] text-sm",
        )}
      >
        <thead className="sticky top-0 z-20 bg-slate-100 text-slate-800 shadow-[0_1px_0_0_rgb(226,232,240)]">
          <tr>
            {selection ? (
              <th
                className={cn(
                  "align-middle",
                  dense ? "px-1.5 py-1.5" : "px-3 py-2",
                  fitWidth && "w-8",
                )}
              >
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
              const serverActive =
                (serverColumnFilter?.activeValues?.[col.key]?.length ?? 0) > 0 ||
                Boolean(serverColumnFilter?.activeText?.[col.key]?.trim());
              const active =
                (selected[col.key]?.size ?? 0) > 0 || serverActive;
              const isSorted = activeSortKey(col.key);
              const dir = activeSortDir(col.key);
              const isServerCol = serverSortKeys.has(col.key);
              return (
                <th
                  key={col.key}
                  className={cn(
                    "relative align-bottom overflow-visible whitespace-nowrap",
                    dense ? "px-1.5 py-1.5" : "px-3 py-2",
                    col.colClassName,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-0.5">
                    <button
                      type="button"
                      className="min-w-0 truncate font-semibold text-slate-800 hover:text-slate-950"
                      onClick={() => toggleSort(col.key)}
                      title={
                        isServerCol
                          ? "Ordina su tutto il database (cognome + nome)"
                          : col.sortKind === "date"
                            ? "Ordina per data (solo questa pagina)"
                            : "Ordina A→Z / Z→A (solo questa pagina)"
                      }
                    >
                      {col.label}
                      {isSorted
                        ? dir === "asc"
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
                        "shrink-0 rounded px-1 text-xs",
                        active ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700",
                        openFilter === col.key && "ring-2 ring-emerald-500",
                      )}
                      onClick={(e) => openColumnFilter(col.key, e.currentTarget)}
                      title="Filtro"
                      aria-expanded={openFilter === col.key}
                    >
                      ▾
                    </button>
                  </div>
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
              const selected = Boolean(selection?.selectedKeys.has(key));
              const { surface: rowSurface, accent: rowAccent } = splitRowChrome(
                getRowClassName?.(row),
              );
              const rowBox =
                "border-b border-slate-300 border-t border-slate-200";
              return (
              <tr
                key={key}
                className={cn(
                  "transition-colors",
                  onRowClick &&
                    (getRowClassName
                      ? "cursor-pointer hover:brightness-[0.97]"
                      : "cursor-pointer hover:bg-slate-50"),
                  selected && "shadow-[inset_6px_0_0_0_#059669]",
                )}
                onClick={() => onRowClick?.(row)}
              >
                {selection ? (
                  <td
                    className={cn(
                      dense ? "px-1.5 py-1" : "px-3 py-2",
                      fitWidth && "w-8",
                      rowBox,
                      "border-l border-slate-300",
                      rowSurface,
                      rowAccent,
                      selected && "!bg-emerald-200",
                    )}
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
                {columns.map((col, colIndex) => {
                  const baseVal =
                    col.getValue(row) === "(vuoto)" ? "" : col.getValue(row);
                  const displayVal = draftMode && getDraftValue
                    ? getDraftValue(row, col.key)
                    : baseVal;
                  const dirty =
                    draftMode && isDraftDirty ? isDraftDirty(row, col.key) : false;
                  const cellKey = `${key}-${col.key}`;
                  const isFirstData = !selection && colIndex === 0;
                  const isLast = colIndex === columns.length - 1;
                  return (
                  <td
                    key={col.key}
                    className={cn(
                      dense ? "px-1.5 py-1" : "px-3 py-2",
                      rowBox,
                      isFirstData && "border-l border-slate-300",
                      isLast && "border-r border-slate-300",
                      rowSurface,
                      isFirstData && rowAccent,
                      dirty && "bg-amber-50",
                      selected && "!bg-emerald-200",
                      col.colClassName,
                      fitWidth && "overflow-hidden",
                    )}
                    onClick={(e) => {
                      // Solo le celle editabili bloccano il click sulla riga
                      if (col.editable) e.stopPropagation();
                    }}
                  >
                    {col.editable && (draftMode ? onCellDraft : onCellEdit) ? (
                      <div>
                        <input
                          key={cellKey}
                          className={cn(
                            "w-full rounded border bg-transparent focus:border-emerald-500 focus:outline-none",
                            dirty
                              ? "border-amber-400"
                              : "border-transparent hover:border-slate-200",
                            dense ? "min-w-0 px-0.5 py-0.5 text-xs" : "min-w-[10rem] px-1 py-0.5",
                            col.inputClassName,
                          )}
                          value={draftMode ? displayVal : undefined}
                          defaultValue={draftMode ? undefined : displayVal}
                          title={
                            draftMode
                              ? "Modifica in bozza — poi premi «Salva tutte le modifiche»"
                              : "Modifica e premi Invio oppure clicca fuori per salvare"
                          }
                          onClick={(e) => e.stopPropagation()}
                          onChange={
                            draftMode && onCellDraft
                              ? (e) => onCellDraft(row, col.key, e.target.value)
                              : undefined
                          }
                          onKeyDown={(e) => {
                            if (!draftMode && e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onBlur={
                            draftMode || !onCellEdit
                              ? undefined
                              : (e) => {
                                  const next = e.target.value;
                                  if (next !== baseVal) {
                                    void onCellEdit(row, col.key, next);
                                  }
                                }
                          }
                        />
                        {col.cellExtra ? col.cellExtra(row) : null}
                      </div>
                    ) : col.render ? (
                      col.render(row)
                    ) : (
                      col.getValue(row)
                    )}
                  </td>
                  );
                })}
              </tr>
            );
            })
          )}
        </tbody>
      </table>
      </div>

      {showFixedHScroll ? (
        <div
          className="fixed z-[55] border-t-2 border-emerald-600 bg-white px-2 py-1.5 shadow-[0_-4px_14px_rgba(0,0,0,0.12)]"
          style={{
            left: fixedBar.left,
            width: fixedBar.width,
            bottom: 0,
          }}
          aria-label="Scorri la tabella in orizzontale"
        >
          <div
            ref={stickyScrollRef}
            className="overflow-x-auto rounded border border-slate-300 bg-slate-100"
            onScroll={syncFromSticky}
            style={{ height: 14 }}
            aria-label="Barra di scorrimento orizzontale"
          >
            <div style={{ width: Math.max(scrollWidth, 1), height: 1 }} />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <p className="text-xs text-slate-500">
          {hasAnyFilter
            ? `Filtrate ${filtered.length} su ${rows.length} caricate in questa pagina`
            : `Mostrate ${rows.length} righe in questa pagina (pieno = fino a 100)`}
          {selection && selection.selectedKeys.size > 0
            ? ` · ${selection.selectedKeys.size} selezionate`
            : ""}
        </p>
      </div>

      {activeFilterCol && filterMenuPos
        ? createPortal(
            renderColumnFilterMenu(activeFilterCol),
            document.body,
          )
        : null}
    </div>
  );
}
