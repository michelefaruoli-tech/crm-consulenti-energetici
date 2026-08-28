export type MarketIndex = {
  label: string;
  dailyValue: string;
  dailyDate: string;
  monthlyAvg: string;
  unit: string;
  href: string;
};

export type MarketDispatch = {
  label: string;
  value: string;
  unit: string;
  hint: string;
};

export type MarketChartPoint = {
  date: string;
  label: string;
  value: number;
};

export type MarketChartSeries = {
  year: number;
  pun: MarketChartPoint[];
  psv: MarketChartPoint[];
  punUnit: string;
  psvUnit: string;
};

export type MarketPrices = {
  pun: MarketIndex;
  psv: MarketIndex;
  dispatch: MarketDispatch;
  chart: MarketChartSeries | null;
  updatedAt: string | null;
};

const MERCATI_URL = "https://www.fmconsulenza.it/mercati/";

type FmoneMarketsRaw = {
  pun: Array<{ date: string; value: number }>;
  gas: Array<{ date: string; value: number }>;
  pun_daily?: Array<{ date: string; value: number }>;
  gas_daily?: Array<{ date: string; value: number }>;
  dispatch?: { value: number; unit?: string; updated_at?: string };
  conversion?: { pun: number; gas: number };
  units?: { pun: string; gas: string; dispatch: string };
};

const IT_MONTH_SHORT = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

function formatItDecimal(value: number, digits = 5): string {
  return value.toFixed(digits).replace(".", ",");
}

function formatMonthLabel(date: string): string {
  const [year, month] = date.split("-");
  const idx = Number(month) - 1;
  if (!year || idx < 0 || idx > 11) return date;
  return `${IT_MONTH_SHORT[idx]} ${year.slice(2)}`;
}

function formatDayLabel(date: string): string {
  const [, month, day] = date.split("-");
  if (!month || !day) return date;
  return `${day}/${month}`;
}

function parseFmoneMarketsJson(html: string): FmoneMarketsRaw | null {
  const match = html.match(/var FMONE_MARKETS = (\{[\s\S]*?\});/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as FmoneMarketsRaw;
  } catch {
    return null;
  }
}

function extractCardBlock(html: string, marker: "pun" | "gas"): string | null {
  const re = new RegExp(
    `data-market-summary="${marker}"[\\s\\S]*?(?=</a>|data-market-summary=|<article)`,
    "i",
  );
  return html.match(re)?.[0] ?? null;
}

