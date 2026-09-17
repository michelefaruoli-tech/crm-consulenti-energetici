"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyPayoutBatchAction,
  importPayoutFileAction,
  previewPayoutFileAction,
} from "@/lib/payout-actions";
import {
  PAYOUT_PREVIEW_STATUS_LABEL,
  payoutPreviewRowKey,
  type PayoutPreviewResult,
} from "@/lib/payout/view-types";
import { periodLabel, toPeriod } from "@/lib/recurring";
import { formatCurrency } from "@/lib/commission";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

type TemplateOption = { key: string; label: string; hint: string };

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

const STATUS_STYLE: Record<string, string> = {
  will_apply: "bg-emerald-50 text-emerald-700",
  already_applied: "bg-slate-100 text-slate-600",
  ambiguous: "bg-amber-50 text-amber-700",
  unmatched: "bg-red-50 text-red-700",
  no_amount: "bg-slate-100 text-slate-500",
};

export function PayoutImportPanel({
  templates,
}: {
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const months = useMemo(() => monthOptions(), []);
  const [pending, start] = useTransition();

  const [fileKey, setFileKey] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [settledPeriod, setSettledPeriod] = useState(
    months[0] ?? toPeriod(new Date()),
  );
  const [fallbackPeriod, setFallbackPeriod] = useState(
    months[0] ?? toPeriod(new Date()),
  );
  const [runLabel, setRunLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayoutPreviewResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<string | null>(null);

  const selectedTemplate = templates.find((t) => t.key === templateKey);

  useEffect(() => {
    if (!preview) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(preview.rows.map((row) => payoutPreviewRowKey(row))));
  }, [preview]);

  const selectedWillApply = useMemo(() => {
    if (!preview) return 0;
    return preview.rows.filter(
      (row) =>
        row.status === "will_apply" &&
        selectedKeys.has(payoutPreviewRowKey(row)),
    ).length;
  }, [preview, selectedKeys]);

  const selectedApplicableTotal = useMemo(() => {
    if (!preview) return 0;
    return preview.rows
      .filter(
        (row) =>
          row.status === "will_apply" &&
          selectedKeys.has(payoutPreviewRowKey(row)),
      )
      .reduce((sum, row) => sum + (row.amount ?? 0), 0);
  }, [preview, selectedKeys]);

  function reset() {
    setPreview(null);
    setSelectedKeys(new Set());
    setError(null);
    setDetails([]);
    setMessage(null);
    setProgress(null);
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
    fd.set("templateKey", templateKey);
    fd.set("settledPeriod", settledPeriod);
    fd.set("fallbackPeriod", fallbackPeriod);
    if (runLabel.trim()) fd.set("runLabel", runLabel.trim());
    if (selectedKeys.size > 0) {
      fd.set("selectedRowKeys", JSON.stringify([...selectedKeys]));
    }
    return fd;
  }

  function runPreview() {
    if (!fileB64) {
      setError("Seleziona prima il file Excel (.xlsx)");
      return;
    }
    reset();
    start(async () => {
      const res = await previewPayoutFileAction(buildFd());
      if (!res.ok) {
        setError(res.error);
        setDetails(res.details ?? []);
        return;
      }
      setPreview(res);
      setSettledPeriod(res.settledPeriod);
      setFallbackPeriod(res.fallbackPeriod);
    });
  }

  /** Import + applicazione a lotti: nessuna richiesta lunga, avanzamento visibile. */
  function runImportAndApply() {
    if (!preview) return;
    if (selectedWillApply === 0) {
      setError("Seleziona almeno una riga da applicare (checkbox a sinistra).");
      return;
    }
    const confirmed = window.confirm(
      [
        `Applicare ${selectedWillApply} righe selezionate per ${formatCurrency(selectedApplicableTotal)}?`,
        preview.summary.willApply > selectedWillApply
          ? `${preview.summary.willApply - selectedWillApply} righe applicabili restano escluse.`
          : null,
        "",
        `Le ${preview.summary.ambiguous} righe da confermare e le ${preview.summary.unmatched} non trovate NON verranno applicate.`,
        "L'operazione resta annullabile dalla scheda della liquidazione.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (!confirmed) return;

    reset();
    start(async () => {
      const imported = await importPayoutFileAction(buildFd());
      if (!imported.ok) {
        setError(imported.error);
        setDetails(imported.details ?? []);
        return;
      }

      let applied = 0;
      let skipped = 0;
      let errors = 0;
      let guard = 0;
      for (;;) {
        const fd = new FormData();
        fd.set("batchId", imported.batchId);
        const step = await applyPayoutBatchAction(fd);
        if (!step.ok) {
          setError(step.error);
          break;
        }
        applied += step.applied;
        skipped += step.skipped;
        errors += step.errors;
        setProgress(
          `Applicate ${applied} righe · ${step.remaining} rimanenti`,
        );
        if (step.remaining === 0) break;
        // Salvaguardia contro un ciclo che non avanza
        guard += 1;
        if (step.processed === 0 || guard > 500) break;
      }

      setMessage(
        [
          `Liquidazione aggiornata: ${applied} righe applicate`,
          skipped > 0 ? `${skipped} saltate` : null,
          errors > 0 ? `${errors} in errore` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setPreview(null);
      setFileB64(null);
      setFileName("");
      setFileKey((k) => k + 1);
      router.push(`/provvigioni/liquidazioni/${imported.runId}`);
      router.refresh();
    });
  }

  const quadratura =
    preview && preview.declaredTotal != null
      ? Math.abs(preview.computedTotal - preview.declaredTotal) < 0.01
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="File del rendiconto (.xlsx)">
          <Input
            key={fileKey}
            type="file"
            accept=".xlsx"
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Fonte / mappatura">
          <Select
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              reset();
            }}
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mese pagamento / incasso">
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
        <Field label="Mese riferimento (competenza se assente nel file)">
          <Select
            value={fallbackPeriod}
            onChange={(e) => setFallbackPeriod(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {selectedTemplate ? (
        <p className="text-xs text-slate-500">
          Riconosce: {selectedTemplate.hint}
        </p>
      ) : null}

      <Field label="Etichetta della liquidazione (opzionale)">
        <Input
          value={runLabel}
          placeholder={`Liquidazione ${periodLabel(settledPeriod)}`}
          onChange={(e) => setRunLabel(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={runPreview} disabled={pending}>
          {pending && !preview ? "Lettura…" : "Anteprima"}
        </Button>
        <Button
          onClick={runImportAndApply}
          disabled={pending || !preview || selectedWillApply === 0}
        >
          {pending && preview ? "Applicazione…" : "Importa e applica"}
        </Button>
      </div>

      {progress ? (
        <p className="text-sm text-slate-600">{progress}</p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {details.length > 0 ? (
            <p className="mt-1 text-xs">
              Colonne attese non trovate: {details.join(", ")}
            </p>
          ) : null}
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
            <Stat label="Righe lette" value={String(preview.summary.total)} />
            <Stat
              label="Da applicare"
              value={String(preview.summary.willApply)}
              tone="emerald"
            />
            <Stat
              label="Selezionate"
              value={String(selectedWillApply)}
              tone="emerald"
            />
            <Stat
              label="Da confermare"
              value={String(preview.summary.ambiguous)}
              tone="amber"
            />
            <Stat
              label="Non trovate"
              value={String(preview.summary.unmatched)}
              tone="red"
            />
            <Stat
              label="Già registrate"
              value={String(preview.summary.alreadyApplied)}
            />
            <Stat
              label="Totale selezionato"
              value={formatCurrency(selectedApplicableTotal)}
              tone="emerald"
            />
          </div>

          <p className="text-xs text-slate-600">
            Deseleziona le righe da escludere dall&apos;applicazione (checkbox a
            sinistra). Per default tutte le righe in anteprima sono selezionate.
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-slate-700">
              Totale letto dal file:{" "}
              <strong>{formatCurrency(preview.computedTotal)}</strong>
              {preview.declaredTotal != null ? (
                <>
                  {" · "}dichiarato dalla fonte:{" "}
                  <strong>{formatCurrency(preview.declaredTotal)}</strong>
                </>
              ) : null}
            </p>
            {quadratura === true ? (
              <p className="mt-1 text-emerald-700">
                I due totali coincidono: la mappatura legge il file correttamente.
              </p>
            ) : null}
            {quadratura === false ? (
              <p className="mt-1 text-red-700">
                I totali non coincidono: verifica la mappatura prima di applicare.
              </p>
            ) : null}
            {quadratura === null ? (
              <p className="mt-1 text-slate-500">
                Questa fonte non dichiara un totale: la quadratura va fatta a mano.
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              Fogli letti: {preview.sheetsRead.join(", ")}
              {preview.skippedRows.length > 0
                ? ` · ${preview.skippedRows.length} righe scartate (totali, note, importi non numerici)`
                : ""}
            </p>
          </div>

          {preview.byCollaborator.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Collaboratore</th>
                    <th className="px-3 py-2">Righe</th>
                    <th className="px-3 py-2 text-right">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.byCollaborator.map((c) => (
                    <tr key={c.collaboratorName} className="border-t border-slate-100">
                      <td className="px-3 py-2">{c.collaboratorName}</td>
                      <td className="px-3 py-2">{c.rowCount}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatCurrency(c.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">
                    <span className="sr-only">Includi</span>
                  </th>
                  <th className="px-3 py-2">Riga</th>
                  <th className="px-3 py-2">POD/PDR</th>
                  <th className="px-3 py-2">Cliente nel file</th>
                  <th className="px-3 py-2">Contratto CRM</th>
                  <th className="px-3 py-2">Competenza</th>
                  <th className="px-3 py-2 text-right">Importo</th>
                  <th className="px-3 py-2">Esito</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const key = payoutPreviewRowKey(row);
                  const checked = selectedKeys.has(key);
                  return (
                  <tr
                    key={key}
                    className={`border-t border-slate-100 ${!checked ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`Includi riga ${row.sheetName}:${row.rowIndex}`}
                        onChange={(e) => {
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.sheetName}:{row.rowIndex}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.podRaw}</td>
                    <td className="px-3 py-2">{row.clientNameRaw}</td>
                    <td className="px-3 py-2">
                      {row.crmClientName ? (
                        <span>
                          {row.crmClientName}
                          <span className="block text-xs text-slate-500">
                            {row.supplierName} · {row.collaboratorName}
                            {row.matchReason ? ` · ${row.matchReason}` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.period ? periodLabel(row.period) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.amount == null ? "—" : formatCurrency(row.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          STATUS_STYLE[row.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {PAYOUT_PREVIEW_STATUS_LABEL[row.status]}
                      </span>
                      {row.skipReason ? (
                        <span className="block text-xs text-slate-500">
                          {row.skipReason}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.truncated ? (
            <p className="text-xs text-slate-500">
              Anteprima limitata alle prime {preview.rows.length} righe; i
              conteggi si riferiscono a tutte le {preview.summary.total}.
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
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-slate-200 bg-white text-slate-800";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
