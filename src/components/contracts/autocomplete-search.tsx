"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type AutocompleteItem = {
  id: string;
  label: string;
  sublabel?: string;
  [key: string]: unknown;
};

export function AutocompleteSearch({
  label,
  placeholder,
  endpoint,
  required,
  onSelect,
  onClear,
  selectedLabel,
  createLabel,
  onCreate,
  helpText,
}: {
  label: string;
  placeholder: string;
  endpoint: string;
  required?: boolean;
  onSelect: (item: AutocompleteItem) => void;
  onClear?: () => void;
  selectedLabel?: string;
  createLabel: string;
  onCreate: (query: string) => void;
  /** Testo di aiuto sotto il campo */
  helpText?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      void fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data: { items?: AutocompleteItem[] }) => {
          setItems(data.items ?? []);
          setLoading(false);
        })
        .catch(() => {
          setItems([]);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query, endpoint]);

  return (
    <div className="relative space-y-1">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      {helpText ? <p className="text-xs text-slate-500">{helpText}</p> : null}
      {selectedLabel ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-900">{selectedLabel}</span>
          <button
            type="button"
            className="shrink-0 text-xs text-slate-600 underline"
            onClick={() => {
              onClear?.();
              setQuery("");
            }}
          >
            Cambia
          </button>
        </div>
      ) : (
        <>
          <input
            className="w-full min-h-11 rounded-lg border border-slate-200 px-3 py-2.5 text-base sm:min-h-0 sm:py-2 sm:text-sm"
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && query.trim().length >= 2 ? (
            <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {loading ? (
                <p className="px-3 py-2 text-sm text-slate-500">Ricerca in corso…</p>
              ) : null}
              {!loading && items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">
                  Nessun cliente trovato in anagrafica.
                </p>
              ) : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full border-b border-slate-50 px-3 py-2.5 text-left hover:bg-emerald-50 sm:py-2"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="block text-sm font-semibold text-slate-900">
                    {item.label}
                  </span>
                  {item.sublabel ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {item.sublabel}
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className={cn(
                  "block w-full border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50",
                )}
                onClick={() => {
                  onCreate(query.trim());
                  setOpen(false);
                }}
              >
                {createLabel}
                {query.trim() ? `: “${query.trim()}”` : ""}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
