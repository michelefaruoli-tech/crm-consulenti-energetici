import { NextResponse } from "next/server";
import { provinceSiglaFromCap } from "@/lib/italy-cap-province";

type Place = {
  city: string;
  province: string;
  region: string;
  label: string;
};

/** Lookup CAP italiano: restituisce TUTTE le località (es. 85025 → Melfi + PZ). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ cap: string }> },
) {
  const { cap } = await context.params;
  const clean = cap.replace(/\D/g, "");
  if (clean.length !== 5) {
    return NextResponse.json({ error: "CAP non valido" }, { status: 400 });
  }

  const fallbackProvince = provinceSiglaFromCap(clean);

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
      // Zippopotam IT lascia spesso vuota la sigla → usiamo la mappa CAP
      const fromApi = (p["state abbreviation"] ?? "").trim().toUpperCase();
      const province =
        fromApi.length === 2 ? fromApi : fallbackProvince;
      const region = (p.state ?? "").trim();
      return {
        city,
        province,
        region,
        label: [city, province, region].filter(Boolean).join(" — "),
      };
    });

    const seen = new Set<string>();
    const unique = places.filter((p) => {
      const k = `${p.city}|${p.province}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return Boolean(p.city);
    });

    unique.sort((a, b) => {
      const score = (x: Place) =>
        (x.city.includes("(") ? 2 : 0) +
        (x.city.includes("-") ? 1 : 0) +
        x.city.length / 100;
      return score(a) - score(b);
    });

    const first = unique[0];
    return NextResponse.json({
      found: unique.length > 0,
      cap: clean,
      multi: unique.length > 1,
      places: unique,
      city: unique.length === 1 ? first?.city ?? "" : "",
      province: unique.length === 1 ? first?.province ?? fallbackProvince : "",
      region: unique.length === 1 ? first?.region ?? "" : "",
      country: "Italia",
    });
  } catch {
    return NextResponse.json({ found: false, cap: clean, places: [] });
  }
}
