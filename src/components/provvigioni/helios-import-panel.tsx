"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyHeliosProvvigioniAction,
  previewHeliosProvvigioniAction,
} from "@/lib/helios-provvigioni-import";
import {
  guessCompetenceFromFilename,
  HELIOS_IMPORT_STATUS_LABEL,
  type HeliosImportPreviewRow,
} from "@/lib/helios-provvigioni-shared";
import { periodLabel, toPeriod } from "@/lib/recurring";
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
    reader.onerror = () => reject(reader.error ?? new Error("Lettura file fallita"));
    reader.readAsDataURL(file);
  });
}

function monthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(toPeriod(d));
  }
  return out;
}

const STATUS_LABEL = HELIOS_IMPORT_STATUS_LABEL;

export function HeliosImportPanel({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const months = useMemo(() => monthOptions(), []);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);
  const [fileKey, setFileKey] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [competencePeriod, setCompetencePeriod] = useState(
    () => months.find((m) => m.endsWith("-04")) ?? months[0] ?? toPeriod(new Date()),
  );
  const [settledPeriod, setSettledPeriod] = useState(competencePeriod);
  const [multiMonth, setMultiMonth] = useState(false);
  const [competencePeriods, setCompetencePeriods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<HeliosImportPreviewRow[] | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    willPay: number;
    alreadyPaid: number;
    notFound: number;
    ambiguous: number;
    podsToUpdate: number;
  } | null>(null);

  async function onFileChange(file: File | null) {
    setError(null);
    setMessage(null);
    setPreview(null);
    setSummary(null);
    if (!file) {
      setFileName("");
      setFileB64(null);
      setMultiMonth(false);
      setCompetencePeriods([]);
      return;
    }
    setFileName(file.name);
    const b64 = await fileToBase64(file);
    setFileB64(b64);
    const guessed = guessCompetenceFromFilename(file.name);
    if (guessed) {
      setCompetencePeriod(guessed);
      setSettledPeriod(guessed);
    }
  }

  function buildFd(): FormData {
    const fd = new FormData();
    if (fileB64) fd.set("fileBase64", fileB64);
    fd.set("fileName", fileName);
    fd.set("competencePeriod", competencePeriod);
    fd.set("settledPeriod", settledPeriod);
    return fd;
  }

  function runPreview() {
    if (!fileB64) {
      setError("Seleziona prima il file Excel Helios (.xlsx)");
      return;
    }
    setError(null);
    setMessage(null);
    start(async () => {
      const res = await previewHeliosProvvigioniAction(buildFd());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCompetencePeriod(res.competencePeriod);
      setSettledPeriod(res.settledPeriod);
      setMultiMonth(res.multiMonth);
      setCompetencePeriods(res.competencePeriods);
      setPreview(res.rows);
      setSummary(res.summary);
      const mesiLabel = res.multiMonth
        ? `mesi ${res.competencePeriods.map(periodLabel).join(", ")}`
        : `competenza ${periodLabel(res.competencePeriod)}`;
      setMessage(
        `Anteprima (${mesiLabel}): ${res.summary.willPay} da incassare · ${res.summary.alreadyPaid} già incassati · ${res.summary.notFound} non trovati · ${res.summary.ambiguous} ambigui` +
          (res.summary.podsToUpdate > 0
            ? ` · ${res.summary.podsToUpdate} POD da aggiornare`
            : ""),
      );
    });
  }

  function runApply() {
    if (!fileB64 || !preview) {
      setError("Fai prima l’anteprima");
      return;
    }
    if (
      !window.confirm(
        `Segnare come INCASSATI ${summary?.willPay ?? 0} mesi (pagamento dal fornitore)?\n` +
          `Lo stato «Pagato» al collaboratore lo imposti tu dopo in Provvigioni.\n` +
          (multiMonth
            ? `Competenze: ${competencePeriods.map(periodLabel).join(", ")}\n`
            : `Competenza ${periodLabel(competencePeriod)}\n`) +
          `Rendiconto / bonifico fornitore: ${periodLabel(settledPeriod)}`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    start(async () => {
      const res = await applyHeliosProvvigioniAction(buildFd());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        `Import ok: ${res.collected} mesi segnati incassati · ${res.skippedCollected} già incassati · ${res.notFound} non trovati · ${res.ambiguous} ambigui` +
          (res.podsUpdated > 0 ? ` · ${res.podsUpdated} POD aggiornati` : ""),
      );
      setPreview(null);
      setSummary(null);
      setFileB64(null);
      setFileName("");
      setFileKey((k) => k + 1);
      router.refresh();
    });
  }

  const notFoundRows = preview?.filter((r) => r.status === "not_found") ?? [];
  const displayRows = preview ?? [];

  const form = (
    <div className="space-y-3">
      <p className="rounded-lg border border-sky-200 bg-white/80 px-3 py-2 text-xs text-sky-950">
        <strong>Flusso:</strong> il rendiconto del fornitore porta le provvigioni da{" "}
        <em>Da incassare</em> a <em>Incassato</em> (tu hai ricevuto da Helios). Lo stato{" "}
        <em>Pagato</em> lo usi solo quando liquidi il collaboratore, in Provvigioni.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="File Excel Helios (.xlsx)">
          <Input
            key={fileKey}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
          {fileName ? (
            <p className="mt-1 truncate text-xs text-slate-600">{fileName}</p>
          ) : null}
        </Field>
        <Field label="Mese competenza (gettone)">
          <Select
            value={competencePeriod}
            onChange={(e) => {
              setCompetencePeriod(e.target.value);
              setPreview(null);
              setMultiMonth(false);
            }}
            disabled={multiMonth}
            title={
              multiMonth
                ? "File multi-mese: la competenza è letta dalla colonna Inizio di ogni riga"
                : undefined
            }
          >
            {!months.includes(competencePeriod) ? (
              <option value={competencePeriod}>
                {periodLabel(competencePeriod)}
              </option>
            ) : null}
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
          {multiMonth ? (
            <p className="mt-1 text-[11px] text-sky-800">
              File multi-mese rilevato:{" "}
              {competencePeriods.map(periodLabel).join(" · ")}. Competenza dal{" "}
              <strong>nome di ogni foglio</strong> (es. Gennaio 2026).
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              Nei file mensili la competenza è il mese del rendiconto (dal nome file o
              dalla selezione sopra), non la colonna Inizio fornitura.
            </p>
          )}
        </Field>
        <Field label="Mese rendiconto fornitore">
          <Select
            value={settledPeriod}
            onChange={(e) => {
              setSettledPeriod(e.target.value);
              setPreview(null);
            }}
          >
            {!months.includes(settledPeriod) ? (
              <option value={settledPeriod}>{periodLabel(settledPeriod)}</option>
            ) : null}
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || !fileB64}
          onClick={runPreview}
        >
          {pending ? "Attendere…" : "Anteprima"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || !preview || (summary?.willPay ?? 0) === 0}
          onClick={runApply}
        >
          Conferma e segna incassati
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {summary ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
            Totale file: {summary.total}
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">
            Da incassare: {summary.willPay}
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">
            Già incassati: {summary.alreadyPaid}
          </span>
          <span className="rounded-full bg-red-100 px-2 py-1 text-red-900">
            Non trovati: {summary.notFound}
          </span>
          <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-900">
            Ambigui: {summary.ambiguous}
          </span>
          {summary.podsToUpdate > 0 ? (
            <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-900">
              POD da aggiornare: {summary.podsToUpdate}
            </span>
          ) : null}
        </div>
      ) : null}

      {preview && displayRows.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white text-xs">
          <table className="min-w-full">
            <thead className="sticky top-0 bg-slate-50 text-left">
              <tr>
                <th className="px-2 py-1">POD</th>
                <th className="px-2 py-1">Competenza</th>
                <th className="px-2 py-1">Nome (file)</th>
                <th className="px-2 py-1">Nome (CRM)</th>
                <th className="px-2 py-1">€</th>
                <th className="px-2 py-1">Esito</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.slice(0, 80).map((r) => (
                <tr
                  key={`${r.excelRow}-${r.pod}-${r.competencePeriod}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-2 py-1 font-mono">{r.pod}</td>
                  <td className="px-2 py-1">{periodLabel(r.competencePeriod)}</td>
                  <td className="px-2 py-1">{r.intestatario || "—"}</td>
                  <td className="px-2 py-1">
                    {r.clientName ?? "—"}
                    {r.willUpdatePod ? (
                      <span className="ml-1 text-[10px] text-blue-700">
                        +POD
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1">{r.baseAmount || "—"}</td>
                  <td className="px-2 py-1">{STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length > 80 ? (
            <p className="border-t border-slate-100 px-2 py-1 text-slate-500">
              … e altri {displayRows.length - 80}
            </p>
          ) : null}
        </div>
      ) : null}

      {notFoundRows.length > 0 ? (
        <details className="text-xs text-red-900">
          <summary className="cursor-pointer font-medium">
            POD non trovati nel CRM ({notFoundRows.length})
          </summary>
          <ul className="mt-1 max-h-32 list-inside list-disc overflow-auto">
            {notFoundRows.map((r) => (
              <li key={`nf-${r.excelRow}`}>
                <span className="font-mono">{r.pod}</span> — {r.intestatario || "?"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );

  if (embedded) return form;

  return (
    <div className="rounded-xl border-2 border-sky-300 bg-sky-50 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-sky-950">
            Importa rendiconto Helios
          </p>
          <p className="text-xs text-sky-900/80">
            Carica il file Excel del fornitore (es. Provvigioni_Aprile_2026_…) per segnare i
            mesi <strong>incassati</strong> per POD. Non liquida i collaboratori.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Chiudi" : "Apri"}
        </Button>
      </div>
      {open ? <div className="mt-3 border-t border-sky-200 pt-3">{form}</div> : null}
    </div>
  );
}
