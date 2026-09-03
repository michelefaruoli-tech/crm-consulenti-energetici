import { NextResponse } from "next/server";
import { lookupCityCap } from "@/lib/city-cap-lookup";

/** GET /api/cap/city?q=Manfredonia&province=FG → CAP + provincia */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = String(searchParams.get("q") ?? "").trim();
  const province = String(searchParams.get("province") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Indica almeno 2 caratteri del comune" },
      { status: 400 },
    );
  }

  const matches = await lookupCityCap(q, province || undefined);
  const first = matches[0];
  return NextResponse.json({
    found: matches.length > 0,
    multi: matches.length > 1,
    query: q,
    matches,
    city: matches.length === 1 ? first?.city ?? "" : "",
    province: matches.length === 1 ? first?.province ?? "" : "",
    region: matches.length === 1 ? first?.region ?? "" : "",
    zipCode: matches.length === 1 ? first?.zipCode ?? "" : "",
  });
}
