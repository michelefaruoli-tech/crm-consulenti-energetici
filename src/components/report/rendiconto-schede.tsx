import {
  buildRendicontoSummaryRows,
  buildRendicontoSupplierCards,
  formatEuro,
  rendicontoCountLabel,
  rendicontoSupplierCardHeading,
  reportClienteLabel,
  type RendicontoLine,
  type RendicontoMonthSlice,
  type RendicontoSummary,
} from "@/lib/report-rendiconto";
import {
  RENDICONTO_SECTION_THEME,
  rendicontoNettoSwatch,
  rendicontoSummarySwatch,
  rendicontoSupplierTheme,
  type RendicontoSwatch,
} from "@/lib/rendiconto-supplier-theme";

function LinesTable({
  lines,
  dateHeader,
}: {
  lines: RendicontoLine[];
  dateHeader: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Collab.</th>
            <th className="px-3 py-2 font-medium">{dateHeader}</th>
            <th className="px-3 py-2 text-right font-medium">Importo</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={`${line.contractNumber}-${line.podPdr}-${line.dateLabel}-${index}`}
              className="border-t border-slate-100"
            >
              <td className="px-3 py-2 font-medium text-slate-900">
                {reportClienteLabel(line.clientName, line.podPdr)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                {line.collaboratorName}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                {line.dateLabel}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${
                  line.amount < 0 ? "text-rose-700" : "text-emerald-800"
                }`}
              >
                {formatEuro(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthBlock({
  slice,
  swatch,
  kicker,
}: {
  slice: RendicontoMonthSlice;
  swatch: RendicontoSwatch;
  kicker?: string;
}) {
  const countLabel =
    kicker === "Storni"
      ? slice.count === 1
        ? "1 storno"
        : `${slice.count} storni`
      : rendicontoCountLabel(slice.count);
  return (
    <div>
      <h4
        className="flex flex-wrap items-baseline justify-between gap-2 rounded-md px-3 py-1.5 text-sm font-semibold"
        style={{ backgroundColor: swatch.wash, color: swatch.washText }}
      >
        <span>
          {kicker ? `${kicker} · ` : ""}
          {slice.label}
          <span className="ml-2 font-medium">{countLabel}</span>
        </span>
        <span className="tabular-nums">{formatEuro(slice.subtotal)}</span>
      </h4>
      <LinesTable lines={slice.lines} dateHeader="Data" />
    </div>
  );
}

export function RendicontoSchede({
  rendiconto,
  includeStornos,
  includeRecurring,
}: {
  rendiconto: RendicontoSummary;
  includeStornos: boolean;
  includeRecurring: boolean;
}) {
  const summary = buildRendicontoSummaryRows({
    rendiconto,
    includeRecurring,
    grandNetto: rendiconto.totNetto,
  });
  const cards = buildRendicontoSupplierCards(rendiconto, {
    includeStornos,
    includeRecurring,
  });

  return (
    <div className="space-y-4" id="rendiconto">
      <section
        className="overflow-hidden rounded-2xl border-2 bg-white shadow-sm"
        style={{ borderColor: RENDICONTO_SECTION_THEME.dettaglio.frame }}
      >
        <h2
          className="px-4 py-2 text-sm font-semibold"
          style={{
            backgroundColor: RENDICONTO_SECTION_THEME.dettaglio.bar,
            color: RENDICONTO_SECTION_THEME.dettaglio.text,
          }}
        >
          Riepilogo
        </h2>
        <ul className="space-y-2 p-3">
          {summary.map((row) => {
            const swatch = rendicontoSummarySwatch(row);
            return (
              <li
                key={`${row.kind}-${row.label}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
                style={{ backgroundColor: swatch.bar, color: swatch.text }}
              >
                <span>{row.label}</span>
                <span className="tabular-nums">
                  {row.note} · {formatEuro(row.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-xl border-2 border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
          Nessuna riga nel periodo.
        </p>
      ) : (
        cards.map((card) => {
          const theme = rendicontoSupplierTheme(card.supplierName);
          const heading = rendicontoSupplierCardHeading(card);
          return (
            <article
              key={card.supplierName}
              className="overflow-hidden rounded-2xl border-2 bg-white shadow-sm"
              style={{ borderColor: theme.frame }}
            >
              <header
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
                style={{ backgroundColor: theme.bar, color: theme.text }}
              >
                <h3 className="text-base font-semibold">{card.supplierName}</h3>
                <p className="text-sm font-semibold tabular-nums">{heading.title.replace(`${card.supplierName}  ·  `, "")}</p>
              </header>
              <div className="space-y-4 p-3 sm:p-4">
                {card.months.map((month) => (
                  <MonthBlock
                    key={month.month}
                    slice={month}
                    swatch={theme}
                  />
                ))}
                {card.storniMonths.map((month) => (
                  <MonthBlock
                    key={`storno-${month.month}`}
                    slice={month}
                    swatch={RENDICONTO_SECTION_THEME.storni}
                    kicker="Storni"
                  />
                ))}
                {card.ricorrenti.length > 0 ? (
                  <div>
                    <h4
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-md px-3 py-1.5 text-sm font-semibold"
                      style={{
                        backgroundColor: RENDICONTO_SECTION_THEME.ricorrenti.wash,
                        color: RENDICONTO_SECTION_THEME.ricorrenti.washText,
                      }}
                    >
                      <span>
                        Rate ricorrenti
                        <span className="ml-2 font-medium">
                          {rendicontoCountLabel(card.ricorrentiCount)}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatEuro(card.ricorrentiSubtotal)}
                      </span>
                    </h4>
                    <LinesTable lines={card.ricorrenti} dateHeader="Mesi pagati" />
                  </div>
                ) : null}
              </div>
              <footer
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm font-semibold"
                style={{ backgroundColor: theme.bar, color: theme.text }}
              >
                <span>{heading.foot}</span>
                <span className="tabular-nums">{formatEuro(heading.amount)}</span>
              </footer>
            </article>
          );
        })
      )}

      {rendiconto.months.length > 1 ? (
        <section className="overflow-hidden rounded-xl border border-slate-300 bg-white">
          <h2 className="bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
            Subtotali netti per mese
          </h2>
          <ul>
            {rendiconto.months.map((block) => {
              const tone = rendicontoNettoSwatch(block.subNetto);
              return (
                <li
                  key={block.month}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: tone.bar, color: tone.text }}
                >
                  <span>Subtotale netto {block.label}</span>
                  <span className="tabular-nums">{formatEuro(block.subNetto)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-slate-500">
        Le voci aggiuntive (acconti, conguagli) si sommano nel PDF e nell’Excel, non in
        questa anteprima. I contratti sono in ordine alfabetico per nominativo.
      </p>
    </div>
  );
}
