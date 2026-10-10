"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importAndApplyComparaAgostoAction,
  previewComparaAgostoAction,
} from "@/lib/compara-agosto-actions";
import { comparaRuleAmount } from "@/lib/compara-agosto/amounts";
import {
  COMPARA_PRESENCE_LABEL,
  comparaAgostoRowKey,
  type ComparaAgostoPreviewResult,
  type ComparaAgostoPreviewRow,
  type ComparaAgostoRowEdit,
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

function defaultEditForRow(
  row: ComparaAgostoPreviewRow,
  defaultRunLabel: string,
): ComparaAgostoRowEdit {
  return {
    nominativo: row.nominativo,
    supplier: row.supplierHint || row.supplierName || "",
    amount: row.ruleAmount,
    pod: row.proposedPodFill || row.podRaw || row.crmPod || "",
    stato: row.proposedStato,
    collaboratorId: row.collaboratorId ?? "",
    collaboratorName: row.collaboratorName ?? row.shopHint ?? "",
    rowLabel: row.defaultRowLabel ?? defaultRunLabel,
    createConfirmed: false,
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [rowEdits, setRowEdits] = useState<
    Record<string, ComparaAgostoRowEdit>
  >({});

  useEffect(() => {
    if (!preview) {
      setSelectedKeys(new Set());
      setRowEdits({});
      return;
    }
    setRowEdits(buildDefaultEdits(preview));
    setSelectedKeys(new Set());
  }, [preview]);

  const selectedStats = useMemo(() => {
    if (!preview) return { count: 0, total: 0 };
    let count = 0;
    let total = 0;
    for (const row of preview.rows) {
      const key = comparaAgostoRowKey(row);
      if (!selectedKeys.has(key)) continue;
      const edit = rowEdits[key];
      count++;
      total += edit?.amount ?? row.ruleAmount ?? 0;
    }
    return { count, total };
  }, [preview, selectedKeys, rowEdits]);

  function reset() {
    setPreview(null);
    setSelectedKeys(new Set());
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

  function buildFd(
    keys: string[],
    edits: Record<string, ComparaAgostoRowEdit> = rowEdits,
  ): FormData {
    const fd = new FormData();
    if (fileB64) fd.set("fileBase64", fileB64);
    fd.set("fileName", fileName);
    fd.set("competencePeriod", competencePeriod);
    fd.set("settledPeriod", settledPeriod);
    if (runLabel.trim()) fd.set("runLabel", runLabel.trim());
    fd.set("selectedRowKeys", JSON.stringify(keys));
    if (Object.keys(edits).length > 0) {
      fd.set("rowEdits", JSON.stringify(edits));
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
      const res = await previewComparaAgostoAction(buildFd([]));
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

  function toggleSelected(key: string, on: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAll(on: boolean) {
    if (!preview) return;
    setSelectedKeys(
      on ? new Set(preview.rows.map((r) => comparaAgostoRowKey(r))) : new Set(),
    );
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
            createConfirmed: false,
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
    const supplier = edit?.supplier || row.supplierHint || row.supplierName;
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

  function validateKeys(
    keys: string[],
    edits: Record<string, ComparaAgostoRowEdit>,
  ): string | null {
    if (!preview || keys.length === 0) {
      return "Seleziona almeno una riga da salvare.";
    }
    const creates = preview.rows.filter((r) => {
      const key = comparaAgostoRowKey(r);
      return keys.includes(key) && r.presence === "needs_create";
    });
    for (const row of creates) {
      const key = comparaAgostoRowKey(row);
      const edit = edits[key];
      if (!edit?.createConfirmed) {
        return `«${row.nominativo}» non è in Provvigioni: spunta «Confermo caricamento» e scegli a nome di chi.`;
      }
      if (!edit.collaboratorId) {
        return `«${row.nominativo}»: scegli il collaboratore a nome di cui caricare.`;
      }
    }
    return null;
  }

  function runSave(
    keys: string[],
    edits: Record<string, ComparaAgostoRowEdit> = rowEdits,
  ) {
    if (!preview) return;
    const validation = validateKeys(keys, edits);
    if (validation) {
      setError(validation);
      return;
    }

    const createCount = preview.rows.filter(
      (r) =>
        keys.includes(comparaAgostoRowKey(r)) && r.presence === "needs_create",
    ).length;
    const ok = window.confirm(
      [
        `Salvare ${keys.length} riga/e?`,
        createCount > 0
          ? `${createCount} verranno create come Incassato da liquidare (confermate).`
          : "Aggiornamento delle schede già in Provvigioni.",
        "Write a lotti (niente blocco database su Neon).",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!ok) return;

    setError(null);
    start(async () => {
      const res = await importAndApplyComparaAgostoAction(buildFd(keys, edits));
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
          `Salvato: ${res.applied} righe`,
          res.stubsCreated > 0 ? `${res.stubsCreated} caricate` : null,
          res.skipped > 0 ? `${res.skipped} saltate` : null,
          res.errors > 0 ? `${res.errors} errori` : null,
          res.podFilled > 0 ? `${res.podFilled} POD` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      router.refresh();
      const again = await previewComparaAgostoAction(buildFd([], edits));
      if (again.ok) {
        setPreview(again);
      }
      if (res.runId) {
        router.push(`/provvigioni/liquidazioni/${res.runId}`);
      }
    });
  }

  function saveOne(row: ComparaAgostoPreviewRow) {
    const key = comparaAgostoRowKey(row);
    let edits = rowEdits;
    if (row.presence === "needs_create") {
      const edit =
        edits[key] ?? defaultEditForRow(row, preview!.defaultRunLabel);
      if (!edit.collaboratorId) {
        setError(
          `Scegli a nome di chi caricare «${row.nominativo}», poi conferma e Salva.`,
        );
        toggleSelected(key, true);
        return;
      }
      if (!edit.createConfirmed) {
        const c = window.confirm(
          `«${row.nominativo}» non è in Provvigioni (o c’è solo altro fornitore).\n\nConfermi di caricarlo a nome di ${edit.collaboratorName}?`,
        );
        if (!c) return;
        const next = { ...edit, createConfirmed: true };
        edits = { ...edits, [key]: next };
        setRowEdits(edits);
      }
    }
    runSave([key], edits);
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
        Elenco completo dei nominativi del foglio. Modifica le celle e Salva:
        se già in Provvigioni aggiorna la scheda; se manca (o c’è solo una
        Liquidata di altro fornitore) conferma il caricamento e scegli a nome di
        chi. PDR con 0/00 iniziali riconosciuti. Quote: Faruoli/Lucio 80·80 ·
        Fagiano 70·65 · altri 70·60.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Lettura…" : "1. Carica elenco"}
        </Button>
        <Button
          onClick={() => runSave([...selectedKeys])}
          disabled={pending || !preview || selectedStats.count === 0}
        >
          {pending && preview
            ? "Salvataggio…"
            : `2. Salva selezionate (${selectedStats.count})`}
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
              {" · "}
              <strong>{preview.summary.total}</strong> nominativi
              {" · "}in Provvigioni{" "}
              <strong>{preview.summary.present}</strong>
              {" · "}da caricare{" "}
              <strong>{preview.summary.needsCreate}</strong>
              {" · "}selezionate{" "}
              <strong>
                {selectedStats.count} ({formatCurrency(selectedStats.total)})
              </strong>
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Button variant="secondary" onClick={() => selectAll(true)}>
                Seleziona tutte
              </Button>
              <Button variant="secondary" onClick={() => selectAll(false)}>
                Azzera selezione
              </Button>
            </div>
          </div>

          <div className="max-h-[40rem] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2 py-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={
                        preview.rows.length > 0 &&
                        selectedKeys.size === preview.rows.length
                      }
                      onChange={(e) => selectAll(e.target.checked)}
                      aria-label="Seleziona tutte"
                    />
                  </th>
                  <th className="px-2 py-2 font-semibold">Nominativo</th>
                  <th className="px-2 py-2 font-semibold">Fornitore</th>
                  <th className="px-2 py-2 font-semibold">Collab.</th>
                  <th className="px-2 py-2 font-semibold">Importo</th>
                  <th className="px-2 py-2 font-semibold">POD / PDR</th>
                  <th className="px-2 py-2 font-semibold">Stato</th>
                  <th className="sticky right-0 z-30 bg-slate-100 px-2 py-2 font-semibold shadow-[-2px_0_5px_rgba(15,23,42,0.06)]">
                    Situazione / Salva
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const key = comparaAgostoRowKey(row);
                  const edit =
                    rowEdits[key] ??
                    defaultEditForRow(row, preview.defaultRunLabel);
                  const selected = selectedKeys.has(key);
                  const needsCreate = row.presence === "needs_create";
                  return (
                    <tr
                      key={key}
                      className={`border-t border-slate-100 align-top ${
                        selected ? "bg-emerald-50/40" : "bg-white"
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) =>
                            toggleSelected(key, e.target.checked)
                          }
                          aria-label={`Seleziona ${row.nominativo}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="min-w-[10rem] rounded border border-slate-200 bg-transparent px-1 py-1 text-[13px] font-semibold text-slate-900"
                          value={edit.nominativo}
                          onChange={(e) =>
                            patchEdit(key, { nominativo: e.target.value })
                          }
                        />
                        {row.contractNumber ? (
                          <div className="text-[10px] text-slate-400">
                            {row.contractNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="max-w-[8rem] rounded border border-slate-200 bg-transparent px-1 py-1"
                          value={edit.supplier}
                          onChange={(e) =>
                            patchEdit(key, { supplier: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className={`max-w-[8rem] rounded border px-1 py-1 ${
                            needsCreate && !edit.collaboratorId
                              ? "border-amber-400 bg-amber-50"
                              : "border-slate-200 bg-transparent"
                          }`}
                          value={edit.collaboratorId}
                          title={edit.collaboratorName}
                          onChange={(e) =>
                            onCollaboratorChange(key, row, e.target.value)
                          }
                        >
                          <option value="">
                            {needsCreate ? "A nome di…" : "—"}
                          </option>
                          {preview.collaborators.map((c) => (
                            <option key={c.id} value={c.id}>
                              {shortCollab(c.name)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
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
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="max-w-[11rem] rounded border border-slate-200 bg-transparent px-1 py-1 font-mono text-xs"
                          value={edit.pod}
                          placeholder="POD / PDR…"
                          onChange={(e) =>
                            patchEdit(key, { pod: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
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
                      </td>
                      <td
                        className={`sticky right-0 z-10 px-2 py-1.5 shadow-[-2px_0_5px_rgba(15,23,42,0.06)] ${
                          selected ? "bg-emerald-50" : "bg-white"
                        }`}
                      >
                        <div
                          className={`font-medium ${
                            needsCreate ? "text-amber-800" : "text-slate-700"
                          }`}
                        >
                          {COMPARA_PRESENCE_LABEL[row.presence]}
                        </div>
                        {needsCreate ? (
                          <label className="mt-1 flex cursor-pointer items-start gap-1 text-[11px] text-amber-900">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={Boolean(edit.createConfirmed)}
                              onChange={(e) =>
                                patchEdit(key, {
                                  createConfirmed: e.target.checked,
                                })
                              }
                            />
                            <span>Confermo caricamento</span>
                          </label>
                        ) : null}
                        {row.presenceNote ? (
                          <div className="mt-0.5 max-w-[11rem] text-[10px] text-slate-500">
                            {row.presenceNote}
                          </div>
                        ) : null}
                        <Button
                          className="mt-1.5"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => saveOne(row)}
                        >
                          Salva
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.truncated ? (
            <p className="text-xs text-amber-700">
              Elenco troncato alle prime {preview.rows.length} righe.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
