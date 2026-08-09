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

export function RecurringReconciliationPanel({
  competencePeriod,
  settledPeriod,
  rows,
  supplierLabel,
}: {
  competencePeriod: string;
  settledPeriod: string;
  rows: ReconciliationRow[];
  supplierLabel: string;
}) {
  const received = rows.filter((row) => ["PAID", "LIQUIDATED"].includes(row.status) && row.settledPeriod === settledPeriod);
  const missing = rows.filter((row) => ["MISSING", "PENDING", "ERROR_UNPAID"].includes(row.status));
  const otherSettlement = rows.filter((row) => ["PAID", "LIQUIDATED"].includes(row.status) && row.settledPeriod !== settledPeriod);
  const expectedAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const receivedAmount = received.reduce((sum, row) => sum + row.amount, 0);
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

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">Quadratura rendiconto fornitore</h2>
          <p className="mt-1 text-sm text-slate-500">
            {supplierLabel} · competenza {periodLabel(competencePeriod)} · rendiconto {periodLabel(settledPeriod)}
          </p>
        </div>
        <span className={difference === 0 ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800" : "rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800"}>
          Differenza {formatCurrency(difference)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-100 p-3"><p className="text-xs text-slate-500">Rate attese</p><p className="text-xl font-bold">{rows.length}</p><p className="text-xs">{formatCurrency(expectedAmount)}</p></div>
        <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Ricevute</p><p className="text-xl font-bold text-emerald-900">{received.length}</p><p className="text-xs text-emerald-800">{formatCurrency(receivedAmount)}</p></div>
        <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Mancanti</p><p className="text-xl font-bold text-amber-950">{missing.length}</p><p className="text-xs text-amber-800">{formatCurrency(Math.max(0, expectedAmount - receivedAmount))}</p></div>
        <div className="rounded-xl bg-red-50 p-3"><p className="text-xs text-red-700">POD/PDR duplicati</p><p className="text-xl font-bold text-red-950">{duplicates.length}</p><p className="text-xs text-red-800">da controllare</p></div>
      </div>

      {missing.length > 0 || duplicates.length > 0 || otherSettlement.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-slate-900">Anomalie da controllare</h3>
          <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200">
            {[...missing, ...otherSettlement, ...duplicates.filter((row) => !missing.some((item) => item.id === row.id) && !otherSettlement.some((item) => item.id === row.id))].slice(0, 100).map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
                <div>
                  <p className="font-semibold text-slate-950">{row.clientName}</p>
                  <p className="text-xs text-slate-500">{row.supplierName} · {row.podPdr || "POD/PDR mancante"} · {formatCurrency(row.amount)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={duplicates.some((item) => item.id === row.id) ? "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-800" : "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"}>
                    {duplicates.some((item) => item.id === row.id) ? "Duplicato" : otherSettlement.some((item) => item.id === row.id) ? `Rendiconto ${row.settledPeriod || "non indicato"}` : "Da incassare"}
                  </span>
                  <Link href={`/contratti/${row.contractId}`} className="font-semibold text-sky-700 hover:underline">Apri</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Quadratura completa: nessuna anomalia rilevata.</p>
      )}
    </section>
  );
}
