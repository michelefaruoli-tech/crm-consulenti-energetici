import { NextResponse } from "next/server";
import { sendStaleLavorazioneAlerts } from "@/lib/stale-lavorazione-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Alert Master: contratti In lavorazione da oltre 48 ore.
 * Vercel Cron: Authorization Bearer CRON_SECRET
 */
function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendStaleLavorazioneAlerts();
  return NextResponse.json({ ok: true, ...result });
}
