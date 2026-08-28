export type MarketIndex = {
  label: string;
  dailyValue: string;
  dailyDate: string;
  monthlyAvg: string;
  unit: string;
};

export type MarketPrices = {
  pun: MarketIndex;
  psv: MarketIndex;
  updatedAt: string | null;
};

const MERCATI_URL = "https://www.fmconsulenza.it/mercati/";

function extractCardBlock(html: string, marker: "pun" | "gas"): string | null {
  const re = new RegExp(
    `data-market-summary="${marker}"[\\s\\S]*?(?=</a>|data-market-summary=)`,
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

function parseIndexBlock(
  block: string | null,
  label: string,
  defaultUnit: string,
): MarketIndex {
  const dailyValue =
    pickFirst(block, [/<b data-value>([^<]+)<\/b>/i, /<div class="market-number"><b>([^<]+)<\/b>/i]) ??
    "—";
  const monthlyAvg =
    pickFirst(block, [/data-month>([^<]+)<\/p>/i, /class="market-month-avg"[^>]*>([^<]+)<\/p>/i]) ??
    "—";
  const dayLabel =
    pickFirst(block, [/data-day-label>([^<]+)<\/p>/i]) ?? "";
  const unit =
    pickFirst(block, [/<small>([^<]+)<\/small>/i]) ?? defaultUnit;

  const dateMatch = dayLabel.match(/(\d{1,2}\/\d{1,2})/);
  const dailyDate = dateMatch?.[1] ?? "";

  return {
    label,
    dailyValue,
    dailyDate,
    monthlyAvg,
    unit,
  };
}

export function parseMarketPricesHtml(html: string): MarketPrices | null {
  if (!html.includes("market-summary")) return null;

  const punBlock = extractCardBlock(html, "pun");
  const psvBlock = extractCardBlock(html, "gas");

  const updatedAt =
    html.match(/Ultimo aggiornamento dati:\s*([^.<]+)/i)?.[1]?.trim() ?? null;

  return {
    pun: parseIndexBlock(punBlock, "PUN Index GME", "€/kWh"),
    psv: parseIndexBlock(psvBlock, "PSV gas", "€/Smc"),
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
