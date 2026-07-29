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
  collaboratorId: string;
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

  // Quanto dare a ciascun collaboratore (rate del rendiconto selezionato)
  const byCollab = new Map<
    string,
    { id: string; name: string; count: number; amount: number }
  >();
  for (const r of rows) {
    const cur = byCollab.get(r.collaboratorId) ?? {
      id: r.collaboratorId,
      name: r.collaboratorName,
      count: 0,
      amount: 0,
    };
    cur.count += 1;
    cur.amount += r.amount;
    byCollab.set(r.collaboratorId, cur);
  }
  const collaboratorTotals = [...byCollab.values()].sort((a, b) =>
    b.amount !== a.amount
      ? b.amount - a.amount
      : a.name.localeCompare(b.name, "it"),
  );

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
            Mesi di <strong>competenza</strong> segnati come incassati nel rendiconto del
            fornitore di {periodLabel(settledPeriod)}. Es. a luglio puoi avere competenze di
            aprile–maggio. Qui sotto vedi <strong>quanto dare a ciascun collaboratore</strong>{" "}
            per questo rendiconto (Helios e altri ricorrenti).
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

      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        <p className="font-semibold">
          {rows.length} rate · totale rendiconto {formatCurrency(total)}
        </p>
        <p className="mt-1 text-xs text-emerald-900/90">
          <strong>Incassato</strong> = Helios (o altro fornitore) ha pagato a te.{" "}
          <strong>Pagato</strong> = tu hai liquidato il collaboratore in Provvigioni («Segna
          pagato»). I totali sotto sono gli importi del rendiconto da considerare per il
          pagamento ai collaboratori.
        </p>
      </div>

      {collaboratorTotals.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">
            Da liquidare per collaboratore (questo rendiconto)
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Collaboratore</th>
                  <th className="px-3 py-2">N° rate</th>
                  <th className="px-3 py-2">Totale da considerare</th>
                  <th className="px-3 py-2">Apri in Provvigioni</th>
                </tr>
              </thead>
              <tbody>
                {collaboratorTotals.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{c.name}</td>
                    <td className="px-3 py-2">{c.count}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-800">
                      {formatCurrency(c.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/provvigioni?collab=${c.id}&stato=Incassato&vista=ricorrente&settled=${settledPeriod}`}
                        className="text-emerald-700 underline hover:text-emerald-900"
                      >
                        Vedi rate Incassato
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Totale</td>
                  <td className="px-3 py-2">{rows.length}</td>
                  <td className="px-3 py-2 text-emerald-900">{formatCurrency(total)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          Nessuna rata ricorrente associata a questo mese di rendiconto. Importa il file Helios
          da Archivio, oppure segna i mesi mancanti come <strong>Incassato</strong> scegliendo
          questo mese come rendiconto fornitore.
        </p>
      ) : (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Dettaglio rate</h3>
          <div className="max-h-64 overflow-auto">
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
    collaboratorId?: string;
    collaborator: { id?: string; name: string };
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
    collaboratorId:
      m.contract.collaboratorId || m.contract.collaborator.id || "",
    collaboratorName: m.contract.collaborator.name,
  };
}