function pickFirst(block: string | null, patterns: RegExp[]): string | null {
  if (!block) return null;
  for (const pattern of patterns) {
    const m = block.match(pattern);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function monthlyAvgLabel(monthKey: string, unit: string): string {
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  const monthName =
    idx >= 0 && idx < 12
      ? [
          "Gennaio",
          "Febbraio",
          "Marzo",
          "Aprile",
          "Maggio",
          "Giugno",
          "Luglio",
          "Agosto",
          "Settembre",
          "Ottobre",
          "Novembre",
          "Dicembre",
        ][idx]
      : monthKey;
  return `Media ${monthName}${year ? ` ${year}` : ""}`;
}

function buildChartSeries(raw: FmoneMarketsRaw, year: number): MarketChartSeries | null {
  const punFactor = raw.conversion?.pun ?? 0.001;
  const gasFactor = raw.conversion?.gas ?? 0.0105833;
  const prefix = `${year}-`;

  const pun = raw.pun
    .filter((row) => row.date.startsWith(prefix))
    .map((row) => ({
      date: row.date,
      label: formatMonthLabel(row.date),
      value: Number((row.value * punFactor).toFixed(6)),
    }));

  const psv = raw.gas
    .filter((row) => row.date.startsWith(prefix))
    .map((row) => ({
      date: row.date,
      label: formatMonthLabel(row.date),
      value: Number((row.value * gasFactor).toFixed(6)),
    }));

  if (pun.length === 0 && psv.length === 0) return null;

  return {
    year,
    pun,
    psv,
    punUnit: raw.units?.pun ?? "€/kWh",
    psvUnit: raw.units?.gas ?? "€/Smc",
  };
}

function buildFromFmone(raw: FmoneMarketsRaw): MarketPrices {
  const punFactor = raw.conversion?.pun ?? 0.001;
  const gasFactor = raw.conversion?.gas ?? 0.0105833;
  const punUnit = raw.units?.pun ?? "€/kWh";
  const psvUnit = raw.units?.gas ?? "€/Smc";
  const dispatchUnit = raw.units?.dispatch ?? raw.dispatch?.unit ?? "€/kWh";

  const latestPunMonth = raw.pun.at(-1);
  const latestGasMonth = raw.gas.at(-1);
  const latestPunDaily = raw.pun_daily?.at(-1);
  const latestGasDaily = raw.gas_daily?.at(-1);

  const punDailyValue = latestPunDaily
    ? formatItDecimal(latestPunDaily.value * punFactor)
    : latestPunMonth
      ? formatItDecimal(latestPunMonth.value * punFactor)
      : "—";

  const psvDailyValue = latestGasDaily
    ? formatItDecimal(latestGasDaily.value * gasFactor)
    : latestGasMonth
      ? formatItDecimal(latestGasMonth.value * gasFactor)
      : "—";

  const punMonthKey = latestPunMonth?.date ?? "";
  const gasMonthKey = latestGasMonth?.date ?? "";

  const chartYear = latestPunMonth
    ? Number(latestPunMonth.date.slice(0, 4))
    : new Date().getFullYear();

  const dispatchValue = raw.dispatch?.value ?? 0.019902;

  return {
    pun: {
      label: "PUN Index GME",
      dailyValue: punDailyValue,
      dailyDate: latestPunDaily ? formatDayLabel(latestPunDaily.date) : "",
      monthlyAvg: latestPunMonth
        ? `${monthlyAvgLabel(punMonthKey, punUnit)}: ${formatItDecimal(latestPunMonth.value * punFactor)} ${punUnit}`
        : "—",
      unit: punUnit,
      href: "https://www.fmconsulenza.it/pun-luce/",
    },
    psv: {
      label: "PSV gas",
      dailyValue: psvDailyValue,
      dailyDate: latestGasDaily ? formatDayLabel(latestGasDaily.date) : "",
      monthlyAvg: latestGasMonth
        ? `${monthlyAvgLabel(gasMonthKey, psvUnit)}: ${formatItDecimal(latestGasMonth.value * gasFactor)} ${psvUnit}`
        : "—",
      unit: psvUnit,
      href: "https://www.fmconsulenza.it/psv-gas/",
    },
    dispatch: {
      label: "Dispacciamento ARERA",
      value: formatItDecimal(dispatchValue, 6),
      unit: dispatchUnit,
      hint: "Componente di sistema · valore ARERA",
    },
    chart: buildChartSeries(raw, chartYear),
    updatedAt: raw.dispatch?.updated_at
      ? new Date(raw.dispatch.updated_at).toLocaleString("it-IT")
      : null,
  };
}

function parseIndexBlock(
  block: string | null,
  label: string,
  defaultUnit: string,
  href: string,
): MarketIndex {
  const dailyValue =
    pickFirst(block, [/<b data-value>([^<]+)<\/b>/i, /<div class="market-number"><b>([^<]+)<\/b>/i]) ??
    "—";
  const monthlyAvg =
    pickFirst(block, [/data-month>([^<]+)<\/p>/i, /class="market-month-avg"[^>]*>([^<]+)<\/p>/i]) ??
    "—";
  const dayLabel = pickFirst(block, [/data-day-label>([^<]+)<\/p>/i]) ?? "";
  const unit = pickFirst(block, [/<small>([^<]+)<\/small>/i]) ?? defaultUnit;
  const dateMatch = dayLabel.match(/(\d{1,2}\/\d{1,2})/);

  return {
    label,
    dailyValue,
    dailyDate: dateMatch?.[1] ?? "",
    monthlyAvg,
    unit,
    href,
  };
}

export function parseMarketPricesHtml(html: string): MarketPrices | null {
  const fmone = parseFmoneMarketsJson(html);
  if (fmone) return buildFromFmone(fmone);

  if (!html.includes("market-summary")) return null;

  const punBlock = extractCardBlock(html, "pun");
  const psvBlock = extractCardBlock(html, "gas");
  const dispatchBlock = html.match(
    /market-summary-card dispatch[\s\S]*?<\/article>/i,
  )?.[0];

  const dispatchValue =
    pickFirst(dispatchBlock ?? null, [
      /<div class="market-number"><b>([^<]+)<\/b>/i,
    ]) ?? "0,019902";
  const dispatchUnit =
    pickFirst(dispatchBlock ?? null, [/<small>([^<]+)<\/small>/i]) ?? "€/kWh";

  const updatedAt =
    html.match(/Ultimo aggiornamento dati:\s*([^.<]+)/i)?.[1]?.trim() ?? null;

  return {
    pun: parseIndexBlock(punBlock, "PUN Index GME", "€/kWh", "https://www.fmconsulenza.it/pun-luce/"),
    psv: parseIndexBlock(psvBlock, "PSV gas", "€/Smc", "https://www.fmconsulenza.it/psv-gas/"),
    dispatch: {
      label: "Dispacciamento ARERA",
      value: dispatchValue,
      unit: dispatchUnit,
      hint: "Componente di sistema · valore ARERA",
    },
    chart: null,
    updatedAt,
  };
}

export async function fetchMarketPrices(): Promise<MarketPrices | null> {
  try {
    const res = await fetch(MERCATI_URL, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "FM-CRM-Dashboard/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseMarketPricesHtml(html);
  } catch {
    return null;
  }
}
