import Link from "next/link";
import { formatCurrency } from "@/lib/commission";
import type {
  ContractFinanceAdjustmentRow,
  ContractFinanceTimelineRow,
  ContractFinanceTotals,
} from "@/lib/contract-commission-finance";

const TOTAL_CARDS: Array<{
  key: keyof ContractFinanceTotals;
  label: string;
  hint: string;
}> = [
  { key: "attese", label: "Attese", hint: "Importo previsto / rate aperte" },
  { key: "incassato", label: "Incassato", hint: "Ricevuto dal fornitore" },
  { key: "daIncassare", label: "Da incassare", hint: "Ancora dal fornitore" },
  {
    key: "daLiquidare",
    label: "Da liquidare",
    hint: "Incassato, non liquidato al collab.",
  },
  { key: "liquidato", label: "Liquidato", hint: "Versato al collaboratore" },
  {
    key: "stornatoRettificato",
    label: "Stornato / rettificato",
    hint: "Solo storno gettone Commission",
  },
];

export function ContractCommissionTimeline({
  totals,
  timeline,
  adjustments,
}: {
  totals: ContractFinanceTotals;
  timeline: ContractFinanceTimelineRow[];
  adjustments: ContractFinanceAdjustmentRow[];
}) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="font-semibold text-slate-900">Blocco finanziario</h2>
        <p className="mt-1 text-xs text-slate-500">
          Ciclo P1.1: atteso → da incassare → incassato (fornitore) → da
          liquidare → liquidato (collaboratore). INCASSATO ≠ LIQUIDATO.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {TOTAL_CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <dt className="text-xs font-medium text-slate-500">{card.label}</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-slate-900">
              {formatCurrency(totals[card.key])}
            </dd>
            <p className="mt-0.5 text-[11px] text-slate-400">{card.hint}</p>
          </div>
        ))}
      </dl>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Timeline rate e gettoni
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Cronologia per periodo (UT / M / R). Link a Provvigioni o al ciclo di
          liquidazione quando c&apos;è un match payout.
        </p>

        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessuna rata o gettone da mostrare.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Periodo</th>
                  <th className="px-2 py-2 font-medium">Tipo</th>
                  <th className="px-2 py-2 font-medium">Atteso</th>
                  <th className="px-2 py-2 font-medium">Incassato</th>
                  <th className="px-2 py-2 font-medium">Liquidato</th>
                  <th className="px-2 py-2 font-medium">Stato</th>
                  <th className="px-2 py-2 font-medium">Fonte</th>
                  <th className="px-2 py-2 font-medium">Note</th>
                  <th className="px-2 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-2 py-2 whitespace-nowrap text-slate-800">
                      {row.periodLabel}
                    </td>
                    <td className="px-2 py-2 font-medium text-slate-700">
                      {row.kind}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatCurrency(row.atteso)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatCurrency(row.incassato)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatCurrency(row.liquidato)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{row.stato}</td>
                    <td className="px-2 py-2 text-slate-600">{row.fonte}</td>
                    <td className="max-w-[14rem] px-2 py-2 text-slate-500">
                      {row.note}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {row.href && row.hrefLabel ? (
                        <Link
                          href={row.href}
                          className="text-emerald-700 hover:underline"
                        >
                          {row.hrefLabel}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Rettifiche liquidazione (PayoutAdjustment)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Decisione D5: voci EXTRA / STORNO / ACCONTO / RETTIFICA del ciclo
          liquidazioni, mostrate qui sotto con etichetta dedicata. Non sono
          sommate nei totali sopra (evita doppi conteggi).
        </p>

        {adjustments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessuna rettifica collegata a questo contratto.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Rendiconto</th>
                  <th className="px-2 py-2 font-medium">Tipo</th>
                  <th className="px-2 py-2 font-medium">Importo</th>
                  <th className="px-2 py-2 font-medium">Note</th>
                  <th className="px-2 py-2 font-medium">Stato</th>
                  <th className="px-2 py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-2 py-2 whitespace-nowrap">
                      {row.periodLabel}
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        {row.kindLabel}
                      </span>
                    </td>
                    <td
                      className={`px-2 py-2 tabular-nums font-semibold ${
                        row.amount < 0 ? "text-rose-700" : "text-slate-800"
                      }`}
                    >
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="max-w-[16rem] px-2 py-2 text-slate-600">
                      {row.note}
                    </td>
                    <td className="px-2 py-2 text-slate-600">
                      {row.voided ? "Annullata" : "Attiva"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link
                        href={row.href}
                        className="text-emerald-700 hover:underline"
                      >
                        Ciclo liquidazione
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
