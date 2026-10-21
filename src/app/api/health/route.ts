import { NextResponse } from "next/server";
import { HEALTH_CDN_CACHE_HEADERS } from "@/lib/cdn-cache-headers";

export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: HEALTH_CDN_CACHE_HEADERS },
  );
}
