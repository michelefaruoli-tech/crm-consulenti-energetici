import { NextResponse } from "next/server";

/** Lookup CAP italiano via Zippopotam (senza API key). */
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
      return NextResponse.json({ found: false, cap: clean });
    }
    const data = (await res.json()) as {
      places?: { "place name"?: string; state?: string; "state abbreviation"?: string }[];
    };
    const place = data.places?.[0];
    return NextResponse.json({
      found: Boolean(place),
      cap: clean,
      city: place?.["place name"] ?? "",
      province: place?.["state abbreviation"] ?? "",
      region: place?.state ?? "",
      country: "Italia",
    });
  } catch {
    return NextResponse.json({ found: false, cap: clean });
  }
}
