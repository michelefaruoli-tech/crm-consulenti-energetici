"use client";

import { cn } from "@/lib/cn";
import type { CompletenessResult } from "@/lib/contract-completeness";

/** Indicatore «Contratto completo al X%». */
export function ContractCompletenessBar({
  completeness,
  compact,
}: {
  completeness: CompletenessResult;
  compact?: boolean;
}) {
  const tone =
    completeness.percent >= 100
      ? "bg-emerald-600"
      : completeness.percent >= 75
        ? "bg-sky-600"
        : completeness.percent >= 40
          ? "bg-amber-500"
          : "bg-slate-400";

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white",
        compact ? "p-3" : "p-4",
      )}
      data-testid="contract-completeness"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Completezza pratica
          </p>
          <p className="text-lg font-bold text-slate-900">
            Contratto completo al {completeness.percent}%
          </p>
          <p className="text-xs text-slate-500">{completeness.label}</p>
        </div>
        <span
          className={cn(
            "rounded-lg px-2.5 py-1 text-sm font-bold text-white",
            tone,
          )}
        >
          {completeness.percent}%
        </span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all duration-300", tone)}
          style={{ width: `${Math.min(100, Math.max(0, completeness.percent))}%` }}
        />
      </div>
      {!compact ? (
        <ul className="mt-3 grid gap-1 sm:grid-cols-2">
          {completeness.blocks.map((b) => (
            <li
              key={b.id}
              className={cn(
                "flex items-center gap-2 text-xs",
                b.ok
                  ? "text-emerald-800"
                  : completeness.canSendToBackOffice
                    ? "text-amber-800"
                    : "text-slate-500",
              )}
            >
              <span aria-hidden>{b.ok ? "✓" : completeness.canSendToBackOffice ? "!" : "○"}</span>
              {b.label}
            </li>
          ))}
        </ul>
      ) : null}
      {!compact &&
      completeness.canSendToBackOffice &&
      completeness.warningsForBackOffice.length > 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950 ring-1 ring-amber-200">
          Invio consentito con allegati.{" "}
          {completeness.warningsForBackOffice[0]}
          {completeness.warningsForBackOffice.length > 1
            ? ` (+${completeness.warningsForBackOffice.length - 1})`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
