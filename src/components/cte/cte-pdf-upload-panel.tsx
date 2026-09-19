"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { CTE_PDF_MAX_BYTES, CTE_PDF_MAX_FILES } from "@/lib/cte-form-schema";
import type { CtePdfParseResult } from "@/lib/cte-pdf-parse";
import type { CtePdfQueueItem } from "@/lib/cte-pdf-queue";
import { queueProgressLabel, queueStatusLabel } from "@/lib/cte-pdf-queue";

export type CtePdfParsePayload = {
  filename: string;
  totalPages: number;
  supplierId: string | null;
  supplierMatchName: string | null;
  extracted: CtePdfParseResult;
  textPreview: string;
  file: File;
};

export async function parseCtePdfClient(
  file: File,
): Promise<
  | { ok: true; kind: "single"; payload: CtePdfParsePayload }
  | { ok: true; kind: "listino"; payloads: CtePdfParsePayload[] }
  | { ok: false; error: string }
> {
  if (file.size > CTE_PDF_MAX_BYTES) {
    return { ok: false, error: `File troppo grande (max ${CTE_PDF_MAX_BYTES / (1024 * 1024)} MB)` };
  }
  try {
    const fd = new FormData();
    fd.set("pdfFile", file);
    const res = await fetch("/api/catalogo-cte/parse-pdf", { method: "POST", body: fd });
    const data = (await res.json()) as
      | {
          ok: true;
          mode?: "single" | "listino";
          filename: string;
          totalPages: number;
          supplierId?: string | null;
          supplierMatchName?: string | null;
          extracted?: CtePdfParseResult;
          textPreview?: string;
          items?: Array<{
            filename: string;
            supplierId: string | null;
            supplierMatchName: string | null;
            extracted: CtePdfParseResult;
            textPreview: string;
          }>;
        }
      | { ok: false; error: string };
    if (!data.ok) return { ok: false, error: data.error };
    if (data.mode === "listino" && data.items?.length) {
      return {
        ok: true,
        kind: "listino",
        payloads: data.items.map((item) => ({ ...item, file, totalPages: 1 })),
      };
    }
    if (!data.extracted) {
      return { ok: false, error: "Lettura non riuscita. Compila i campi a mano." };
    }
    return {
      ok: true,
      kind: "single",
      payload: {
        filename: data.filename,
        totalPages: data.totalPages,
        supplierId: data.supplierId ?? null,
        supplierMatchName: data.supplierMatchName ?? null,
        extracted: data.extracted,
        textPreview: data.textPreview ?? "",
        file,
      },
    };
  } catch {
    return { ok: false, error: "Lettura file non riuscita. Compila i campi a mano." };
  }
}

export function CtePdfUploadPanel({
  queue,
  currentIndex,
  parsePending,
  parseError,
  onSelectFiles,
  onRetry,
  onSkip,
}: {
  queue: CtePdfQueueItem[];
  currentIndex: number;
  parsePending: boolean;
  parseError: string | null;
  onSelectFiles: (files: File[]) => void;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currentRaw = queue[currentIndex] ?? null;
  const current =
    currentRaw && currentRaw.status !== "saved" && currentRaw.status !== "skipped"
      ? currentRaw
      : null;
  const total = queue.length;
  const savedCount = queue.filter((item) => item.status === "saved").length;

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <h2 className="font-semibold text-slate-900">1. PDF della CTE</h2>
      <p className="mt-1 text-sm text-slate-600">
        Seleziona uno o più fogli CTE (PDF) o screenshot di listino (PNG/JPG). Per ogni file:
        lettura, controllo, salvataggio; poi il successivo. Da Dolomiti, Enel Corporate, SEV Iren o
        Compara si creano più offerte in coda. I numeri non trovati restano vuoti. Max {CTE_PDF_MAX_BYTES / (1024 * 1024)}{" "}
        MB a file, fino a {CTE_PDF_MAX_FILES} file.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg"
          multiple
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (list.length) onSelectFiles(list);
          }}
        />
        {current ? (
          <Button type="button" variant="secondary" size="sm" disabled={parsePending} onClick={onRetry}>
            {parsePending ? "Lettura…" : "Rileggi PDF"}
          </Button>
        ) : null}
        {current && (current.status === "error" || current.status === "review") && total > 1 ? (
          <Button type="button" variant="secondary" size="sm" disabled={parsePending} onClick={onSkip}>
            Salta questo file
          </Button>
        ) : null}
      </div>
      {current ? (
        <p className="mt-2 text-sm text-slate-700">
          In lavorazione: <span className="font-medium">{current.file.name}</span>
          {total > 1 ? ` — ${queueProgressLabel(currentIndex, total)}` : null}
          {parsePending ? " — analisi in corso…" : null}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Nessun PDF in coda. Puoi anche compilare a mano.</p>
      )}
      {total > 0 ? (
        <ol className="mt-3 space-y-1 rounded-lg border border-emerald-100 bg-white/80 p-3 text-sm">
          {queue.map((item, index) => {
            const active = index === currentIndex;
            return (
              <li
                key={`${item.file.name}-${item.file.size}-${index}`}
                className={`flex flex-wrap items-baseline justify-between gap-2 rounded-md px-2 py-1 ${
                  active ? "bg-emerald-100 font-medium text-slate-900" : "text-slate-700"
                }`}
              >
                <span className="min-w-0 truncate">
                  {index + 1}. {item.listinoPrefill?.extracted.offerName || item.file.name}
                  {item.savedOfferName ? ` → ${item.savedOfferName}` : null}
                </span>
                <span
                  className={
                    item.status === "saved"
                      ? "text-emerald-800"
                      : item.status === "error"
                        ? "text-red-700"
                        : item.status === "skipped"
                          ? "text-slate-500"
                          : "text-slate-600"
                  }
                >
                  {queueStatusLabel(item.status)}
                </span>
              </li>
            );
          })}
          {savedCount > 0 ? (
            <li className="pt-1 text-xs text-slate-500">
              Salvate {savedCount} di {total}
            </li>
          ) : null}
        </ol>
      ) : null}
      {parseError ? (
        <div className="mt-3">
          <PersistentAlert title="PDF" messages={[parseError]} tone="error" />
        </div>
      ) : null}
    </section>
  );
}

export function CtePdfParseReview({
  payload,
}: {
  payload: CtePdfParsePayload;
}) {
  const { extracted, totalPages, supplierMatchName, textPreview } = payload;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">2. Controlla i valori letti</h2>
      <p className="mt-1 text-sm text-slate-600">
        {payload.filename} · {totalPages} {totalPages === 1 ? "pagina" : "pagine"} · layout{" "}
        {extracted.layout}
        {supplierMatchName ? ` · fornitore abbinato: ${supplierMatchName}` : " · fornitore da selezionare"}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Compilati dal PDF
          </p>
          {extracted.filledFieldLabels.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nessun campo riconosciuto.</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
              {extracted.hits.map((h, i) => (
                <li key={`${h.field}-${i}`}>
                  <span className="font-medium">{h.label}:</span> {h.value}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Da completare a mano
          </p>
          {extracted.emptyFieldLabels.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Tutti i campi catalogo hanno un valore letto.</p>
          ) : (
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
              {extracted.emptyFieldLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {extracted.warnings.length ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-amber-900">
          {extracted.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Testo letto dal PDF
        </summary>
        <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          {textPreview || "—"}
        </p>
      </details>
    </section>
  );
}
