"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importAndApplyComparaAgostoAction,
  previewComparaAgostoAction,
} from "@/lib/compara-agosto-actions";
import { comparaRuleAmount } from "@/lib/compara-agosto/amounts";
import {
  COMPARA_SUGGESTION_LABEL,
  comparaAgostoRowKey,
  type ComparaAgostoPreviewResult,
  type ComparaAgostoPreviewRow,
  type ComparaAgostoRowEdit,
  type ComparaSuggestion,
} from "@/lib/compara-agosto/view-types";
import { periodLabel, toPeriod } from "@/lib/recurring";
import { formatCurrency } from "@/lib/commission";
import { PROVVIGIONE_STATO_OPTIONS } from "@/lib/provvigioni-stato";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Lettura file non riuscita"));
    reader.readAsDataURL(file);
  });
}

function monthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 18; i++) {
    out.push(toPeriod(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

const SUGGESTION_STYLE: Record<ComparaSuggestion, string> = {
  already_ok: "text-slate-600",
  update_status: "text-emerald-700",
  insert_pod: "text-sky-700",
  create_row: "text-sky-800",
  confirm_match: "text-amber-800",
  skip_liquidated: "text-slate-500",
};

function canConfirm(row: ComparaAgostoPreviewRow): boolean {
  return (
    row.action === "update" ||
    row.action === "create" ||
    row.action === "confirm" ||
    row.action === "unmatched"
  );
}

function defaultEditForRow(
  row: ComparaAgostoPreviewRow,
  defaultRunLabel: string,
): ComparaAgostoRowEdit {
  return {
    nominativo: row.nominativo,
    supplier: row.supplierName || row.supplierHint || "",
    amount: row.ruleAmount,
    pod: row.proposedPodFill || row.podRaw || row.crmPod || "",
    stato: row.proposedStato,
    collaboratorId: row.collaboratorId ?? "",
    collaboratorName: row.collaboratorName ?? row.shopHint ?? "",
    rowLabel: row.defaultRowLabel ?? defaultRunLabel,
  };
}

function buildDefaultEdits(
  preview: ComparaAgostoPreviewResult,
): Record<string, ComparaAgostoRowEdit> {
  const out: Record<string, ComparaAgostoRowEdit> = {};
  for (const row of preview.rows) {
    out[comparaAgostoRowKey(row)] = defaultEditForRow(
      row,
      preview.defaultRunLabel,
    );
  }
  return out;
}

function shortCollab(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1]?.[0] ?? ""}.`;
}

export function ComparaAgostoImportPanel() {
  const router = useRouter();
  const months = useMemo(() => monthOptions(), []);
  const [pending, start] = useTransition();

  const [fileKey, setFileKey] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [competencePeriod, setCompetencePeriod] = useState("2026-08");
  const [settledPeriod, setSettledPeriod] = useState(
    months.includes("2026-09") ? "2026-09" : (months[0] ?? toPeriod(new Date())),
  );
  const [runLabel, setRunLabel] = useState("Compara Agosto 2026");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ComparaAgostoPreviewResult | null>(
    null,
  );
  /** Righe confermate (sì) — solo queste vanno in apply. */
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [rowEdits, setRowEdits] = useState<
    Record<string, ComparaAgostoRowEdit>
  >({});
  const [filter, setFilter] = useState<"all" | ComparaSuggestion>("all");

  useEffect(() => {
    if (!preview) {
      setConfirmedKeys(new Set());
      setRowEdits({});
      return;
    }
    setRowEdits(buildDefaultEdits(preview));
    // Nessuna conferma automatica: Michele sceglie riga per riga
    setConfirmedKeys(new Set());
  }, [preview]);

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    if (filter === "all") return preview.rows;
    return preview.rows.filter((r) => r.suggestion === filter);
  }, [preview, filter]);

  const confirmedStats = useMemo(() => {
    if (!preview) return { count: 0, total: 0 };
    let count = 0;
    let total = 0;
    for (const row of preview.rows) {
      const key = comparaAgostoRowKey(row);
      if (!confirmedKeys.has(key)) continue;
      if (!canConfirm(row)) continue;
      const edit = rowEdits[key];
      count++;
      total += edit?.amount ?? row.ruleAmount ?? 0;
    }
    return { count, total };
  }, [preview, confirmedKeys, rowEdits]);

  function reset() {
    setPreview(null);
    setConfirmedKeys(new Set());
    setRowEdits({});
    setError(null);
    setMessage(null);
  }

  async function onFileChange(file: File | null) {
    reset();
    if (!file) {
      setFileName("");
      setFileB64(null);
      return;
    }
    setFileName(file.name);
    setFileB64(await fileToBase64(file));
  }

  function buildFd(): FormData {
    const fd = new FormData();
    if (fileB64) fd.set("fileBase64", fileB64);
    fd.set("fileName", fileName);
    fd.set("competencePeriod", competencePeriod);
    fd.set("settledPeriod", settledPeriod);
    if (runLabel.trim()) fd.set("runLabel", runLabel.trim());
    if (confirmedKeys.size > 0) {
      fd.set("selectedRowKeys", JSON.stringify([...confirmedKeys]));
    }
    if (Object.keys(rowEdits).length > 0) {
      fd.set("rowEdits", JSON.stringify(rowEdits));
    }
    return fd;
  }

  function runPreview() {
    if (!fileB64) {
      setError("Seleziona prima COMPARA AGOSTO.xlsx");
      return;
    }
    reset();
    start(async () => {
      const res = await previewComparaAgostoAction(buildFd());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res);
      setCompetencePeriod(res.competencePeriod);
      setSettledPeriod(res.settledPeriod);
      if (res.defaultRunLabel) setRunLabel(res.defaultRunLabel);
    });
  }

  function setConfirmed(key: string, row: ComparaAgostoPreviewRow, on: boolean) {
    if (!canConfirm(row)) return;
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function confirmSuggestion(suggestion: ComparaSuggestion, on: boolean) {
    if (!preview) return;
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      for (const row of preview.rows) {
        if (row.suggestion !== suggestion || !canConfirm(row)) continue;
        const key = comparaAgostoRowKey(row);
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function patchEdit(key: string, patch: Partial<ComparaAgostoRowEdit>) {
    setRowEdits((prev) => {
      const existing = prev[key];
      if (existing) return { ...prev, [key]: { ...existing, ...patch } };
      const row = preview?.rows.find((r) => comparaAgostoRowKey(r) === key);
      const base = row
        ? defaultEditForRow(row, preview!.defaultRunLabel)
        : {
            nominativo: "",
            supplier: "",
            amount: null,
            pod: "",
            stato: "Incassato da liquidare",
            collaboratorId: "",
            collaboratorName: "",
            rowLabel: runLabel,
          };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  function onCollaboratorChange(
    key: string,
    row: ComparaAgostoPreviewRow,
    collaboratorId: string,
  ) {
    const opt = preview?.collaborators.find((c) => c.id === collaboratorId);
    const name = opt?.name ?? "";
    const edit = rowEdits[key];
    const supplier = edit?.supplier || row.supplierName || row.supplierHint;
    const rule = comparaRuleAmount({
      supplierHint: supplier,
      collaboratorName: name || row.shopHint,
      units: row.units,
      fileAmount: row.fileAmount,
    });
    patchEdit(key, {
      collaboratorId,
      collaboratorName: name,
      amount: rule.amount,
    });
  }

  function runApply() {
    if (!preview) return;
    if (confirmedStats.count === 0) {
      setError("Conferma almeno una riga (Sì in colonna Azione) prima di applicare.");
      return;
    }

    const confirmedRows = preview.rows.filter((r) =>
      confirmedKeys.has(comparaAgostoRowKey(r)),
    );
    const creates = confirmedRows.filter(
      (r) => r.suggestion === "create_row",
    ).length;
    const pods = confirmedRows.filter(
      (r) => r.suggestion === "insert_pod",
    ).length;
    const missingCollab = confirmedRows.filter((r) => {
      if (r.action !== "unmatched") return false;
      const edit = rowEdits[comparaAgostoRowKey(r)];
      return !(edit?.collaboratorId || r.collaboratorId);
    });
    if (missingCollab.length > 0) {
      setError(
        `Senza corrispondenza: scegli il collaboratore su ${missingCollab.length} riga/e (tendina in Azione).`,
      );
      return;
    }

    const ok = window.confirm(
      [
        `Applicare ${confirmedStats.count} righe confermate (${formatCurrency(confirmedStats.total)})?`,
        "Vengono usati Nominativo / Fornitore / Importo / POD / Stato modificati in tabella.",
        creates > 0 ? `${creates} CREATE riga stub.` : null,
        pods > 0 ? `${pods} INSERT POD dal file.` : null,
        "",
        "Le righe «Già in liquidazione» non vengono toccate.",
        "Operazione tracciata nella liquidazione (annullabile).",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!ok) return;

    start(async () => {
      const res = await importAndApplyComparaAgostoAction(buildFd());
      if (!res.ok) {
        setError(
          res.details?.length
            ? `${res.error}: ${res.details.join(", ")}`
            : res.error,
        );
        return;
      }
      setMessage(
        [
          `Compara applicato: ${res.applied} righe`,
          res.stubsCreated > 0 ? `${res.stubsCreated} stub creati` : null,
          res.skipped > 0 ? `${res.skipped} saltate` : null,
          res.errors > 0 ? `${res.errors} errori` : null,
          res.podFilled > 0 ? `${res.podFilled} POD compilati` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setPreview(null);
      setFileB64(null);
      setFileName("");
      setFileKey((k) => k + 1);
      router.push(`/provvigioni/liquidazioni/${res.runId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="File Compara (.xlsx)">
          <Input
            key={fileKey}
            type="file"
            accept=".xlsx"
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Competenza">
          <Select
            value={competencePeriod}
            onChange={(e) => setCompetencePeriod(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mese invito / settled">
          <Select
            value={settledPeriod}
            onChange={(e) => setSettledPeriod(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Etichetta liquidazione">
          <Input
            value={runLabel}
            onChange={(e) => setRunLabel(e.target.value)}
          />
        </Field>
      </div>

      <p className="text-xs text-slate-500">
        Tabella come Provvigioni: modifica celle, poi conferma Sì/No in Azione.
        Già Incassato da liquidare + POD uguale → «Già in liquidazione» (nessun
        overwrite). POD nel file ma assente in CRM → «Inserisci POD dal file».
        Quote: Faruoli/Lucio 80·80 · Fagiano 70·65 · altri 70·60.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Lettura…" : "1. Anteprima"}
        </Button>
        <Button
          onClick={runApply}
          disabled={pending || !preview || confirmedStats.count === 0}
        >
          {pending && preview
            ? "Applicazione…"
            : `2. Applica confermate (${confirmedStats.count})`}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
            <p>
              Competenza <strong>{periodLabel(preview.competencePeriod)}</strong>
              {" · "}settled{" "}
              <strong>{periodLabel(preview.settledPeriod)}</strong>
              {" · "}già ok{" "}
              <strong>{preview.summary.alreadyOk}</strong>
              {" · "}confermate{" "}
              <strong>
                {confirmedStats.count} ({formatCurrency(confirmedStats.total)})
              </strong>
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Button
                variant="secondary"
                onClick={() => confirmSuggestion("update_status", true)}
              >
                Conferma aggiornamenti
              </Button>
              <Button
                variant="secondary"
                onClick={() => confirmSuggestion("insert_pod", true)}
              >
                Conferma insert POD
              </Button>
              <Button
                variant="secondary"
                onClick={() => confirmSuggestion("create_row", true)}
              >
                Conferma create
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmedKeys(new Set())}
              >
                Azzera conferme
              </Button>
              <Select
                value={filter}
                onChange={(e) =>
                  setFilter(e.target.value as "all" | ComparaSuggestion)
                }
              >
                <option value="all">Filtro: tutte</option>
                <option value="update_status">Solo da aggiornare</option>
                <option value="insert_pod">Solo insert POD</option>
                <option value="create_row">Solo crea riga</option>
                <option value="confirm_match">Solo da confermare</option>
                <option value="already_ok">Solo già in liquidazione</option>
                <option value="skip_liquidated">Solo già liquidate</option>
              </Select>
            </div>
          </div>

          <div className="max-h-[36rem] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2 py-2 font-semibold">Nominativo</th>
                  <th className="px-2 py-2 font-semibold">Fornitore</th>
                  <th className="hidden px-2 py-2 font-semibold lg:table-cell">
                    Collab.
                  </th>
                  <th className="px-2 py-2 font-semibold">Importo</th>
                  <th className="px-2 py-2 font-semibold">POD / PDR</th>
                  <th className="px-2 py-2 font-semibold">Stato</th>
                  <th className="sticky right-0 z-30 bg-slate-100 px-2 py-2 font-semibold shadow-[-2px_0_5px_rgba(15,23,42,0.06)]">
                    Azione
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const key = comparaAgostoRowKey(row);
                  const editable = canConfirm(row);
                  const edit =
                    rowEdits[key] ??
                    defaultEditForRow(row, preview.defaultRunLabel);
                  const confirmed = confirmedKeys.has(key);
                  const hasCrmCollab = Boolean(row.collaboratorId);
                  return (
                    <tr
                      key={key}
                      className={`border-t border-slate-100 align-top ${
                        confirmed ? "bg-emerald-50/40" : "bg-white"
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        {editable ? (
                          <input
                            className="min-w-[10rem] rounded border border-slate-200 bg-transparent px-1 py-1 text-[13px] font-semibold text-slate-900"
                            value={edit.nominativo}
                            onChange={(e) =>
                              patchEdit(key, { nominativo: e.target.value })
                            }
                          />
                        ) : (
                          <span className="font-semibold text-slate-900">
                            {row.nominativo}
                          </span>
                        )}
                        {row.contractNumber ? (
                          <div className="text-[10px] text-slate-400">
                            {row.contractNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        {editable ? (
                          <input
                            className="max-w-[8rem] rounded border border-slate-200 bg-transparent px-1 py-1"
                            value={edit.supplier}
                            onChange={(e) =>
                              patchEdit(key, { supplier: e.target.value })
                            }
                          />
                        ) : (
                          <span>{row.supplierName || row.supplierHint}</span>
                        )}
                      </td>
                      <td className="hidden px-2 py-1.5 lg:table-cell">
                        {hasCrmCollab && editable ? (
                          <select
                            className="max-w-[7rem] rounded border border-slate-200 bg-transparent px-1 py-1"
                            value={edit.collaboratorId}
                            title={edit.collaboratorName}
                            onChange={(e) =>
                              onCollaboratorChange(key, row, e.target.value)
                            }
                          >
                            <option value="">—</option>
                            {preview.collaborators.map((c) => (
                              <option key={c.id} value={c.id}>
                                {shortCollab(c.name)}
                              </option>
                            ))}
                          </select>
                        ) : hasCrmCollab ? (
                          <span title={row.collaboratorName}>
                            {shortCollab(row.collaboratorName || "")}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {editable ? (
                          <>
                            <input
                              type="number"
                              step="0.01"
                              className="w-[5.5rem] rounded border border-slate-200 bg-transparent px-1 py-1 tabular-nums"
                              value={edit.amount ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                patchEdit(key, {
                                  amount:
                                    v === ""
                                      ? null
                                      : Number.isFinite(Number(v))
                                        ? Number(v)
                                        : null,
                                });
                              }}
                            />
                            {row.fileAmount != null &&
                            row.fileAmount !== edit.amount ? (
                              <div className="text-[10px] text-slate-400">
                                file {formatCurrency(row.fileAmount)}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="tabular-nums">
                            {row.ruleAmount != null
                              ? formatCurrency(row.ruleAmount)
                              : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {editable ? (
                          <input
                            className={`max-w-[11rem] rounded border px-1 py-1 font-mono text-xs ${
                              row.podNeedsFill
                                ? "border-sky-300 bg-sky-50"
                                : "border-slate-200 bg-transparent"
                            }`}
                            value={edit.pod}
                            placeholder="POD / PDR…"
                            onChange={(e) =>
                              patchEdit(key, { pod: e.target.value })
                            }
                          />
                        ) : (
                          <span className="font-mono text-xs">
                            {row.crmPod || row.podRaw || "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {editable ? (
                          <select
                            className="max-w-[9.5rem] rounded border border-slate-200 bg-transparent px-1 py-1"
                            value={
                              PROVVIGIONE_STATO_OPTIONS.includes(
                                edit.stato as (typeof PROVVIGIONE_STATO_OPTIONS)[number],
                              )
                                ? edit.stato
                                : "Incassato da liquidare"
                            }
                            onChange={(e) =>
                              patchEdit(key, { stato: e.target.value })
                            }
                          >
                            {PROVVIGIONE_STATO_OPTIONS.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{row.crmStato || row.proposedStato}</span>
                        )}
                      </td>
                      <td
                        className={`sticky right-0 z-10 px-2 py-1.5 shadow-[-2px_0_5px_rgba(15,23,42,0.06)] ${
                          confirmed ? "bg-emerald-50" : "bg-white"
                        }`}
                      >
                        <div
                          className={`font-medium ${SUGGESTION_STYLE[row.suggestion]}`}
                        >
                          {COMPARA_SUGGESTION_LABEL[row.suggestion]}
                        </div>
                        {!hasCrmCollab && editable ? (
                          <select
                            className="mt-1 max-w-[8rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                            value={edit.collaboratorId}
                            onChange={(e) =>
                              onCollaboratorChange(key, row, e.target.value)
                            }
                          >
                            <option value="">Collab…</option>
                            {preview.collaborators.map((c) => (
                              <option key={c.id} value={c.id}>
                                {shortCollab(c.name)}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {editable ? (
                          <div className="mt-1.5 flex items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-slate-700">
                              <input
                                type="radio"
                                name={`confirm-${key}`}
                                checked={confirmed}
                                onChange={() => setConfirmed(key, row, true)}
                              />
                              Sì
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-slate-700">
                              <input
                                type="radio"
                                name={`confirm-${key}`}
                                checked={!confirmed}
                                onChange={() => setConfirmed(key, row, false)}
                              />
                              No
                            </label>
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-slate-500">
                            — non toccare
                          </div>
                        )}
                        {row.skipReason && row.suggestion === "confirm_match" ? (
                          <div className="mt-0.5 max-w-[10rem] text-[10px] text-amber-700">
                            {row.skipReason}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.truncated ? (
            <p className="text-xs text-amber-700">
              Anteprima troncata alle prime {preview.rows.length} righe.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
