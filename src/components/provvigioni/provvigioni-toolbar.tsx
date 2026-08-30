"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { periodLabel } from "@/lib/recurring";

type CollabChip = { id: string; name: string; count: number };

export function ProvvigioniToolbar({
  q,
  competencePeriod,
  competenceAll,
  monthOptions,
  queryBase,
  clearHref,
  canViewAll,
  collabFilter,
  collabCounts,
  selectedCollabIds,
  totalCollabCount,
}: {
  q?: string;
  competencePeriod: string | null;
  competenceAll: boolean;
  monthOptions: string[];
  queryBase: Record<string, string | undefined>;
  clearHref: string;
  canViewAll: boolean;
  collabFilter?: string;
  collabCounts: CollabChip[];
  selectedCollabIds: string[];
  totalCollabCount: number;
}) {
  const router = useRouter();

  function hrefWith(extra: Record<string, string | undefined | null>): string {
    const params = new URLSearchParams();
    const merged = { ...queryBase, ...extra };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    return `/provvigioni?${params.toString()}`;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-slate-600">
          <span className="mb-1 block font-medium">Periodo competenza</span>
          <select
            className="min-w-[10rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            value={competenceAll ? "tutti" : (competencePeriod ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "tutti") {
                router.push(
                  hrefWith({ competence: null, page: null }),
                );
              } else {
                router.push(
                  hrefWith({ competence: v, page: null }),
                );
              }
            }}
          >
            <option value="tutti">Tutti i mesi</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <div className="min-w-[12rem] flex-1">
          <ListSearchForm
            action="/provvigioni"
            q={q}
            placeholder="Cerca cliente, POD, CF, telefono…"
            hidden={{
              collab: collabFilter,
              settled: queryBase.settled,
              supplier: queryBase.supplier,
              stato: queryBase.stato,
              tipologia: queryBase.tipologia,
              vista: queryBase.vista,
              focus: queryBase.focus,
              competence: competenceAll ? undefined : competencePeriod ?? undefined,
            }}
            clearHref={clearHref}
          />
        </div>
      </div>

      {canViewAll ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={hrefWith({ collab: null, page: null })}
            className={
              !collabFilter
                ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-800 hover:bg-slate-200"
            }
          >
            Tutti ({totalCollabCount})
          </Link>
          {collabCounts.map((c) => (
            <Link
              key={c.id}
              href={hrefWith({ collab: c.id, page: null })}
              className={
                selectedCollabIds.includes(c.id)
                  ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                  : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-800 hover:bg-slate-200"
              }
            >
              {c.name} ({c.count})
            </Link>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        UT = gettone mese dopo ingresso · M = ogni mese · R = ogni 12 mesi. Clicca
        sulle card per filtrare per stato.
      </p>
    </div>
  );
}
