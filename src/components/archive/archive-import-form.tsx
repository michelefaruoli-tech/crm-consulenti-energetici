"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  importHistoricalExcelAction,
  previewHistoricalExcelAction,
  type ArchivePreviewRow,
} from "@/lib/archive-actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

type CollaboratorOption = { id: string; name: string; email: string };

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

  function buildFd(form: HTMLFormElement): FormData {
    return new FormData(form);
  }

  function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await previewHistoricalExcelAction(buildFd(form));
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
    });
  }

  function onCommit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!previewRows) {
      setError("Prima fai l’anteprima, poi conferma l’import.");
      return;
    }
    const importable = previewRows.filter((r) => !r.skip && r.status !== "error").length;
    if (importable === 0) {
      setError("Nessuna riga da importare. Correggi il file o i filtri.");
      return;
    }
    if (
      !window.confirm(
        `Confermi l’import di ${importable} contratti nel lotto «${previewLabel}»?`,
      )
    ) {
      return;
    }
    const form = e.currentTarget;
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await importHistoricalExcelAction(buildFd(form));
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(
        `Importati ${result.imported ?? 0} contratti` +
          (result.skipped ? ` · saltati ${result.skipped}` : "") +
          ` nel lotto «${result.label}».`,
      );
      setPreviewRows(null);
      setSummary(null);
      setFileKey((k) => k + 1);
      form.reset();
      router.refresh();
    });
  }

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
          />
        </Field>
        <Field label="File Excel (.xlsx)">
          <Input name="file" type="file" accept=".xlsx,.xls" required />
        </Field>
        <Field label="Collaboratore di default *">
          <Select name="defaultCollaboratorId" defaultValue={defaultCollaboratorId} required>
            {collaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.email})
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:pb-2">
          <input type="checkbox" name="skipPodDuplicates" value="1" defaultChecked />
          Salta righe con POD/PDR già presente (o doppio nel file)
        </label>

        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={(ev) => {
              const form = (ev.target as HTMLElement).closest("form");
              if (form) onPreview({ preventDefault() {}, currentTarget: form } as React.FormEvent<HTMLFormElement>);
            }}
          >
            {pending ? "Analisi…" : "1. Anteprima"}
          </Button>
          <Button type="submit" disabled={pending || !previewRows}>
            {pending ? "Import…" : "2. Conferma import"}
          </Button>
        </div>
      </form>

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

      {previewRows && previewRows.length > 0 ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Riga</th>
                <th className="px-2 py-1.5">Stato</th>
                <th className="px-2 py-1.5">Cliente</th>
                <th className="px-2 py-1.5">POD</th>
                <th className="px-2 py-1.5">Collab.</th>
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
