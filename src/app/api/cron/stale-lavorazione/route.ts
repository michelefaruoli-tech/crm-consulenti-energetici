import { NextResponse } from "next/server";
import { sendStaleLavorazioneAlerts } from "@/lib/stale-lavorazione-alert";
import { authorizeCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Alert Master: contratti In lavorazione da oltre 48 ore.
 * Vercel Cron: Authorization Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendStaleLavorazioneAlerts();
  return NextResponse.json({ ok: true, ...result });
}
