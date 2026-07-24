"use client";

import { X } from "lucide-react";

export function PersistentAlert({
  title,
  messages,
  tone = "error",
  onClose,
  onRetry,
}: {
  title: string;
  messages: string[];
  tone?: "error" | "success" | "warning";
  onClose?: () => void;
  onRetry?: () => void;
}) {
  if (!messages.length && !title) return null;

  const styles =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-red-200 bg-red-50 text-red-950";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-xl border px-4 py-3 shadow-sm ${styles}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{title}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-current/20 px-2 py-1 text-xs font-medium hover:bg-white/50"
            >
              Riprova
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi messaggio"
              className="rounded p-1 hover:bg-black/5"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
