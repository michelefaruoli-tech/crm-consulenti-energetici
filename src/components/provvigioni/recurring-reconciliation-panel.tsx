import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";

export type ReconciliationRow = {
  id: string;
  contractId: string;
  clientName: string;
  podPdr: string;
  supplierName: string;
  amount: number;
  status: string;
  settledPeriod: string | null;
};

type FilterQuery = {
  supplier?: string;
  stato?: string;
  collab?: string;
  competence?: string;
};

function buildFilterHref(
  settledPeriod: string,
  query: FilterQuery,
  extra?: Partial<FilterQuery>,
): string {
  const params = new URLSearchParams({ settled: settledPeriod, vista: "mensile" });
  const merged = { ...query, ...extra };
  if (merged.supplier) params.set("supplier", merged.supplier);
  if (merged.stato) params.set("stato", merged.stato);
  if (merged.collab) params.set("collab", merged.collab);
  if (merged.competence) params.set("competence", merged.competence);
  return `/provvigioni?${params.toString()}`;
}

export function RecurringReconciliationPanel({
  competencePeriod,
  settledPeriod,
  rows,
  supplierLabel,
  filteredContractCount,
  filterQuery = {},
}: {
  competencePeriod: string;
  settledPeriod: string;
  rows: ReconciliationRow[];
  supplierLabel: string;
  /** Contratti visibili in tabella con i filtri attivi */
  filteredContractCount?: number;
  filterQuery?: FilterQuery;
}) {
  const paidInCompetence = rows.filter((row) => row.status === "PAID");
  const liquidated = rows.filter((row) => row.status === "LIQUIDATED");
  const receivedInRendiconto = rows.filter(
    (row) =>
      ["PAID", "LIQUIDATED"].includes(row.status) &&
      row.settledPeriod === settledPeriod,
  );
  const missing = rows.filter((row) =>
    ["MISSING", "PENDING", "ERROR_UNPAID"].includes(row.status),
  );
  const otherSettlement = rows.filter(
    (row) =>
      ["PAID", "LIQUIDATED"].includes(row.status) &&
      row.settledPeriod !== settledPeriod,
  );

  const expectedAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const paidAmount = paidInCompetence.reduce((sum, row) => sum + row.amount, 0);
  const receivedAmount = receivedInRendiconto.reduce((sum, row) => sum + row.amount, 0);
  const missingAmount = missing.reduce((sum, row) => sum + row.amount, 0);
  const difference = receivedAmount - expectedAmount;

  const podCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.podPdr.replace(/\s+/g, "").toUpperCase();
    if (key) podCounts.set(key, (podCounts.get(key) ?? 0) + 1);
  }
  const duplicates = rows.filter((row) => {
    const key = row.podPdr.replace(/\s+/g, "").toUpperCase();
    return Boolean(key && (podCounts.get(key) ?? 0) > 1);
  });

  const incassatiHref = buildFilterHref(settledPeriod, filterQuery, {
    stato: "Incassato",
    competence: competencePeriod,
  });
  const attesiHref = buildFilterHref(settledPeriod, filterQuery, {
    competence: competencePeriod,
  });
  const mancantiHref = buildFilterHref(settledPeriod, filterQuery, {
    stato: "Da incassare",
    competence: competencePeriod,
  });

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">
            Quadratura rendiconto fornitore
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {supplierLabel} · competenza{" "}
            <strong>{periodLabel(competencePeriod)}</strong> · rendiconto{" "}
            <strong>{periodLabel(settledPeriod)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Le <strong>rate attese</strong> sono i contratti attivi con rata prevista nel mese
            di competenza. Gli <strong>incassati</strong> sono quelli con rata segnata PAID
            (Helios ha pagato). L&apos;elenco sotto usa gli stessi criteri quando filtri per
            stato Incassato.
          </p>
        </div>
        <span
          className={
            difference === 0
              ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800"
              : "rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800"
          }
        >
          Differenza rendiconto {formatCurrency(difference)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Link
          href={attesiHref}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 hover:bg-slate-100"
        >
          <p className="text-xs font-medium text-slate-500">Rate attese</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</p>
          <p className="text-xs text-slate-600">{formatCurrency(expectedAmount)}</p>
          <p className="mt-1 text-[10px] text-slate-400">contratti con rata prevista</p>
        </Link>

        <Link
          href={incassatiHref}
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 transition hover:border-emerald-300 hover:bg-emerald-100"
        >
          <p className="text-xs font-medium text-emerald-700">Incassati (PAID)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">
            {paidInCompetence.length}
          </p>
          <p className="text-xs text-emerald-800">{formatCurrency(paidAmount)}</p>
          <p className="mt-1 text-[10px] text-emerald-700/80">
            {filteredContractCount != null
              ? `${filteredContractCount} in tabella filtrata`
              : "fornitore ha pagato"}
          </p>
        </Link>

        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs font-medium text-teal-700">Ricevute nel rendiconto</p>
          <p className="mt-1 text-2xl font-bold text-teal-900">
            {receivedInRendiconto.length}
          </p>
          <p className="text-xs text-teal-800">{formatCurrency(receivedAmount)}</p>
          <p className="mt-1 text-[10px] text-teal-700/80">
            bonifico {periodLabel(settledPeriod)}
          </p>
        </div>

        <Link
          href={mancantiHref}
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 transition hover:border-amber-300 hover:bg-amber-100"
        >
          <p className="text-xs font-medium text-amber-700">Mancanti</p>
          <p className="mt-1 text-2xl font-bold text-amber-950">{missing.length}</p>
          <p className="text-xs text-amber-800">{formatCurrency(missingAmount)}</p>
          <p className="mt-1 text-[10px] text-amber-700/80">da segnare incassato</p>
        </Link>

        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs font-medium text-indigo-700">Liquidati</p>
          <p className="mt-1 text-2xl font-bold text-indigo-900">{liquidated.length}</p>
          <p className="text-xs text-indigo-800">
            {formatCurrency(liquidated.reduce((s, r) => s + r.amount, 0))}
          </p>
          <p className="mt-1 text-[10px] text-indigo-700/80">pagati al collaboratore</p>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">POD duplicati</p>
          <p className="mt-1 text-2xl font-bold text-red-950">{duplicates.length}</p>
          <p className="text-xs text-red-800">da controllare</p>
        </div>
      </div>

      {filteredContractCount != null &&
      filterQuery.stato?.includes("Incassato") &&
      filteredContractCount !== paidInCompetence.length ? (
        <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          Tabella filtrata: <strong>{filteredContractCount}</strong> contratti · incassati PAID
          in competenza: <strong>{paidInCompetence.length}</strong>.
          {filteredContractCount < paidInCompetence.length ? (
            <>
              {" "}
              Se mancano righe, verifica che l&apos;import Helios sia completo o{" "}
              <Link href={incassatiHref} className="font-semibold underline">
                ricarica il filtro Incassato
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {missing.length > 0 || duplicates.length > 0 || otherSettlement.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-slate-900">Anomalie da controllare</h3>
          <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200">
            {[
              ...missing,
              ...otherSettlement,
              ...duplicates.filter(
                (row) =>
                  !missing.some((item) => item.id === row.id) &&
                  !otherSettlement.some((item) => item.id === row.id),
              ),
            ]
              .slice(0, 100)
              .map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                >
                  <div>
                    <p className="font-semibold text-slate-950">{row.clientName}</p>
                    <p className="text-xs text-slate-500">
                      {row.supplierName} · {row.podPdr || "POD/PDR mancante"} ·{" "}
                      {formatCurrency(row.amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        duplicates.some((item) => item.id === row.id)
                          ? "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-800"
                          : "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"
                      }
                    >
                      {duplicates.some((item) => item.id === row.id)
                        ? "Duplicato"
                        : otherSettlement.some((item) => item.id === row.id)
                          ? `Rendiconto ${row.settledPeriod ? periodLabel(row.settledPeriod) : "non indicato"}`
                          : "Da incassare"}
                    </span>
                    <Link
                      href={`/contratti/${row.contractId}`}
                      className="font-semibold text-sky-700 hover:underline"
                    >
                      Apri
                    </Link>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : paidInCompetence.length === rows.length && rows.length > 0 ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          Quadratura completa: tutte le {rows.length} rate attese risultano incassate.
        </p>
      ) : null}
    </section>
  );
}
