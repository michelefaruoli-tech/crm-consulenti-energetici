import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { runHeliosAnticipatoryCleanupAuto } from "@/lib/helios-anticipatory-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chiude/elimina rate Helios con competenza oltre lastPayable (M+2).
 * Idempotente. Invocabile con Bearer CRON_SECRET.
 * In produzione gira anche da sync Provvigioni e da daily-backup (senza cron dedicato:
 * un cron orario faceva fallire il deploy sul piano attuale).
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
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
