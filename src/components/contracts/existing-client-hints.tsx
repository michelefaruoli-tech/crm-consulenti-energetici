"use client";

import { useEffect, useState } from "react";
import type { AutocompleteItem } from "@/components/contracts/autocomplete-search";

export type ClientSearchItem = AutocompleteItem & {
  contractCount?: number;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fiscalCode?: string | null;
  vatNumber?: string | null;
};

/**
 * Suggerimenti anagrafica mentre digiti (ragione sociale / nome / CF / P.IVA).
 * - mode "fill": nuovo contratto → compila i campi
 * - mode "merge": modifica anagrafica → unifica sotto il cliente scelto
 */
export function ExistingClientHints({
  query,
  enabled,
  onPick,
  excludeId,
  mode = "fill",
}: {
  /** Testo da cercare (es. "Rossi Mario", ragione sociale, CF) */
  query: string;
  enabled: boolean;
  onPick: (item: ClientSearchItem) => void;
  /** Esclude l’anagrafica corrente (modifica cliente) */
  excludeId?: string | null;
  mode?: "fill" | "merge";
}) {
  const [items, setItems] = useState<ClientSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const q = query.trim();
  const active = enabled && q.length >= 2;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      const params = new URLSearchParams({ q });
      if (excludeId) params.set("excludeId", excludeId);
      void fetch(`/api/clients/search?${params.toString()}`)
        .then((r) => r.json())
        .then((data: { items?: ClientSearchItem[] }) => {
          if (cancelled) return;
          setItems((data.items ?? []).slice(0, 8));
        })
        .catch(() => {
          if (cancelled) return;
          setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, active, excludeId]);

  const visible = active ? items : [];

  if (!active) return null;
  if (!loading && visible.length === 0) return null;

  const title =
    mode === "merge"
      ? "Cliente già registrato? Seleziona per unificare i contratti sotto quella anagrafica:"
      : "Cliente già in anagrafica? Seleziona per compilare tutto in automatico:";

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-2 ring-1 ring-amber-100"
      data-testid={
        mode === "merge" ? "client-merge-hints" : "existing-client-hints"
      }
    >
      <p className="mb-1.5 text-xs font-medium text-amber-950">{title}</p>
      {loading && visible.length === 0 ? (
        <p className="px-1 py-1 text-xs text-amber-900/70">Ricerca in corso…</p>
      ) : null}
      <ul className="space-y-1">
        {visible.map((item) => (
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
              {mode === "merge" ? (
                <span className="mt-0.5 block text-xs font-medium text-emerald-700">
                  Unifica sotto questa anagrafica
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
