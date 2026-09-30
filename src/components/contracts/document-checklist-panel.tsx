"use client";

import { cn } from "@/lib/cn";
import type { ChecklistCoverage } from "@/lib/document-checklist";

/** Checklist documenti configurabile (P1.4) — stato copertura + mancanti. */
export function DocumentChecklistPanel({
  coverage,
  requireForBackOffice,
  /** true se c’è già almeno un allegato (invio BO permesso anche con checklist incompleta) */
  hasAttachments = false,
}: {
  coverage: ChecklistCoverage;
  requireForBackOffice: boolean;
  hasAttachments?: boolean;
}) {
  const showMissing = requireForBackOffice && !coverage.requiredComplete;
  const canSendDespiteMissing = showMissing && hasAttachments;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"
      data-testid="document-checklist"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Checklist documenti
        </p>
        <span className="text-xs font-medium text-slate-600">
          {coverage.requiredPresent}/{coverage.requiredTotal} obbligatori
          {coverage.recommendedTotal > 0
            ? ` · ${coverage.recommendedPresent}/${coverage.recommendedTotal} consigliati`
            : ""}
        </span>
      </div>

      {canSendDespiteMissing ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950 ring-1 ring-amber-200">
          Mancano ancora:{" "}
          <strong>{coverage.missingRequiredLabels.join(", ")}</strong>
          {" — "}puoi comunque inviare al Back Office; verranno segnalati per
          integrazione.
        </p>
      ) : null}

      {showMissing && !hasAttachments ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950 ring-1 ring-amber-200">
          Consigliati per il Back Office:{" "}
          <strong>{coverage.missingRequiredLabels.join(", ")}</strong>
          {" — "}per inviare allega almeno un file (anche se non è in checklist).
        </p>
      ) : null}

      {requireForBackOffice && coverage.requiredComplete ? (
        <p className="mb-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 ring-1 ring-emerald-200">
          Documenti obbligatori presenti — puoi inviare al Back Office.
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {coverage.items.map((item) => (
          <li
            key={item.docType}
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm",
              item.present
                ? "bg-emerald-50 text-emerald-900"
                : item.required
                  ? "bg-white text-slate-800 ring-1 ring-amber-200"
                  : "bg-white text-slate-600 ring-1 ring-slate-200",
            )}
          >
            <span>
              <span aria-hidden className="mr-1.5">
                {item.present ? "✓" : item.required ? "!" : "○"}
              </span>
              {item.label}
              {item.required ? (
                <span className="ml-1 text-[10px] font-semibold uppercase text-amber-800">
                  checklist
                </span>
              ) : item.recommended ? (
                <span className="ml-1 text-[10px] font-semibold uppercase text-slate-500">
                  consigliato
                </span>
              ) : null}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {item.docType}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
