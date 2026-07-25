"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  importHistoricalExcelBatchAction,
  previewHistoricalExcelAction,
  type ArchivePreviewRow,
} from "@/lib/archive-actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

type CollaboratorOption = { id: string; name: string; email: string };

const BATCH_SIZE = 40;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // data:application/...;base64,XXXX
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Lettura file fallita"));
    reader.readAsDataURL(file);
  });
}

export function ArchiveImportForm({
  collaborators,
  defaultCollaboratorId,
}: {
  collaborators: CollaboratorOption[];
  defaultCollaboratorId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<ArchivePreviewRow[] | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string>("");
  const [summary, setSummary] = useState<{
    ok: number;
    warning: number;
    error: number;
    total: number;
  } | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [progress, setProgress] = useState<{
    percent: number;
    done: number;
    total: number;
    imported: number;
    skipped: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  /** File in base64: non si perde tra un lotto e l'altro */
  const [cachedFileB64, setCachedFileB64] = useState<string | null>(null);
  const [collabId, setCollabId] = useState(() => {
    const vizzino = collaborators.find((c) =>
      c.name.toLowerCase().includes("vizzino"),
    );
    return vizzino?.id ?? defaultCollaboratorId;
  });

  async function cacheFileFromForm(form: HTMLFormElement): Promise<string | null> {
    if (cachedFileB64) return cachedFileB64;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) return null;
    const b64 = await fileToBase64(file);
    setCachedFileB64(b64);
    return b64;
  }

  /** Costruisce FormData e forza sempre collaboratore (i campi disabled non entrano nel form). */
  function buildImportFd(
    form: HTMLFormElement,
    extra?: { fileBase64?: string; rowNumbers?: number[]; finalize?: boolean },
  ): FormData {
    const fd = new FormData(form);
    const fromSelect = String(fd.get("defaultCollaboratorId") ?? "").trim();
    fd.set("defaultCollaboratorId", fromSelect || collabId || defaultCollaboratorId);
    if (extra?.fileBase64) fd.set("fileBase64", extra.fileBase64);
    if (extra?.rowNumbers) fd.set("rowNumbers", JSON.stringify(extra.rowNumbers));
    if (extra?.finalize) fd.set("finalize", "1");
    return fd;
  }

  function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setMessage(null);
    setProgress(null);
    setInterrupted(false);
    start(async () => {
      try {
        const b64 = await cacheFileFromForm(form);
        if (!b64) {
          setError("Seleziona un file Excel (.xlsx)");
          return;
        }
        const fd = buildImportFd(form, { fileBase64: b64 });
        const result = await previewHistoricalExcelAction(fd);
        if (result.error) {
          setPreviewRows(null);
          setSummary(null);
          setError(result.error);
          return;
        }
        setPreviewRows(result.rows ?? []);
        setPreviewLabel(result.label ?? "");
        setSummary(result.summary ?? null);
        setMessage(
          `Anteprima «${result.label}»: ${result.summary?.ok ?? 0} ok · ${result.summary?.warning ?? 0} avvisi · ${result.summary?.error ?? 0} errori/saltate`,
        );
      } catch (err) {
        setPreviewRows(null);
        setSummary(null);
        const msg = err instanceof Error ? err.message : "Errore sconosciuto";
        setError(
          msg.includes("fetch")
            ? "Connessione interrotta in anteprima. Riprova tra poco."
            : msg,
        );
      }
    });
  }

  async function runImportWithProgress(form: HTMLFormElement) {
    if (!previewRows) {
      setError("Prima fai l’anteprima, poi conferma l’import.");
      return;
    }
    const rowNumbers = previewRows
      .filter((r) => !r.skip && r.status !== "error")
      .map((r) => r.row);
    if (rowNumbers.length === 0) {
      setError("Nessuna riga da importare. Correggi il file o i filtri.");
      return;
    }

    let fileB64 = cachedFileB64;
    if (!fileB64) {
      fileB64 = await cacheFileFromForm(form);
    }
    if (!fileB64) {
      setError("Seleziona di nuovo il file Excel, poi rifai Anteprima e Conferma.");
      return;
    }

    const draft = buildImportFd(form);
    const archiveLabel =
      String(draft.get("archiveLabel") ?? "").trim() || previewLabel || "Storico";
    const resolvedCollab =
      String(draft.get("defaultCollaboratorId") ?? "").trim() ||
      collabId ||
      defaultCollaboratorId;
    if (!resolvedCollab) {
      setError("Scegli il collaboratore di default (es. Vizzino).");
      return;
    }
    const skipDup =
      (form.elements.namedItem("skipPodDuplicates") as HTMLInputElement | null)
        ?.checked ?? true;

    if (
      !window.confirm(
        `Confermi l’import di ${rowNumbers.length} contratti nel lotto «${archiveLabel}»?\n\nLa barra andrà avanti a pacchetti di ${BATCH_SIZE} fino al 100%.`,
      )
    ) {
      return;
    }

    function makeBatchFd(slice: number[], finalize: boolean): FormData {
      const fd = new FormData();
      fd.set("archiveLabel", archiveLabel);
      fd.set("defaultCollaboratorId", resolvedCollab);
      if (skipDup) fd.set("skipPodDuplicates", "1");
      fd.set("fileBase64", fileB64!);
      fd.set("rowNumbers", JSON.stringify(slice));
      if (finalize) fd.set("finalize", "1");
      return fd;
    }

    setError(null);
    setMessage(null);
    setInterrupted(false);
    setImporting(true);
    setProgress({
      percent: 0,
      done: 0,
      total: rowNumbers.length,
      imported: 0,
      skipped: 0,
    });

    let imported = 0;
    let skipped = 0;
    let label = archiveLabel;
    let failed = false;
    let lastPercent = 0;

    try {
      for (let i = 0; i < rowNumbers.length; i += BATCH_SIZE) {
        const slice = rowNumbers.slice(i, i + BATCH_SIZE);
        const isLast = i + BATCH_SIZE >= rowNumbers.length;
        const batch = await importHistoricalExcelBatchAction(
          makeBatchFd(slice, isLast),
        );
        if (batch.error) {
          setError(batch.error);
          setInterrupted(true);
          failed = true;
          break;
        }
        imported += batch.batchImported;
        skipped += batch.batchSkipped;
        label = batch.label ?? label;
        const done = Math.min(i + slice.length, rowNumbers.length);
        lastPercent = Math.round((done / rowNumbers.length) * 100);
        setProgress({
          percent: lastPercent,
          done,
          total: rowNumbers.length,
          imported,
          skipped,
        });
      }

      if (failed) {
        setMessage(
          `Import interrotto a ${lastPercent}%: salvati ${imported} contratti` +
            (skipped ? ` · saltati ${skipped}` : "") +
            ` (lotto «${label}»). Rifai Anteprima+Conferma con «Salta POD già presenti» per continuare.`,
        );
      } else {
        setProgress((p) => (p ? { ...p, percent: 100, done: p.total } : p));
        setMessage(
          `Import completato al 100%: ${imported} contratti` +
            (skipped ? ` · saltati ${skipped}` : "") +
            ` nel lotto «${label}».`,
        );
        setPreviewRows(null);
        setSummary(null);
        setCachedFileB64(null);
        setFileKey((k) => k + 1);
        form.reset();
        router.refresh();
      }
    } catch (err) {
      setInterrupted(true);
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      setError(
        msg.includes("fetch")
          ? `Connessione interrotta al ${lastPercent}%. Già salvati ${imported}. Rifai con «Salta POD già presenti».`
          : msg,
      );
      setMessage(`Import parziale: ${imported} contratti nel lotto «${label}».`);
    } finally {
      setImporting(false);
    }
  }

  function onCommit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void runImportWithProgress(e.currentTarget);
  }

  const busy = pending || importing;

  return (
    <div className="space-y-4">
      <form
        key={fileKey}
        onSubmit={onCommit}
        className="grid gap-4 md:grid-cols-2 md:items-end"
      >
        <Field label="Nome lotto / database">
          <Input
            name="archiveLabel"
            required
            placeholder="Es. Pagati 2024 - Enel"
            defaultValue=""
            disabled={busy}
          />
        </Field>
        <Field label="File Excel (.xlsx)">
          <Input
            name="file"
            type="file"
            accept=".xlsx,.xls"
            required
            disabled={busy}
            onChange={() => setCachedFileB64(null)}
          />
        </Field>
        <Field label="Collaboratore di default *">
          <Select
            name="defaultCollaboratorId"
            value={collabId}
            required
            disabled={busy}
            onChange={(e) => setCollabId(e.target.value)}
          >
            {collaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.email})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:pb-2">
          <input
            type="checkbox"
            name="skipPodDuplicates"
            value="1"
            defaultChecked
            disabled={busy}
          />
          Salta righe con POD/PDR già presente (o doppio nel file)
        </label>

        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={(ev) => {
              const form = (ev.target as HTMLElement).closest("form");
              if (form) {
                onPreview({
                  preventDefault() {},
                  currentTarget: form,
                } as React.FormEvent<HTMLFormElement>);
              }
            }}
          >
            {pending && !importing ? "Analisi…" : "1. Anteprima"}
          </Button>
          <Button type="submit" disabled={busy || !previewRows}>
            {importing ? `Import… ${progress?.percent ?? 0}%` : "2. Conferma import"}
          </Button>
        </div>
      </form>

      {progress ? (
        <div
          className={`rounded-xl border p-4 ${
            interrupted
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div
            className={`mb-2 flex items-center justify-between text-sm ${
              interrupted ? "text-amber-900" : "text-emerald-900"
            }`}
          >
            <span className="font-medium">
              {importing
                ? "Caricamento database in corso…"
                : interrupted
                  ? "Caricamento interrotto — puoi riprendere"
                  : "Caricamento terminato al 100%"}
            </span>
            <span className="tabular-nums font-semibold">{progress.percent}%</span>
          </div>
          <div
            className={`h-3 overflow-hidden rounded-full ${
              interrupted ? "bg-amber-100" : "bg-emerald-100"
            }`}
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                interrupted ? "bg-amber-500" : "bg-emerald-600"
              }`}
              style={{ width: `${Math.max(progress.percent, 1)}%` }}
            />
          </div>
          <p
            className={`mt-2 text-xs ${
              interrupted ? "text-amber-800" : "text-emerald-800"
            }`}
          >
            {progress.done} / {progress.total} righe · importati {progress.imported}
            {progress.skipped ? ` · saltati ${progress.skipped}` : ""}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      {summary ? (
        <p className="text-xs text-slate-500">
          Riepilogo anteprima: {summary.total} righe ·{" "}
          <span className="text-emerald-700">{summary.ok} ok</span> ·{" "}
          <span className="text-amber-700">{summary.warning} avvisi</span> ·{" "}
          <span className="text-red-700">{summary.error} errori/saltate</span>
        </p>
      ) : null}

      {previewRows && previewRows.length > 0 && !importing ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Riga</th>
                <th className="px-2 py-1.5">Stato</th>
                <th className="px-2 py-1.5">Cliente</th>
                <th className="px-2 py-1.5">POD</th>
                <th className="px-2 py-1.5">Collab.</th>
                <th className="px-2 py-1.5">Pagato</th>
                <th className="px-2 py-1.5">Gettone</th>
                <th className="px-2 py-1.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r) => (
                <tr
                  key={r.row}
                  className={
                    r.status === "error" || r.skip
                      ? "bg-red-50"
                      : r.status === "warning"
                        ? "bg-amber-50"
                        : "bg-white"
                  }
                >
                  <td className="px-2 py-1">{r.row}</td>
                  <td className="px-2 py-1 font-medium">
                    {r.skip ? "SALTA" : r.status.toUpperCase()}
                  </td>
                  <td className="px-2 py-1">{r.clientLabel}</td>
                  <td className="px-2 py-1">{r.podPdr || "—"}</td>
                  <td className="px-2 py-1">{r.collaboratorName}</td>
                  <td className="px-2 py-1">{r.paid ? "Sì" : "No"}</td>
                  <td className="px-2 py-1">{r.gettone.toFixed(2)}</td>
                  <td className="px-2 py-1 text-slate-600">
                    {r.messages.join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
