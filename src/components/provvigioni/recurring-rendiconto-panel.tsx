import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import { clientDisplayName } from "@/lib/utils";

export type SettledRow = {
  id: string;
  period: string;
  settledPeriod: string | null;
  amount: number;
  paidAt: string | null;
  contractId: string;
  clientName: string;
  podPdr: string;
  supplierName: string;
  collaboratorName: string;
};

export function RecurringRendicontoPanel({
  settledPeriod,
  rows,
  collabQuery,
}: {
  settledPeriod: string;
  rows: SettledRow[];
  /** query string già con ? o & per preservare collab */
  collabQuery: string;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);

  // Opzioni mesi (corrente e 11 precedenti)
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    options.push(`${y}-${m}`);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Rendiconto ricorrenze — {periodLabel(settledPeriod)}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Mesi di <strong>competenza</strong> segnati come pagati nel bonifico/rendiconto di{" "}
            {periodLabel(settledPeriod)}. Es. a luglio puoi avere competenze di aprile–maggio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Mese rendiconto:</span>
          {options.map((p) => (
            <Link
              key={p}
              href={`/provvigioni?settled=${p}${collabQuery}`}
              className={
                p === settledPeriod
                  ? "rounded-lg bg-slate-800 px-2.5 py-1 text-white"
                  : "rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200"
              }
            >
              {periodLabel(p)}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700">
        {rows.length} rate · totale {formatCurrency(total)}
      </p>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          Nessuna rata ricorrente associata a questo mese di rendiconto. Segna i mesi mancanti
          come «Pagato» scegliendo questo mese come bonifico.
        </p>
      ) : (
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Competenza</th>
                <th className="px-2 py-1.5">Cliente</th>
                <th className="px-2 py-1.5">Collab.</th>
                <th className="px-2 py-1.5">Fornitore</th>
                <th className="px-2 py-1.5">Importo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-medium">{periodLabel(r.period)}</td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/contratti/${r.contractId}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {r.clientName}
                    </Link>
                    {r.podPdr ? (
                      <span className="block text-[10px] text-slate-400">{r.podPdr}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">{r.collaboratorName}</td>
                  <td className="px-2 py-1.5">{r.supplierName}</td>
                  <td className="px-2 py-1.5">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Helper server → row */
export function toSettledRow(m: {
  id: string;
  period: string;
  settledPeriod: string | null;
  amount: { toString(): string } | null;
  paidAt: Date | null;
  contractId: string;
  contract: {
    podPdr: string | null;
    collaborator: { name: string };
    supplier: { name: string };
    client: {
      type: string;
      companyName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    };
  };
}): SettledRow {
  return {
    id: m.id,
    period: m.period,
    settledPeriod: m.settledPeriod,
    amount: Number(m.amount?.toString() ?? 0),
    paidAt: m.paidAt ? m.paidAt.toISOString().slice(0, 10) : null,
    contractId: m.contractId,
    clientName: clientDisplayName(m.contract.client),
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    collaboratorName: m.contract.collaborator.name,
  };
}
