"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Item = { id: string; label: string; [key: string]: unknown };

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
}: {
  label: string;
  placeholder: string;
  endpoint: string;
  required?: boolean;
  onSelect: (item: Item) => void;
  onClear?: () => void;
  selectedLabel?: string;
  createLabel: string;
  onCreate: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data: { items?: Item[] }) => setItems(data.items ?? []))
        .catch(() => setItems([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, endpoint]);

  return (
    <div className="relative space-y-1">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      {selectedLabel ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-900">{selectedLabel}</span>
          <button
            type="button"
            className="text-xs text-slate-600 underline"
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
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && (query.trim().length >= 2 || items.length > 0) ? (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    onSelect(item);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className={cn(
                  "block w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50",
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
