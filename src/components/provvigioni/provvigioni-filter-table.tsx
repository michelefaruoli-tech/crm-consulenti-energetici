"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import {
  bulkMarkIncassatoCompetenceAction,
  bulkMarkPagatoCompetenceAction,
  bulkSetRecurrenceAction,
  bulkUpdateCommissionFieldsAction,
} from "@/lib/commission-actions";
import { bulkDeleteContractsAction } from "@/lib/delete-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";
import { StornoLegend } from "@/components/ui/storno-legend";
import { toPeriod, periodLabel, shortRecurrenceCode, RECURRENCE_OPTIONS } from "@/lib/recurring";
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
  supplyStartDate: "supplyStartDate",
  stornoFlag: "storno",
  stornoMonth: "stornoDate",
  stornoAmount: "stornoAmount",
  notes: "notes",
};

function shortRecurrence(value: string): string {
  return shortRecurrenceCode(value);
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

/** Chiave riga tabella (contratto o contratto:mese). */
function rowId(
  row:
    | { rowKey?: string; commissionId?: string; id?: string }
    | Record<string, unknown>,
) {
  const r = row as { rowKey?: string; id?: string; commissionId?: string };
  return String(r.rowKey ?? r.id ?? r.commissionId ?? "");
}

function contractIdOf(
  row:
    | { contractId?: string; commissionId?: string; id?: string }
    | Record<string, unknown>,
) {
  const r = row as { contractId?: string; id?: string; commissionId?: string };
  const contractId = String(r.contractId ?? "");
  if (contractId) return contractId;
  const rawId = String(r.id ?? "");
  if (rawId.includes(":")) return rawId.split(":")[0] ?? rawId;
  return rawId || String(r.commissionId ?? "");
}

function commissionIdOf(row: { commissionId?: string; id?: string } | Record<string, unknown>) {
  const c = String((row as { commissionId?: string }).commissionId || "");
  if (c) return c;
  return String((row as { id?: string }).id || "");
}

const STORAGE_KEY_ADVANCED = "provvigioni-colonne-avanzate";

/** Colonne principali Provvigioni (spec utente) */
const SIMPLE_COLUMN_ORDER = [
  "clientName",
  "podPdr",
  "collaboratorName",
  "supplierName",
  "operationType",
  "stato",
  "collectionMonth",
  "recurrence",
  "stornoFlag",
  "amount",
  "_del",
] as const;

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
    case "supplyStartDate":
      return row.supplyStartDate ?? "";
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
    focus?: string | null;
    competence?: string | null;
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
  const [bulkRecurrenceKind, setBulkRecurrenceKind] = useState<
    "UT" | "M" | "R" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bozze: rowId → { colonna → valore } */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  /** Ref per leggere le bozze senza ricreare le definizioni colonna (evita salto focus). */
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  /** false = semplificata (default), true = tutte le colonne + inizio fornitura */
  const [advancedView, setAdvancedView] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY_ADVANCED) === "1") {
        setAdvancedView(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  function toggleAdvancedView(next: boolean) {
    setAdvancedView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY_ADVANCED, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  const settleOpts = useMemo(() => settledOptions(), []);
  const [competencePeriod, setCompetencePeriod] = useState(
    () => listQuery?.competence ?? toPeriod(new Date()),
  );
  useEffect(() => {
    if (listQuery?.competence) setCompetencePeriod(listQuery.competence);
  }, [listQuery?.competence]);
  /** Contatore per forzare reset filtri colonna locali (ExcelFilterTable) */
  const [localFilterClearN, setLocalFilterClearN] = useState(0);
  const filterResetKey = [
    listQuery?.collab ?? "tutti",
    listQuery?.settled ?? "",
    listQuery?.supplier ?? "",
    listQuery?.stato ?? "",
    listQuery?.tipologia ?? "",
    listQuery?.q ?? "",
    listQuery?.vista ?? "tutti",
    listQuery?.focus ?? "",
    listQuery?.competence ?? "",
    String(page),
    serverSortKey ?? "",
    serverSortDir,
    advancedView ? "adv" : "simple",
    String(localFilterClearN),
  ].join("|");

  const hasUrlFilters = Boolean(
    listQuery?.collab ||
      listQuery?.supplier ||
      listQuery?.stato ||
      listQuery?.tipologia ||
      listQuery?.q ||
      listQuery?.focus ||
      listQuery?.competence,
  );

  function clearFiltersHref() {
    return buildPageHref("/provvigioni", {
      settled: listQuery?.settled,
      vista: listQuery?.vista,
    });
  }

  function azzeraFiltri() {
    if (!confirmLeaveDrafts()) return;
    setLocalFilterClearN((n) => n + 1);
    router.push(clearFiltersHref());
  }

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
      focus: listQuery?.focus,
      competence: listQuery?.competence,
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

    if (columnKey === "collaboratorName") {
      if (values.length === 0) {
        router.push(buildPageHref("/provvigioni", baseQuery({ collab: null })));
        return;
      }
      const ids: string[] = [];
      for (const name of values) {
        const id = collaboratorByName?.[name];
        if (!id) {
          setError(`Collaboratore non trovato: ${name}`);
          return;
        }
        ids.push(id);
      }
      router.push(
        buildPageHref("/provvigioni", baseQuery({ collab: ids.join("|") })),
      );
      return;
    }

    if (columnKey === "supplierName") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({
            supplier: values.length ? values.join("|") : null,
          }),
        }),
      );
      return;
    }

    if (columnKey === "stato") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({
            stato: values.length ? values.join("|") : null,
          }),
        }),
      );
      return;
    }

    if (columnKey === "clientType") {
      router.push(
        buildPageHref("/provvigioni", {
          ...baseQuery({
            tipologia: values.length ? values.join("|") : null,
          }),
        }),
      );
      return;
    }
  }

  const selectedCount = selectedKeys.size;
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedKeys.has(rowId(r))),
    [rows, selectedKeys],
  );
  const selectedAmount = useMemo(
    () =>
      selectedRows.reduce(
        (sum, row) => sum + (Number(String(row.amount ?? "0").replace(",", ".")) || 0),
        0,
      ),
    [selectedRows],
  );
  const selectedCollaborators = useMemo(
    () => [...new Set(selectedRows.map((row) => row.collaboratorName).filter(Boolean))],
    [selectedRows],
  );
  /** ID contratto univoci (anche con righe clone mese). */
  const selectedContractIds = useMemo(
    () =>
      [
        ...new Set(
          rows
            .filter((r) => selectedKeys.has(rowId(r)))
            .map((r) => contractIdOf(r))
            .filter(Boolean),
        ),
      ],
    [rows, selectedKeys],
  );
  /** ID commissione delle stesse righe (azioni gettone / incasso). */
  const selectedCommissionIds = useMemo(
    () =>
      rows
        .filter((r) => selectedKeys.has(rowId(r)))
        .map((r) => commissionIdOf(r))
        .filter(Boolean),
    [rows, selectedKeys],
  );

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
    const drafted = draftsRef.current[id]?.[key];
    if (drafted != null) return drafted;
    const base = rows.find((r) => rowId(r) === id);
    return base ? originalCellValue(base, key) : String(row[key] ?? "");
  }

  function isDraftDirty(row: Record<string, unknown>, key: string): boolean {
    const id = rowId(row);
    return Boolean(draftsRef.current[id] && key in draftsRef.current[id]);
  }

  function baseCellValue(row: Record<string, unknown>, key: string): string {
    const id = rowId(row);
    const base = rows.find((r) => rowId(r) === id);
    return base ? originalCellValue(base, key) : String(row[key] ?? "");
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
      const base = rows.find((r) => rowId(r) === id);
      const commissionId = base ? commissionIdOf(base) : id;
      if (!commissionId) continue;
      for (const [colKey, value] of Object.entries(cells)) {
        const field = FIELD_MAP[colKey];
        if (!field) continue;
        changes.push({ commissionId, field, value });
      }
    }

    // Stato prima, storno dopo: le scelte manuali su Storno restano prioritarie
    const FIELD_ORDER: Record<string, number> = {
      stato: 50,
      storno: 80,
      stornoDate: 90,
      stornoAmount: 100,
    };
    changes.sort((a, b) => {
      const idCmp = a.commissionId.localeCompare(b.commissionId);
      if (idCmp !== 0) return idCmp;
      return (FIELD_ORDER[a.field] ?? 10) - (FIELD_ORDER[b.field] ?? 10);
    });

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
    options: { competencePeriod?: string } = {},
  ) {
    if (selectedCount === 0) {
      setError("Seleziona almeno una riga (checkbox a sinistra).");
      return;
    }
    if (!competencePeriod) {
      setError("Seleziona un mese di competenza.");
      return;
    }
    const collaboratorsLabel =
      selectedCollaborators.length <= 4
        ? selectedCollaborators.join(", ") || "—"
        : `${selectedCollaborators.slice(0, 4).join(", ")} + altri ${selectedCollaborators.length - 4}`;
    const summary = [
      label,
      "",
      `Contratti selezionati: ${selectedCount}`,
      `Importo totale: ${selectedAmount.toLocaleString("it-IT", {
        style: "currency",
        currency: "EUR",
      })}`,
      `Collaboratori: ${collaboratorsLabel}`,
      options.competencePeriod
        ? `Mese competenza: ${periodLabel(options.competencePeriod)}`
        : competencePeriod
          ? `Mese competenza: ${periodLabel(competencePeriod)}`
          : null,
      "",
      "Confermi l'operazione?",
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    if (!window.confirm(summary)) {
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

  function applyBulkRecurrence() {
    if (selectedContractIds.length === 0) {
      setError("Seleziona almeno una riga (checkbox a sinistra).");
      return;
    }
    if (!bulkRecurrenceKind) {
      setError("Scegli UT, M o R prima di applicare.");
      return;
    }

    const kindLabel =
      bulkRecurrenceKind === "UT"
        ? "Gettone (UT) — scheda Tutti"
        : bulkRecurrenceKind === "M"
          ? "Ricorrente mensile (M)"
          : "Ricorrente annuale (R)";

    const summary = [
      `Sposta in categoria: ${kindLabel}`,
      "",
      `Contratti selezionati: ${selectedContractIds.length}`,
      `(righe spuntate: ${selectedCount})`,
      "",
      "I contratti compariranno nella scheda corrispondente (Tutti / M / R).",
      "Confermi?",
    ].join("\n");

    if (!window.confirm(summary)) return;

    setError(null);
    setMessage(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("contractIds", selectedContractIds.join(","));
        fd.set("recurrence", bulkRecurrenceKind);
        const result = await bulkSetRecurrenceAction(fd);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSelectedKeys(new Set());
        setBulkRecurrenceKind(null);
        const skippedHint =
          result.skipped > 0 ? ` · ${result.skipped} già ok o senza permesso` : "";
        const shortKind =
          result.kind === "Una tantum" ? "UT" : result.kind === "M" ? "M" : "R";
        setMessage(
          `Categoria ${shortKind}: aggiornati ${result.count} contratti${skippedHint}`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore cambio categoria");
      }
    });
  }

  const allColumns: FilterColumn[] = useMemo(() => {
    const cols: FilterColumn[] = [
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
      // Non editabile: clic = apri scheda contratto (sulla scheda cliente)
      editable: false,
      sortKind: "text",
      render: (r) => {
        const row = r as unknown as ProvvigioneRow;
        const pod = String(row.podPdr ?? "").trim();
        const missing = Boolean(row.missingSupplyStart);
        const alertClass = missing
          ? "font-bold text-red-700 underline decoration-red-500"
          : "font-medium text-emerald-700 underline decoration-emerald-300";
        if (!pod) {
          return (
            <Link
              href={`/clienti/${row.clientId}?contratto=${row.id}`}
              className={`text-xs ${missing ? "font-bold text-red-700 underline" : "font-medium text-emerald-700 underline"}`}
              title={
                missing
                  ? "Manca data ingresso fornitura — apri e sistema"
                  : "Apri contratto (POD assente)"
              }
              onClick={(e) => e.stopPropagation()}
            >
              {missing ? "Sistema ingresso →" : "Apri contratto"}
            </Link>
          );
        }
        return (
          <Link
            href={`/clienti/${row.clientId}?contratto=${row.id}`}
            className={`font-mono text-xs underline-offset-2 hover:opacity-90 ${alertClass}`}
            title={
              missing
                ? "Manca data ingresso fornitura — apri e sistema"
                : "Apri scheda contratto"
            }
            onClick={(e) => e.stopPropagation()}
          >
            {pod}
            {missing ? (
              <span className="ml-1 font-sans text-[10px] font-bold uppercase">
                ingresso?
              </span>
            ) : null}
          </Link>
        );
      },
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
            <span className="whitespace-nowrap text-xs text-slate-700">
              {formatCollaboratorShort(full)}
            </span>
          );
        }
        const names = Object.keys(collaboratorByName);
        return (
          <select
            className={`max-w-[7.5rem] rounded border px-1 py-1 text-xs ${
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
      key: "supplyStartDate",
      label: "Inizio forn.",
      getValue: (r) => String(r.supplyStartDate ?? ""),
      editable: true,
      sortKind: "date",
      inputClassName: "max-w-[6.5rem] tabular-nums text-xs",
      cellExtra: (r) => {
        const row = r as ProvvigioneRow;
        const val = String(row.supplyStartDate ?? "").trim();
        const missing = Boolean(row.missingSupplyStart) || !val || val === "—";
        if (!missing) return null;
        return (
          <p className="mt-0.5 text-[10px] font-medium text-red-700">
            da verificare
          </p>
        );
      },
    },
    {
      key: "operationType",
      label: "Tipo op.",
      getValue: (r) => baseCellValue(r, "operationType"),
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
            className={`max-w-[9.5rem] rounded border px-1 py-1 text-xs ${
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
      getValue: (r) => baseCellValue(r, "stato"),
      sortKind: "text",
      render: (r) => {
        const current = getDraftValue(r, "stato") || "Da incassare";
        const options = [...PROVVIGIONE_STATO_OPTIONS];
        const dirty = isDraftDirty(r, "stato");
        return (
          <select
            className={`max-w-[9.5rem] rounded border px-1 py-1 text-xs ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={
              options.includes(current as (typeof options)[number])
                ? current
                : "Da incassare"
            }
            title="Bozza: Da controllare = non contrattualizzato · Stornato = clawback applicato"
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
      label: "Tipo",
      getValue: (r) => baseCellValue(r, "recurrence"),
      sortKind: "text",
      render: (r) => {
        const currentCode = shortRecurrence(getDraftValue(r, "recurrence"));
        const dirty = isDraftDirty(r, "recurrence");
        const value =
          currentCode === "M" ? "M" : currentCode === "R" ? "R" : "Una tantum";
        return (
          <select
            className={`max-w-[7.5rem] rounded border px-1 py-1 text-xs font-semibold ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={value}
            title="UT = gettone · M = mensile · R = annuale (12 mesi)"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => queueDraft(r, "recurrence", e.target.value)}
          >
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.short} · {o.label}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "collectionMonth",
      label: "Incasso",
      getValue: (r) => String(r.collectionMonth ?? ""),
      editable: true,
      sortKind: "date",
      cellExtra: (r) => {
        const note = (r as ProvvigioneRow).recurringIncassoNote;
        if (!note) return null;
        return (
          <p
            className="mt-0.5 max-w-[11rem] text-[10px] leading-tight text-slate-600"
            title={note}
          >
            {note}
          </p>
        );
      },
    },
    {
      key: "stornoFlag",
      label: "Storno",
      getValue: (r) => baseCellValue(r, "stornoFlag"),
      sortKind: "text",
      render: (r) => {
        const current = getDraftValue(r, "stornoFlag") || "No";
        const dirty = isDraftDirty(r, "stornoFlag");
        return (
          <select
            className={`max-w-[4.5rem] rounded border px-1 py-1 text-xs ${
              dirty ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
            }`}
            value={current === "Sì" ? "Sì" : "No"}
            title="Storno gettone: solo se lo imposti tu (Sì/No). KO/cessato NON attiva storno automatico."
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value;
              queueDraft(r, "stornoFlag", v);
              if (v === "Sì") {
                const amount = getDraftValue(r, "amount").trim();
                if (amount && !getDraftValue(r, "stornoAmount")) {
                  const n = Number(amount.replace(",", ".")) || 0;
                  queueDraft(
                    r,
                    "stornoAmount",
                    n > 0 ? String(-Math.abs(n)) : "0",
                  );
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
      cols.push({
        key: "_del",
        label: "",
        getValue: () => "",
        render: (r) => (
          <DeleteRowButton kind="contract" id={String(r.id)} compact />
        ),
      });
    }
    return cols;
    // getDraftValue/isDraftDirty usano draftsRef: non mettere drafts nelle deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDelete, collaboratorByName, supplierNames, rows]);

  const columns = useMemo(() => {
    if (advancedView) {
      const widths: Record<string, string> = {
        clientName: "w-[15rem] min-w-[15rem] max-w-[15rem]",
        podPdr: "w-[12rem] min-w-[12rem] max-w-[12rem]",
        collaboratorName: "w-[8rem] min-w-[8rem] max-w-[8rem]",
        supplierName: "w-[8rem] min-w-[8rem] max-w-[8rem]",
        clientType: "w-[4rem] min-w-[4rem] max-w-[4rem]",
        amount: "w-[5rem] min-w-[5rem] max-w-[5rem] text-right",
        supplyStartDate: "w-[7rem] min-w-[7rem] max-w-[7rem]",
        operationType: "w-[8rem] min-w-[8rem] max-w-[8rem]",
        stato: "w-[10rem] min-w-[10rem] max-w-[10rem]",
        recurrence: "w-[7rem] min-w-[7rem] max-w-[7rem]",
        collectionMonth: "w-[8rem] min-w-[8rem] max-w-[8rem]",
        stornoFlag: "w-[5rem] min-w-[5rem] max-w-[5rem]",
        stornoMonth: "w-[7rem] min-w-[7rem] max-w-[7rem]",
        stornoAmount: "w-[7rem] min-w-[7rem] max-w-[7rem]",
        notes: "w-[15rem] min-w-[15rem] max-w-[15rem]",
        _del: "w-[3rem] min-w-[3rem] max-w-[3rem]",
      };
      const inputs: Record<string, string> = {
        clientName: "w-full truncate text-[13px] font-semibold text-slate-900",
        amount: "w-full text-right font-semibold tabular-nums",
        clientType: "w-full text-center",
        supplierName: "w-full truncate",
        supplyStartDate: "w-full tabular-nums",
        collectionMonth: "w-full tabular-nums",
        stornoMonth: "w-full tabular-nums",
        stornoAmount: "w-full text-right tabular-nums",
        notes: "w-full truncate",
      };
      return allColumns.map((col) => ({
        ...col,
        colClassName: widths[col.key],
        inputClassName: [col.inputClassName, inputs[col.key]].filter(Boolean).join(" "),
      }));
    }
    const byKey = new Map(allColumns.map((c) => [c.key, c]));
    /** Larghezze per stare tutte in una schermata (vista semplificata) */
    const widths: Record<string, string> = {
      clientName: "w-[22%]",
      collaboratorName: "w-[10%]",
      supplierName: "w-[11%]",
      amount: "w-[7%]",
      stato: "w-[12%]",
      collectionMonth: "w-[9%]",
      notes: "w-[17%]",
      recurrence: "w-[7%]",
      _del: "w-[4%]",
    };
    const inputs: Record<string, string> = {
      clientName:
        "min-w-0 w-full truncate text-[12px] font-semibold tracking-tight text-slate-900",
      amount: "max-w-full w-full text-right tabular-nums",
      collectionMonth: "max-w-full w-full tabular-nums",
      notes: "min-w-0 w-full truncate",
      supplierName: "min-w-0 w-full truncate",
    };
    return SIMPLE_COLUMN_ORDER.map((k) => {
      const col = byKey.get(k);
      if (!col) return undefined;
      const next: FilterColumn = {
        ...col,
        colClassName: widths[k],
        ...(inputs[k] ? { inputClassName: inputs[k] } : {}),
      };
      if (k === "collectionMonth") {
        next.label = "Data incasso";
      }
      return next;
    }).filter((c): c is FilterColumn => Boolean(c));
  }, [advancedView, allColumns]);

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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">Azioni sulle righe</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Seleziona una o più righe, poi scegli l&apos;operazione.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedCount > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            {selectedCount > 0 ? `${selectedCount} selezionate` : "Nessuna selezione"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[11px] text-slate-600">
                Mese di competenza
                <select
                  className="mt-0.5 block min-w-[9rem] rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  value={competencePeriod}
                  onChange={(e) => {
                    const period = e.target.value;
                    setCompetencePeriod(period);
                    if (!period) return;
                    if (!confirmLeaveDrafts()) return;
                    router.push(
                      buildPageHref("/provvigioni", {
                        ...baseQuery({ competence: period }),
                        page: undefined,
                      }),
                    );
                  }}
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
                disabled={pending || !competencePeriod}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                onClick={() =>
                  runBulk(
                    `Segna incassato · ${periodLabel(competencePeriod)}`,
                    async () => {
                      const fd = new FormData();
                      fd.set("commissionIds", selectedCommissionIds.join(","));
                      fd.set("competencePeriod", competencePeriod);
                      return bulkMarkIncassatoCompetenceAction(fd);
                    },
                    { competencePeriod },
                  )
                }
                title="Incasso dal fornitore: data incasso = mese di competenza"
              >
                Segna incassato
              </button>

              {canConfirm ? (
                <button
                  type="button"
                  disabled={pending || !competencePeriod}
                  className="rounded-lg bg-sky-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-900 disabled:opacity-50"
                  onClick={() =>
                    runBulk(
                      `Segna pagato · ${periodLabel(competencePeriod)}`,
                      async () => {
                        const fd = new FormData();
                        fd.set("commissionIds", selectedCommissionIds.join(","));
                        fd.set("competencePeriod", competencePeriod);
                        return bulkMarkPagatoCompetenceAction(fd);
                      },
                      { competencePeriod },
                    )
                  }
                  title="Liquidazione collaboratore per il mese di competenza scelto"
                >
                  Segna pagato
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
              Categoria UT / M / R
            </p>
            <p className="mt-1 text-[11px] leading-snug text-indigo-800/80">
              Sposta i contratti selezionati nella scheda corretta (gettone, mensile o
              annuale).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { id: "UT" as const, label: "UT", hint: "Una tantum" },
                  { id: "M" as const, label: "M", hint: "Mensile" },
                  { id: "R" as const, label: "R", hint: "Annuale" },
                ] as const
              ).map((opt) => {
                const active = bulkRecurrenceKind === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={pending}
                    title={opt.hint}
                    onClick={() => setBulkRecurrenceKind(opt.id)}
                    className={`min-w-[3.25rem] rounded-lg border px-3 py-2 text-center transition ${
                      active
                        ? opt.id === "UT"
                          ? "border-slate-800 bg-slate-900 text-white"
                          : opt.id === "M"
                            ? "border-teal-700 bg-teal-600 text-white"
                            : "border-indigo-700 bg-indigo-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block text-sm font-bold">{opt.label}</span>
                    <span
                      className={`block text-[10px] ${active ? "text-white/85" : "text-slate-500"}`}
                    >
                      {opt.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={
                pending || selectedContractIds.length === 0 || !bulkRecurrenceKind
              }
              className="mt-3 w-full rounded-lg bg-indigo-800 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-900 disabled:opacity-50"
              onClick={applyBulkRecurrence}
            >
              Applica categoria
            </button>
            {bulkRecurrenceKind && selectedContractIds.length > 0 ? (
              <p className="mt-2 text-[11px] text-indigo-900/80">
                {selectedContractIds.length} contratt
                {selectedContractIds.length === 1 ? "o" : "i"} →{" "}
                {bulkRecurrenceKind === "UT"
                  ? "UT"
                  : bulkRecurrenceKind === "M"
                    ? "M"
                    : "R"}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Gestione</p>
            <div className="flex flex-col items-stretch gap-2">
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
          </div>
        </div>

        {pending ? <p className="mt-2 text-xs text-slate-500">Elaborazione…</p> : null}
        {message ? <p className="mt-2 text-xs text-emerald-800">{message}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <details className="order-2 text-xs text-slate-500 md:order-1">
          <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-900">
            Legenda e istruzioni
          </summary>
        <p className="mt-2 max-w-4xl leading-relaxed">
          {advancedView ? (
            <>
              Vista <strong>avanzata</strong>: tutte le colonne (POD, collab., tip.,
              inizio fornitura, tipo op., storno…). Usa i pulsanti fissi ← → a
              destra dello schermo per scorrere. Celle modificabili = bozza
              (giallo) finché non salvi.{" "}
            </>
          ) : (
            <>
              Vista <strong>semplificata</strong>: tutte le colonne essenziali in una
              schermata (Cliente · Collab. · Fornitore · Gettone · Stato · Data
              incasso · Note · Tipo). Stato <strong>Da controllare</strong> = inserito
              ma non ancora contrattualizzato
              {canDelete ? " · ×" : ""}.{" "}
            </>
          )}
          Colori riga (legenda sotto): 1 da incassare · 2 rosso BLOCCA storno · 3
          verde fuori storno · 4 ciano ricorrente · 5 viola fine storno · 6 arancio
          scadenza 12 mesi.
          {advancedView
            ? " POD rosso = manca ingresso fornitura."
            : ""}{" "}
          <strong>Tipo</strong>: UT gettone · M mensile · R annuale (12 mesi).
          {canDelete ? " × rossa = elimina." : ""}
        </p>
        </details>
        <div className="order-1 flex shrink-0 flex-wrap items-center gap-2 md:order-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                !advancedView
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              onClick={() => toggleAdvancedView(false)}
              title="Poche colonne essenziali"
            >
              Semplificata
            </button>
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                advancedView
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              onClick={() => toggleAdvancedView(true)}
              title="Tutte le colonne + data inizio fornitura"
            >
              Avanzata
            </button>
          </div>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ${
              hasUrlFilters
                ? "bg-amber-50 text-amber-950 ring-amber-300 hover:bg-amber-100"
                : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
            }`}
            onClick={azzeraFiltri}
            title="Toglie collaboratore, fornitore, stato, tipologia, ricerca e filtri colonna"
          >
            Azzera filtri
          </button>
        </div>
      </div>
      <ExcelFilterTable
        dense
        fitWidth={!advancedView}
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => rowId(r)}
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
          multiSelectKeys: [
            "collaboratorName",
            "supplierName",
            "stato",
            "clientType",
          ],
          onFilter: onServerColumnFilter,
          activeValues: {
            ...(listQuery?.collab && collaboratorByName
              ? {
                  collaboratorName: listQuery.collab
                    .split("|")
                    .map((id) => id.trim())
                    .filter(Boolean)
                    .map(
                      (id) =>
                        Object.entries(collaboratorByName).find(
                          ([, v]) => v === id,
                        )?.[0] ?? "",
                    )
                    .filter(Boolean),
                }
              : {}),
            ...(listQuery?.supplier
              ? {
                  supplierName: listQuery.supplier
                    .split("|")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
              : {}),
            ...(listQuery?.stato
              ? {
                  stato: listQuery.stato
                    .split("|")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
              : {}),
            ...(listQuery?.tipologia
              ? {
                  clientType: listQuery.tipologia
                    .split("|")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
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
          recurrence: ["UT", "M", "R"],
        }}
        getRowClassName={(r) => {
          const storno = String(r.stornoRowClass ?? "");
          const border = String(r.gettoneBorderClass ?? "");
          return [storno, border].filter(Boolean).join(" ") || undefined;
        }}
      />
      <StornoLegend />
      <p className="text-xs text-slate-500">
        Gettone: bordo ambra = da confermare · bordo verde = confermato.
      </p>
    </div>
  );
}
