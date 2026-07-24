import { NextResponse } from "next/server";

type Place = {
  city: string;
  province: string;
  region: string;
  label: string;
};

/** Lookup CAP italiano: restituisce TUTTE le località (es. 85025 → Melfi). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ cap: string }> },
) {
  const { cap } = await context.params;
  const clean = cap.replace(/\D/g, "");
  if (clean.length !== 5) {
    return NextResponse.json({ error: "CAP non valido" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.zippopotam.us/it/${clean}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json({ found: false, cap: clean, places: [] });
    }
    const data = (await res.json()) as {
      places?: {
        "place name"?: string;
        state?: string;
        "state abbreviation"?: string;
      }[];
    };

    const places: Place[] = (data.places ?? []).map((p) => {
      const city = (p["place name"] ?? "").trim();
      const province = (p["state abbreviation"] ?? "").trim();
      const region = (p.state ?? "").trim();
      return {
        city,
        province,
        region,
        label: [city, province, region].filter(Boolean).join(" — "),
      };
    });

    // Dedup per città+provincia
    const seen = new Set<string>();
    const unique = places.filter((p) => {
      const k = `${p.city}|${p.province}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return Boolean(p.city);
    });

    // Preferisci comuni "principali": ordina per nome più corto / senza frazione tipica
    unique.sort((a, b) => {
      const score = (x: Place) =>
        (x.city.includes("(") ? 2 : 0) + (x.city.includes("-") ? 1 : 0) + x.city.length / 100;
      return score(a) - score(b);
    });

    const first = unique[0];
    return NextResponse.json({
      found: unique.length > 0,
      cap: clean,
      multi: unique.length > 1,
      places: unique,
      // retrocompatibilità: non auto-scegliere se multi
      city: unique.length === 1 ? first?.city ?? "" : "",
      province: unique.length === 1 ? first?.province ?? "" : "",
      region: unique.length === 1 ? first?.region ?? "" : "",
      country: "Italia",
    });
  } catch {
    return NextResponse.json({ found: false, cap: clean, places: [] });
  }
}
