import {
  CAP_LOCAL_PLACES,
  normalizeProvinceSigla,
  provinceSiglaFromCap,
  regionFromProvinceSigla,
} from "@/lib/italy-cap-province";

export type CityCapMatch = {
  city: string;
  province: string;
  region: string;
  zipCode: string;
  label: string;
};

/** Comuni frequenti (CAP principale) — lookup veloce senza API esterne. */
const CITY_CAP_TABLE: Array<{
  city: string;
  aliases?: string[];
  province: string;
  zipCode: string;
}> = [
  // Puglia FG
  { city: "Manfredonia", province: "FG", zipCode: "71043" },
  { city: "Siponto", province: "FG", zipCode: "71043" },
  { city: "Foggia", province: "FG", zipCode: "71121" },
  { city: "San Severo", province: "FG", zipCode: "71016" },
  { city: "Cerignola", province: "FG", zipCode: "71042" },
  { city: "Lucera", province: "FG", zipCode: "71036" },
  { city: "San Giovanni Rotondo", province: "FG", zipCode: "71013" },
  { city: "Vieste", province: "FG", zipCode: "71019" },
  { city: "Monte Sant'Angelo", aliases: ["monte santangelo"], province: "FG", zipCode: "71037" },
  // Puglia altre
  { city: "Bari", province: "BA", zipCode: "70121" },
  { city: "Brindisi", province: "BR", zipCode: "72100" },
  { city: "Lecce", province: "LE", zipCode: "73100" },
  { city: "Taranto", province: "TA", zipCode: "74121" },
  { city: "Andria", province: "BT", zipCode: "76123" },
  { city: "Barletta", province: "BT", zipCode: "76121" },
  { city: "Trani", province: "BT", zipCode: "76125" },
  // Basilicata
  { city: "Melfi", province: "PZ", zipCode: "85025" },
  { city: "Potenza", province: "PZ", zipCode: "85100" },
  { city: "Matera", province: "MT", zipCode: "75100" },
  // Capoluoghi utili
  { city: "Roma", province: "RM", zipCode: "00100" },
  { city: "Milano", province: "MI", zipCode: "20121" },
  { city: "Napoli", province: "NA", zipCode: "80121" },
  { city: "Torino", province: "TO", zipCode: "10121" },
  { city: "Firenze", province: "FI", zipCode: "50121" },
  { city: "Bologna", province: "BO", zipCode: "40121" },
  { city: "Palermo", province: "PA", zipCode: "90121" },
  { city: "Catania", province: "CT", zipCode: "95121" },
  { city: "Genova", province: "GE", zipCode: "16121" },
  { city: "Venezia", province: "VE", zipCode: "30121" },
  { city: "Verona", province: "VR", zipCode: "37121" },
  { city: "Padova", province: "PD", zipCode: "35121" },
  { city: "Trieste", province: "TS", zipCode: "34121" },
  { city: "Perugia", province: "PG", zipCode: "06121" },
  { city: "Ancona", province: "AN", zipCode: "60121" },
  { city: "Cagliari", province: "CA", zipCode: "09121" },
  { city: "Reggio Calabria", aliases: ["reggio di calabria"], province: "RC", zipCode: "89121" },
  { city: "Messina", province: "ME", zipCode: "98121" },
  { city: "Salerno", province: "SA", zipCode: "84121" },
  { city: "Pescara", province: "PE", zipCode: "65121" },
  { city: "L'Aquila", aliases: ["laquila", "aquila"], province: "AQ", zipCode: "67100" },
];

function normCity(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fromLocalTable(
  cityQuery: string,
  provinceHint?: string,
): CityCapMatch[] {
  const q = normCity(cityQuery);
  if (q.length < 2) return [];
  const prov = provinceHint ? normalizeProvinceSigla(provinceHint) : "";

  const out: CityCapMatch[] = [];
  for (const row of CITY_CAP_TABLE) {
    const names = [row.city, ...(row.aliases ?? [])].map(normCity);
    const hit =
      names.some((n) => n === q) ||
      names.some((n) => n.startsWith(q) && q.length >= 4);
    if (!hit) continue;
    if (prov && row.province !== prov) continue;
    const region = regionFromProvinceSigla(row.province);
    out.push({
      city: row.city,
      province: row.province,
      region,
      zipCode: row.zipCode,
      label: [row.city, row.province, row.zipCode].filter(Boolean).join(" — "),
    });
  }
  return out;
}

function fromCapLocalPlaces(
  cityQuery: string,
  provinceHint?: string,
): CityCapMatch[] {
  const q = normCity(cityQuery);
  if (q.length < 2) return [];
  const prov = provinceHint ? normalizeProvinceSigla(provinceHint) : "";
  const out: CityCapMatch[] = [];
  for (const [zip, places] of Object.entries(CAP_LOCAL_PLACES)) {
    for (const p of places) {
      if (normCity(p.city) !== q && !normCity(p.city).startsWith(q)) continue;
      if (prov && p.province !== prov) continue;
      out.push({
        city: p.city,
        province: p.province,
        region: p.region,
        zipCode: zip,
        label: [p.city, p.province, zip].filter(Boolean).join(" — "),
      });
    }
  }
  return out;
}

async function fromNominatim(
  cityQuery: string,
  provinceHint?: string,
): Promise<CityCapMatch[]> {
  const q = cityQuery.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({
    format: "json",
    addressdetails: "1",
    countrycodes: "it",
    limit: "5",
    city: q,
  });
  if (provinceHint) {
    // Nominatim usa county/state liberi; passiamo la sigla nel free-form
    params.set("q", `${q} ${provinceHint} Italia`);
    params.delete("city");
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "CRMSuite-Energia/1.0 (indirizzi CAP Italia)",
      },
      next: { revalidate: 86400 },
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    address?: {
      city?: string;
      town?: string;
      village?: string;
      municipality?: string;
      postcode?: string;
      county?: string;
      state?: string;
    };
  }>;

  const out: CityCapMatch[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const a = row.address ?? {};
    const city =
      a.city || a.town || a.village || a.municipality || q;
    const zip = String(a.postcode ?? "").replace(/\D/g, "").slice(0, 5);
    if (zip.length !== 5) continue;
    // Provincia: spesso in county tipo "Foggia" — mappiamo via CAP
    const province =
      (provinceHint ? normalizeProvinceSigla(provinceHint) : "") ||
      provinceSiglaFromCap(zip);
    const key = `${normCity(city)}|${zip}|${province}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const region =
      a.state || regionFromProvinceSigla(province) || "";
    out.push({
      city,
      province,
      region,
      zipCode: zip,
      label: [city, province, zip].filter(Boolean).join(" — "),
    });
  }
  return out;
}

/**
 * Cerca CAP/provincia da nome comune (locale + Nominatim).
 */
export async function lookupCityCap(
  cityQuery: string,
  provinceHint?: string,
): Promise<CityCapMatch[]> {
  const local = [
    ...fromLocalTable(cityQuery, provinceHint),
    ...fromCapLocalPlaces(cityQuery, provinceHint),
  ];
  // Dedup
  const seen = new Set<string>();
  const unique: CityCapMatch[] = [];
  for (const m of local) {
    const k = `${normCity(m.city)}|${m.zipCode}|${m.province}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(m);
  }
  if (unique.length > 0) return unique;

  try {
    return await fromNominatim(cityQuery, provinceHint);
  } catch {
    return [];
  }
}
