"use client";

import { useEffect, useState } from "react";
import type { AutocompleteItem } from "@/components/contracts/autocomplete-search";

/**
 * Suggerimenti “cliente già in anagrafica” mentre digiti cognome/nome/CF.
 * Serve se non si usa la casella di ricerca in alto.
 */
export function ExistingClientHints({
  query,
  enabled,
  onPick,
}: {
  /** Testo da cercare (es. "Rossi Mario" oppure solo CF) */
  query: string;
  enabled: boolean;
  onPick: (item: AutocompleteItem) => void;
}) {
  const [items, setItems] = useState<AutocompleteItem[]>([]);

  useEffect(() => {
    if (!enabled || query.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/clients/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data: { items?: AutocompleteItem[] }) =>
          setItems((data.items ?? []).slice(0, 8)),
        )
        .catch(() => setItems([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, enabled]);

  if (!enabled || items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 ring-1 ring-amber-100">
      <p className="mb-1.5 text-xs font-medium text-amber-950">
        Cliente già in anagrafica? Seleziona per compilare tutto in automatico:
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="w-full rounded-md bg-white px-2.5 py-2 text-left text-sm hover:bg-emerald-50"
              onClick={() => onPick(item)}
            >
              <span className="font-semibold text-slate-900">{item.label}</span>
              {item.sublabel ? (
                <span className="mt-0.5 block text-xs text-slate-500">
                  {item.sublabel}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
