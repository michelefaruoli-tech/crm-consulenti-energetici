"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { CTE_PDF_MAX_BYTES } from "@/lib/cte-form-schema";
import type { CtePdfParseResult } from "@/lib/cte-pdf-parse";

export type CtePdfParsePayload = {
  filename: string;
  totalPages: number;
  supplierId: string | null;
  supplierMatchName: string | null;
  extracted: CtePdfParseResult;
  textPreview: string;
  file: File;
};

export function CtePdfUploadPanel({
  onParsed,
  file,
  onFile,
}: {
  onParsed: (payload: CtePdfParsePayload) => void;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function parseFile(next: File) {
    setError(null);
    if (next.size > CTE_PDF_MAX_BYTES) {
      setError(`PDF troppo grande (max ${CTE_PDF_MAX_BYTES / (1024 * 1024)} MB)`);
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("pdfFile", next);
      const res = await fetch("/api/catalogo-cte/parse-pdf", { method: "POST", body: fd });
      const data = (await res.json()) as
        | {
            ok: true;
            filename: string;
            totalPages: number;
            supplierId: string | null;
            supplierMatchName: string | null;
            extracted: CtePdfParseResult;
            textPreview: string;
          }
        | { ok: false; error: string };
      if (!data.ok) {
        setError(data.error);
        return;
      }
      onParsed({ ...data, file: next });
    } catch {
      setError("Lettura PDF non riuscita. Compila i campi a mano.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <h2 className="font-semibold text-slate-900">1. PDF della CTE</h2>
      <p className="mt-1 text-sm text-slate-600">
        Carica il foglio CTE del fornitore. Viene letto il testo del PDF (nessun OCR). I campi
        riconosciuti si compilano da soli; quelli assenti restano vuoti.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            onFile(next);
            if (next) void parseFile(next);
          }}
        />
        {file ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void parseFile(file)}
          >
            {pending ? "Lettura…" : "Rileggi PDF"}
          </Button>
        ) : null}
      </div>
      {file ? (
        <p className="mt-2 text-sm text-slate-700">
          File: <span className="font-medium">{file.name}</span>
          {pending ? " — analisi in corso…" : null}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <PersistentAlert title="PDF" messages={[error]} tone="error" />
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
