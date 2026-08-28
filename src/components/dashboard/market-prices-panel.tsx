import Link from "next/link";
import type { MarketPrices } from "@/lib/market-prices";

function IndexCard({
  index,
  href,
  tone,
}: {
  index: MarketPrices["pun"];
  href: string;
  tone: "pun" | "psv";
}) {
  const tones = {
    pun: "border-amber-200 bg-amber-50/60",
    psv: "border-orange-200 bg-orange-50/60",
  };

  return (
    <Link
      href={href}
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
        Storico e analisi →
      </p>
    </Link>
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
          <h2 className="mt-1 text-lg font-semibold text-slate-900">PUN e PSV</h2>
          <p className="mt-1 text-sm text-slate-500">
            Valori giornalieri e media mensile da{" "}
            <a
              href="https://www.fmconsulenza.it/mercati/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 hover:underline"
            >
              fmconsulenza.it
            </a>
          </p>
        </div>
        {prices?.updatedAt ? (
          <span className="text-xs text-slate-500">Aggiornato: {prices.updatedAt}</span>
        ) : null}
      </div>

      {prices ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <IndexCard
            index={prices.pun}
            href="https://www.fmconsulenza.it/pun-luce/"
            tone="pun"
          />
          <IndexCard
            index={prices.psv}
            href="https://www.fmconsulenza.it/psv-gas/"
            tone="psv"
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Indici non disponibili al momento. Riprova tra qualche minuto o consulta il sito
          mercati.
        </p>
      )}
    </section>
  );
}
