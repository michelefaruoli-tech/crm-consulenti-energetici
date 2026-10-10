"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importAndApplyComparaAgostoAction,
  previewComparaAgostoAction,
} from "@/lib/compara-agosto-actions";
import {
  COMPARA_AGOSTO_ACTION_LABEL,
  comparaAgostoRowKey,
  type ComparaAgostoAction,
  type ComparaAgostoPreviewResult,
  type ComparaAgostoPreviewRow,
} from "@/lib/compara-agosto/view-types";
import { periodLabel, toPeriod } from "@/lib/recurring";
import { formatCurrency } from "@/lib/commission";
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

const ACTION_STYLE: Record<ComparaAgostoAction, string> = {
  update: "bg-emerald-50 text-emerald-700",
  create: "bg-sky-50 text-sky-800",
  confirm: "bg-amber-50 text-amber-800",
  unmatched: "bg-red-50 text-red-700",
  skip_liquidated: "bg-slate-100 text-slate-600",
};

function isSelectable(row: ComparaAgostoPreviewRow): boolean {
  return (
    row.action === "update" ||
    row.action === "create" ||
    row.action === "confirm"
  );
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<"all" | ComparaAgostoAction>("all");

  useEffect(() => {
    if (!preview) {
      setSelectedKeys(new Set());
      return;
    }
    // Default: solo «da aggiornare». Create e confirm richiedono scelta esplicita.
    setSelectedKeys(
      new Set(
        preview.rows
          .filter((r) => r.action === "update")
          .map((r) => comparaAgostoRowKey(r)),
      ),
    );
  }, [preview]);

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    if (filter === "all") return preview.rows;
    return preview.rows.filter((r) => r.action === filter);
  }, [preview, filter]);

  const selectedApplicable = useMemo(() => {
    if (!preview) return { count: 0, total: 0 };
    let count = 0;
    let total = 0;
    for (const row of preview.rows) {
      if (!selectedKeys.has(comparaAgostoRowKey(row))) continue;
      if (!isSelectable(row)) continue;
      count++;
      total += row.ruleAmount ?? 0;
    }
    return { count, total };
  }, [preview, selectedKeys]);

  function reset() {
    setPreview(null);
    setSelectedKeys(new Set());
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
    if (selectedKeys.size > 0) {
      fd.set("selectedRowKeys", JSON.stringify([...selectedKeys]));
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
    });
  }

  function toggleKey(key: string, row: ComparaAgostoPreviewRow) {
    if (!isSelectable(row)) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAction(action: ComparaAgostoAction, on: boolean) {
    if (!preview) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const row of preview.rows) {
        if (row.action !== action || !isSelectable(row)) continue;
        const key = comparaAgostoRowKey(row);
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function runApply() {
    if (!preview) return;
    if (selectedApplicable.count === 0) {
      setError(
        "Seleziona almeno una riga da aggiornare / creare / confermare (checkbox).",
      );
      return;
    }
    const creates = preview.rows.filter(
      (r) =>
        r.action === "create" && selectedKeys.has(comparaAgostoRowKey(r)),
    ).length;
    const confirms = preview.rows.filter(
      (r) =>
        r.action === "confirm" && selectedKeys.has(comparaAgostoRowKey(r)),
    ).length;
    const ok = window.confirm(
      [
        `Applicare ${selectedApplicable.count} righe selezionate (${formatCurrency(selectedApplicable.total)})?`,
        creates > 0
          ? `${creates} CREATE: mancavano in Provvigioni — confermi i dati?`
          : null,
        confirms > 0
          ? `${confirms} DA CONFERMARE: match/POD ambigui — Michele approva la sostituzione?`
          : null,
        "",
        "Stato destinazione: Incassato da liquidare (PAID).",
        "Le già liquidate e le senza match NON vengono applicate.",
        "Operazione tracciata nella liquidazione (annullabile).",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!ok) return;

    start(async () => {
      const res = await importAndApplyComparaAgostoAction(buildFd());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        [
          `Compara applicato: ${res.applied} righe`,
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
        <Field label="Competenza (riferimento)">
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
        Regole importo: Fagiano Eni 70 / Iren 65 · altri (es. Laforgia) Eni 70 /
        Iren 60. Match per Nominativo (+ POD se presente). Fagiano senza POD:
        proposta fill, niente overwrite se dati diversi. Create e «da
        confermare» vanno selezionate a mano.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Lettura…" : "1. Anteprima"}
        </Button>
        <Button
          onClick={runApply}
          disabled={pending || !preview || selectedApplicable.count === 0}
        >
          {pending && preview
            ? "Applicazione…"
            : `2. Applica selezionate (${selectedApplicable.count})`}
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
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Righe OK" value={String(preview.summary.total)} />
            <Stat
              label="Da aggiornare"
              value={String(preview.summary.update)}
              tone="emerald"
            />
            <Stat
              label="Da creare"
              value={String(preview.summary.create)}
              tone="sky"
            />
            <Stat
              label="Da confermare"
              value={String(preview.summary.confirm)}
              tone="amber"
            />
            <Stat
              label="Senza match"
              value={String(preview.summary.unmatched)}
              tone="red"
            />
            <Stat
              label="Già liquidate"
              value={String(preview.summary.skipLiquidated)}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Competenza <strong>{periodLabel(preview.competencePeriod)}</strong>
              {" · "}settled{" "}
              <strong>{periodLabel(preview.settledPeriod)}</strong>
              {" · "}totale regole{" "}
              <strong>
                {formatCurrency(preview.summary.ruleAmountTotal)}
              </strong>
              {" · "}selezionato{" "}
              <strong>{formatCurrency(selectedApplicable.total)}</strong>
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Fagiano: {preview.summary.fagianoRows} righe · senza POD in file:{" "}
              {preview.summary.fagianoMissingPod} · match probabile:{" "}
              {preview.summary.fagianoProbableMatch} · prefill POD:{" "}
              {preview.summary.fagianoPodPrefill} · POD da confermare:{" "}
              {preview.summary.fagianoPodConfirm}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Button
              variant="secondary"
              onClick={() => selectAction("update", true)}
            >
              Seleziona aggiornamenti
            </Button>
            <Button
              variant="secondary"
              onClick={() => selectAction("create", true)}
            >
              Seleziona create
            </Button>
            <Button
              variant="secondary"
              onClick={() => selectAction("confirm", true)}
            >
              Seleziona da confermare
            </Button>
            <Button
              variant="secondary"
              onClick={() => setSelectedKeys(new Set())}
            >
              Deseleziona tutto
            </Button>
            <Select
              value={filter}
              onChange={(e) =>
                setFilter(e.target.value as "all" | ComparaAgostoAction)
              }
            >
              <option value="all">Filtro: tutte</option>
              <option value="update">Solo da aggiornare</option>
              <option value="create">Solo da creare</option>
              <option value="confirm">Solo da confermare</option>
              <option value="unmatched">Solo senza match</option>
              <option value="skip_liquidated">Solo già liquidate</option>
            </Select>
          </div>

          <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Sel.</th>
                  <th className="px-2 py-2">Azione</th>
                  <th className="px-2 py-2">Nominativo</th>
                  <th className="px-2 py-2">Forn.</th>
                  <th className="px-2 py-2">Collab.</th>
                  <th className="px-2 py-2">POD file</th>
                  <th className="px-2 py-2">POD CRM / fill</th>
                  <th className="px-2 py-2">Importo</th>
                  <th className="px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const key = comparaAgostoRowKey(row);
                  const selectable = isSelectable(row);
                  return (
                    <tr key={key} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          disabled={!selectable}
                          checked={selectable && selectedKeys.has(key)}
                          onChange={() => toggleKey(key, row)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 ${ACTION_STYLE[row.action]}`}
                        >
                          {COMPARA_AGOSTO_ACTION_LABEL[row.action]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-800">
                          {row.nominativo}
                        </div>
                        {row.crmClientName &&
                        row.crmClientName !== row.nominativo ? (
                          <div className="text-slate-500">
                            CRM: {row.crmClientName}
                          </div>
                        ) : null}
                        {row.contractNumber ? (
                          <div className="text-slate-400">
                            {row.contractNumber}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.supplierName || row.supplierHint}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.collaboratorName || row.shopHint || "—"}
                        {row.isFagiano ? (
                          <span className="ml-1 text-amber-700">Fagiano</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.podRaw || (
                          <span className="text-amber-700">assente</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {row.crmPod || "—"}
                        {row.proposedPodFill ? (
                          <div className="text-sky-700">
                            → {row.proposedPodFill}
                            {row.podFillMode === "needs_confirm"
                              ? " (conferma)"
                              : ""}
                          </div>
                        ) : null}
                        {row.podFillMode === "display_from_crm" ? (
                          <div className="text-slate-500">da CRM</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.ruleAmount != null
                          ? formatCurrency(row.ruleAmount)
                          : "—"}
                        {row.ruleApplied ? (
                          <div className="text-[10px] text-slate-500">
                            regola
                            {row.units > 1 ? ` ×${row.units}` : ""}
                          </div>
                        ) : null}
                        {row.fileAmount != null &&
                        row.fileAmount !== row.ruleAmount ? (
                          <div className="text-[10px] text-slate-400">
                            file {formatCurrency(row.fileAmount)}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem] px-2 py-1.5 text-slate-600">
                        {row.matchReason}
                        {row.skipReason ? ` · ${row.skipReason}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.truncated ? (
            <p className="text-xs text-amber-700">
              Anteprima troncata alle prime {preview.rows.length} righe: i
              conteggi restano sul totale file.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "red" | "sky";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "red"
          ? "border-red-200 bg-red-50"
          : tone === "sky"
            ? "border-sky-200 bg-sky-50"
            : "border-slate-200 bg-white";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
