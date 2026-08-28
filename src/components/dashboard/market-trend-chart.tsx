import type { MarketChartSeries } from "@/lib/market-prices";

function axisTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  return Array.from({ length: count + 1 }, (_, i) => min + (span * i) / count);
}

function buildPath(
  points: Array<{ value: number }>,
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) => {
      const cmd = index === 0 ? "M" : "L";
      return `${cmd}${xAt(index).toFixed(2)},${yAt(point.value).toFixed(2)}`;
    })
    .join(" ");
}

function formatAxis(value: number): string {
  return value.toFixed(3).replace(".", ",");
}

export function MarketTrendChart({ series }: { series: MarketChartSeries }) {
  const { pun, psv, punUnit, psvUnit, year } = series;
  if (pun.length === 0 && psv.length === 0) return null;

  const labels =
    pun.length >= psv.length
      ? pun.map((point) => point.label)
      : psv.map((point) => point.label);
  const count = Math.max(labels.length, 1);

  const width = 920;
  const height = 320;
  const pad = { top: 20, right: 58, bottom: 42, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const punValues = pun.map((point) => point.value);
  const psvValues = psv.map((point) => point.value);

  const punMin = punValues.length ? Math.min(...punValues) : 0;
  const punMax = punValues.length ? Math.max(...punValues) : 1;
  const psvMin = psvValues.length ? Math.min(...psvValues) : 0;
  const psvMax = psvValues.length ? Math.max(...psvValues) : 1;

  const punPad = (punMax - punMin || 0.01) * 0.12;
  const psvPad = (psvMax - psvMin || 0.01) * 0.12;
  const punLo = punMin - punPad;
  const punHi = punMax + punPad;
  const psvLo = psvMin - psvPad;
  const psvHi = psvMax + psvPad;

  const xAt = (index: number) =>
    pad.left + (index / Math.max(count - 1, 1)) * plotW;
  const yPun = (value: number) =>
    pad.top + plotH - ((value - punLo) / (punHi - punLo || 1)) * plotH;
  const yPsv = (value: number) =>
    pad.top + plotH - ((value - psvLo) / (psvHi - psvLo || 1)) * plotH;

  const punPath = buildPath(pun, xAt, yPun);
  const psvPath = buildPath(psv, xAt, yPsv);
  const punTicks = axisTicks(punLo, punHi);
  const psvTicks = axisTicks(psvLo, psvHi);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Andamento luce e gas · {year}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Medie mensili da inizio anno · assi separati PUN ({punUnit}) e PSV ({psvUnit})
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-medium">
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-0.5 w-5 rounded bg-emerald-600" />
            PUN luce
          </span>
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-0.5 w-5 rounded bg-sky-600" />
            PSV gas
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[680px] w-full"
          role="img"
          aria-label={`Grafico andamento PUN e PSV dal ${year}`}
        >
          {punTicks.map((tick) => {
            const y = yPun(tick);
            return (
              <g key={`pun-grid-${tick}`}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[11px]"
                >
                  {formatAxis(tick)}
                </text>
              </g>
            );
          })}

          {psvTicks.map((tick) => {
            const y = yPsv(tick);
            return (
              <text
                key={`psv-axis-${tick}`}
                x={width - pad.right + 8}
                y={y + 4}
                textAnchor="start"
                className="fill-sky-700 text-[11px]"
              >
                {formatAxis(tick)}
              </text>
            );
          })}

          {labels.map((label, index) => (
            <text
              key={`${label}-${index}`}
              x={xAt(index)}
              y={height - 12}
              textAnchor="middle"
              className="fill-slate-600 text-[11px]"
            >
              {label}
            </text>
          ))}

          {punPath ? (
            <path
              d={punPath}
              fill="none"
              stroke="#059669"
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {psvPath ? (
            <path
              d={psvPath}
              fill="none"
              stroke="#0284c7"
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {pun.map((point, index) => (
            <circle
              key={`pun-dot-${point.date}`}
              cx={xAt(index)}
              cy={yPun(point.value)}
              r={4}
              fill="#059669"
            />
          ))}

          {psv.map((point, index) => (
            <circle
              key={`psv-dot-${point.date}`}
              cx={xAt(index)}
              cy={yPsv(point.value)}
              r={4}
              fill="#0284c7"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
