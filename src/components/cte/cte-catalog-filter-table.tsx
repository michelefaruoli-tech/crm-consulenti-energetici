"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FileText } from "lucide-react";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { cteSupplierPalette, cteSupplierRowClass } from "@/lib/cte-supplier-colors";
import type { CteCatalogTableRow } from "@/lib/cte-types";

function fmtPrice(v: number | null, utility: string, lossesLabel: string): React.ReactNode {
  if (v == null) return "—";
  const unit = utility === "GAS" ? "€/Smc" : "€/kWh";
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span>
        {v.toFixed(4)} {unit}
      </span>
      {lossesLabel === "Perdite escluse" ? (
        <span className="text-[10px] font-medium text-amber-700">perdite escluse</span>
      ) : null}
    </span>
  );
}

export function CteCatalogFilterTable({
  rows,
  canManage,
  utility,
  rankingActive,
}: {
  rows: CteCatalogTableRow[];
  canManage: boolean;
  utility: string;
  rankingActive: boolean;
}) {
  const columns: FilterColumn[] = useMemo(
    () => [
      ...(rankingActive
        ? [
            {
              key: "rank",
              label: "#",
              getValue: (r: Record<string, unknown>) =>
                r.rank == null ? "" : String(r.rank),
              sortKind: "number" as const,
              colClassName: "w-12",
            },
          ]
        : []),
      {
        key: "offerName",
        label: "Nome CTE",
        getValue: (r) => String(r.offerName ?? ""),
        render: (r) =>
          canManage ? (
            <Link
              href={`/catalogo-cte/${String(r.id)}`}
              className="font-semibold text-slate-900 underline-offset-2 hover:underline"
            >
              {String(r.offerName)}
            </Link>
          ) : (
            <span className="font-semibold text-slate-900">{String(r.offerName)}</span>
          ),
      },
      {
        key: "supplierName",
        label: "Fornitore",
        getValue: (r) => String(r.supplierName ?? ""),
        render: (r) => {
          const name = String(r.supplierName ?? "");
          const pal = cteSupplierPalette(name);
          return (
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${pal.badgeClass}`}
            >
              {name || "—"}
            </span>
          );
        },
      },
      {
        key: "powerRangeLabel",
        label: "Potenza",
        getValue: (r) => String(r.powerRangeLabel ?? ""),
      },
      {
        key: "consumptionRangeLabel",
        label: "Consumo annuo",
        getValue: (r) => String(r.consumptionRangeLabel ?? ""),
      },
      {
        key: "priceF1",
        label: "F1 / Mono",
        getValue: (r) => String(r.priceF1 ?? ""),
        sortKind: "number",
        render: (r) => {
          if (r.priceKind === "VARIABILE") {
            const unit = utility === "GAS" ? "€/Smc" : "€/kWh";
            const idx = utility === "GAS" ? "PSV" : "PUN";
            if (typeof r.spread !== "number") return "—";
            if (r.spread === 0) return idx;
            return `${idx} + ${Number(r.spread).toFixed(4)} ${unit}`;
          }
          return fmtPrice(
            typeof r.priceF1 === "number" ? r.priceF1 : null,
            utility,
            String(r.networkLossesLabel ?? ""),
          );
        },
      },
      {
        key: "priceF2",
        label: "F2",
        getValue: (r) => String(r.priceF2 ?? ""),
        sortKind: "number",
        render: (r) =>
          fmtPrice(
            typeof r.priceF2 === "number" ? r.priceF2 : null,
            utility,
            String(r.networkLossesLabel ?? ""),
          ),
      },
      {
        key: "priceF3",
        label: "F3",
        getValue: (r) => String(r.priceF3 ?? ""),
        sortKind: "number",
        render: (r) =>
          fmtPrice(
            typeof r.priceF3 === "number" ? r.priceF3 : null,
            utility,
            String(r.networkLossesLabel ?? ""),
          ),
      },
      {
        key: "ccvLabel",
        label: "CCV / quota fissa",
        getValue: (r) => String(r.ccvLabel ?? ""),
      },
      {
        key: "commercialSegment",
        label: "Segmento",
        getValue: (r) => String(r.commercialSegment ?? ""),
      },
      {
        key: "networkLossesLabel",
        label: "Perdite rete",
        getValue: (r) => String(r.networkLossesLabel ?? ""),
      },
      {
        key: "validityLabel",
        label: "Validità",
        getValue: (r) => String(r.validityLabel ?? ""),
      },
      ...(rankingActive
        ? [
            {
              key: "estimatedMonthlyCost",
              label: "Costo stim. €/mese",
              getValue: (r: Record<string, unknown>) =>
                r.estimatedMonthlyCost == null ? "" : String(r.estimatedMonthlyCost),
              sortKind: "number" as const,
              render: (r: Record<string, unknown>) =>
                typeof r.estimatedMonthlyCost === "number"
                  ? `${r.estimatedMonthlyCost.toFixed(2)} €`
                  : "—",
            },
          ]
        : []),
      {
        key: "hasPdf",
        label: "PDF",
        getValue: (r) => (r.hasPdf ? "Sì" : "No"),
        render: (r) =>
          r.hasPdf ? (
            canManage ? (
              <a
                href={`/api/catalogo-cte/${String(r.id)}/pdf`}
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                title="Scarica PDF allegato"
                onClick={(e) => e.stopPropagation()}
              >
                <FileText className="h-4 w-4" />
                PDF
              </a>
            ) : (
              "Sì"
            )
          ) : (
            "—"
          ),
      },
    ],
    [canManage, rankingActive, utility],
  );

  return (
    <ExcelFilterTable
      rows={rows as unknown as Record<string, unknown>[]}
      columns={columns}
      rowKey={(r) => String(r.id)}
      emptyMessage="Nessuna offerta CTE per i filtri selezionati."
      dense
      getRowClassName={(r) =>
        cteSupplierRowClass(String(r.supplierName ?? ""), r.applicable !== false)
      }
    />
  );
}
