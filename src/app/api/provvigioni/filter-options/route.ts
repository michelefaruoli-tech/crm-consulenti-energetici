import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { loadProvvigioniFilterOptions } from "@/lib/provvigioni-filter-options";
import {
  COLUMN_FILTER_KEYS,
  TEXT_FILTER_KEYS,
  type ProvvigioniColumnKey,
} from "@/lib/provvigioni-column-filters";

export const dynamic = "force-dynamic";

/** Valori dei menu filtro della tabella Provvigioni, presi da tutto il database. */
export async function GET(request: Request) {
  const session = await requireSession();
  const url = new URL(request.url);
  const col = (url.searchParams.get("col") ?? "") as ProvvigioniColumnKey;
  if (!COLUMN_FILTER_KEYS.includes(col) || TEXT_FILTER_KEYS.includes(col)) {
    return NextResponse.json(
      { error: "Colonna non filtrabile da elenco" },
      { status: 400 },
    );
  }

  const sp: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    sp[key] = value;
  });

  return NextResponse.json(await loadProvvigioniFilterOptions(session, sp, col));
}
