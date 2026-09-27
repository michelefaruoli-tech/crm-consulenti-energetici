import { NextResponse } from "next/server";
import { runHeliosAnticipatoryCleanupAuto } from "@/lib/helios-anticipatory-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chiude/elimina rate Helios con competenza oltre lastPayable (M+2).
 * Idempotente. Vercel Cron: Authorization Bearer CRON_SECRET.
 * Anche invocato da sync Provvigioni (refresh lista = applica).
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

  const result = await runHeliosAnticipatoryCleanupAuto();
  return NextResponse.json({
    ok: true,
    closed: result.closed,
    deleted: result.deleted,
    skipped: result.skipped,
    batches: result.batches,
    done: result.done,
    lastPayableCompetence: result.lastPayableCompetence,
  });
}
