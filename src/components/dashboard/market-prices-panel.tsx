import type { MarketDispatch, MarketIndex, MarketPrices } from "@/lib/market-prices";
import { MarketTrendChart } from "@/components/dashboard/market-trend-chart";

function IndexCard({
  index,
  tone,
}: {
  index: MarketIndex;
  tone: "pun" | "psv";
}) {
  const tones = {
    pun: "border-amber-200 bg-amber-50/60 hover:border-amber-300",
    psv: "border-orange-200 bg-orange-50/60 hover:border-orange-300",
  };

  return (
    <a
      href={index.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {index.label}
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
        {index.dailyValue}
        <span className="ml-1 text-sm font-medium text-slate-500">{index.unit}</span>
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {index.dailyDate ? `Oggi ${index.dailyDate}` : "Valore giornaliero"}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-700">{index.monthlyAvg}</p>
      <p className="mt-3 text-xs font-medium text-emerald-700 group-hover:underline">
        Apri storico su fmconsulenza.it ↗
      </p>
    </a>
  );
}

function DispatchCard({ dispatch }: { dispatch: MarketDispatch }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {dispatch.label}
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
        {dispatch.value}
        <span className="ml-1 text-sm font-medium text-slate-500">{dispatch.unit}</span>
      </p>
      <p className="mt-2 text-sm text-slate-600">{dispatch.hint}</p>
      <p className="mt-3 text-xs text-slate-500">
        Non è un prezzo di mercato giornaliero: componente di dispacciamento ARERA.
      </p>
    </article>
  );
}

export function MarketPricesPanel({ prices }: { prices: MarketPrices | null }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Mercati
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">PUN, PSV e dispacciamento</h2>
          <p className="mt-1 text-sm text-slate-500">
            Valori da{" "}
            <a
              href="https://www.fmconsulenza.it/mercati/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:underline"
            >
              fmconsulenza.it
            </a>
            . Clic su PUN o PSV apre il sito in una nuova scheda.
          </p>
        </div>
        {prices?.updatedAt ? (
          <span className="text-xs text-slate-500">Aggiornato: {prices.updatedAt}</span>
        ) : null}
      </div>

      {prices ? (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <IndexCard index={prices.pun} tone="pun" />
            <IndexCard index={prices.psv} tone="psv" />
            <DispatchCard dispatch={prices.dispatch} />
          </div>
          {prices.chart ? <MarketTrendChart series={prices.chart} /> : null}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          Indici non disponibili al momento. Riprova tra qualche minuto o consulta il sito
          mercati.
        </p>
      )}
    </section>
  );
}
