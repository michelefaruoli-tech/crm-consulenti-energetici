"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { CteCatalogFilterTable } from "@/components/cte/cte-catalog-filter-table";
import { consumptionUnitLabel } from "@/lib/cte-ranking-defaults";
import type { CteCatalogTableRow } from "@/lib/cte-types";
import type { CteCategory, CtePriceKind, CteUtility } from "@/generated/prisma/client";

const TABS: { key: CteCategory; label: string }[] = [
  { key: "RESIDENZIALE", label: "Residenziale" },
  { key: "BUSINESS", label: "Business" },
  { key: "CONDOMINI", label: "Condomini" },
];

export function CteCatalogClient({
  rows,
  canManage,
  filters,
  rankingActive,
  showGasNoRankBanner,
}: {
  rows: CteCatalogTableRow[];
  canManage: boolean;
  filters: {
    category: CteCategory;
    utility: CteUtility;
    priceKind: CtePriceKind;
    monthlyConsumption: string;
    powerKw: string;
    validFrom: string;
    validTo: string;
  };
  rankingActive: boolean;
  showGasNoRankBanner: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const pushFilters = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      startTransition(() => {
        router.push(`/catalogo-cte?${next.toString()}`);
      });
    },
    [router, searchParams],
  );

  const unit = consumptionUnitLabel(filters.utility);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={filters.category === tab.key ? "primary" : "secondary"}
            onClick={() => pushFilters({ categoria: tab.key })}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Commodity</p>
          <div className="flex gap-2">
            {(["LUCE", "GAS"] as const).map((u) => (
              <Button
                key={u}
                type="button"
                size="sm"
                variant={filters.utility === u ? "primary" : "secondary"}
                onClick={() => pushFilters({ utility: u, consumo: undefined })}
              >
                {u === "LUCE" ? "Luce" : "Gas"}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Tipologia</p>
          <div className="flex gap-2">
            {(["FISSO", "VARIABILE"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={filters.priceKind === k ? "primary" : "secondary"}
                onClick={() => pushFilters({ prezzo: k })}
              >
                {k === "FISSO" ? "Fissi" : "Variabili"}
              </Button>
            ))}
          </div>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Consumo mensile ({unit})
          </span>
          <Input
            type="number"
            min={0}
            step="0.01"
            className="w-36"
            defaultValue={filters.monthlyConsumption}
            key={`consumo-${filters.monthlyConsumption}`}
            onBlur={(e) => pushFilters({ consumo: e.target.value.trim() || undefined })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Potenza kW</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            className="w-28"
            defaultValue={filters.powerKw}
            key={`potenza-${filters.powerKw}`}
            onBlur={(e) => pushFilters({ potenza: e.target.value.trim() || undefined })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Validità dal</span>
          <Input
            type="date"
            className="w-40"
            defaultValue={filters.validFrom}
            key={`validFrom-${filters.validFrom}`}
            onBlur={(e) => pushFilters({ validFrom: e.target.value || undefined })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Validità al</span>
          <Input
            type="date"
            className="w-40"
            defaultValue={filters.validTo}
            key={`validTo-${filters.validTo}`}
            onBlur={(e) => pushFilters({ validTo: e.target.value || undefined })}
          />
        </label>
        {canManage ? (
          <Button type="button" className="ml-auto" onClick={() => router.push("/catalogo-cte/nuovo")}>
            Nuova CTE
          </Button>
        ) : null}
      </div>

      {showGasNoRankBanner ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Gas senza consumo mensile: nessun ranking automatico. Filtra e scegli l&apos;offerta in
          autonomia, oppure inserisci i Smc/mese per ordinare per costo stimato.
        </div>
      ) : null}

      {!rankingActive && filters.utility === "LUCE" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Ranking attivo con consumo di default per categoria. Inserisci un consumo mensile per
          personalizzare l&apos;ordinamento.
        </div>
      ) : null}

      <CteCatalogFilterTable
        rows={rows}
        canManage={canManage}
        utility={filters.utility}
        rankingActive={rankingActive}
      />
    </div>
  );
}
