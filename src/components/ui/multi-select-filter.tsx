"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type MultiSelectOption = {
  value: string;
  label: string;
};

/**
 * Tendina multi-selezione per form GET (Report, ecc.).
 * Scrive i valori scelti in un input hidden (separati da `|`).
 * Premi «Applica filtri» sul form per ricaricare.
 */
export function MultiSelectFilter({
  name,
  options,
  initialValues = [],
  emptyLabel = "Tutti",
  className,
}: {
  name: string;
  options: MultiSelectOption[];
  /** Valori già selezionati (da URL) */
  initialValues?: string[];
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialValues.filter(Boolean)),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(new Set(initialValues.filter(Boolean)));
  }, [initialValues.join("|")]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary = useMemo(() => {
    if (selected.size === 0) return emptyLabel;
    const labels = options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label);
    if (labels.length <= 2) return labels.join(" + ");
    return `${labels.length} selezionati`;
  }, [selected, options, emptyLabel]);

  const hiddenValue = [...selected].join("|");

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input type="hidden" name={name} value={hiddenValue} />
      <button
        type="button"
        className={cn(
          "flex w-full min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-base text-slate-900 outline-none ring-emerald-500 focus:ring-2 sm:min-h-0 sm:py-2 sm:text-sm",
          selected.size > 0 && "border-emerald-500 ring-1 ring-emerald-400",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{summary}</span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Spunta una o più opzioni, poi premi «Applica filtri».
          </p>
          <div className="mb-2 flex gap-2 text-xs">
            <button
              type="button"
              className="text-emerald-700"
              onClick={() =>
                setSelected(new Set(options.map((o) => o.value)))
              }
            >
              Tutti
            </button>
            <button
              type="button"
              className="text-slate-500"
              onClick={() => setSelected(new Set())}
            >
              Nessuno
            </button>
          </div>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span className="truncate text-sm">{o.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
