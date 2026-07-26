import { NextResponse } from "next/server";
import { runDbExcelBackup } from "@/lib/db-backup-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backup Excel GIORNALIERO → email (sempre, anche senza nuovi contratti).
 * Vercel Cron ~22:00 Italia. Authorization Bearer CRON_SECRET
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

  // Sempre: punto di ripristino dati ogni sera (salta solo se già inviato oggi).
  const result = await runDbExcelBackup({
    mode: "cron",
    force: false,
  });

  return NextResponse.json(result, {
    status: result.ok || result.skipped ? 200 : 500,
  });
}
