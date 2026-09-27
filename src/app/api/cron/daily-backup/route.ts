import { NextResponse } from "next/server";
import { runDbExcelBackup } from "@/lib/db-backup-runner";
import { authorizeCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backup Excel GIORNALIERO → email (sempre, anche senza nuovi contratti).
 * Vercel Cron ~22:00 Italia. Authorization Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sempre: punto di ripristino dati ogni sera (salta solo se già inviato oggi).
  const result = await runDbExcelBackup({
    mode: "cron",
    force: false,
  });

  // Helios M+2: bonifica rate anticipate (ago/set a settembre) senza click.
  let heliosCleanup: {
    closed: number;
    deleted: number;
    done: boolean;
    lastPayableCompetence: string;
  } | null = null;
  try {
    const { runHeliosAnticipatoryCleanupAuto } = await import(
      "@/lib/helios-anticipatory-cleanup"
    );
    const cleanup = await runHeliosAnticipatoryCleanupAuto();
    heliosCleanup = {
      closed: cleanup.closed,
      deleted: cleanup.deleted,
      done: cleanup.done,
      lastPayableCompetence: cleanup.lastPayableCompetence,
    };
  } catch (e) {
    console.error("[daily-backup] helios anticipatory cleanup", e);
  }

  // Annuali R: competenze < 2026 liquidate; 2026+ aperte. Idempotente.
  let annualPastYearsCleanup: {
    monthsLiquidated: number;
    contractsLiquidated: number;
    openKept: number;
    done: boolean;
  } | null = null;
  try {
    const { runAnnualPastYearsCleanupAuto } = await import(
      "@/lib/annual-past-years-cleanup"
    );
    const cleanup = await runAnnualPastYearsCleanupAuto();
    annualPastYearsCleanup = {
      monthsLiquidated: cleanup.monthsLiquidated,
      contractsLiquidated: cleanup.contractsLiquidated,
      openKept: cleanup.openKept,
      done: cleanup.done,
    };
  } catch (e) {
    console.error("[daily-backup] annual past-years cleanup", e);
  }

  return NextResponse.json(
    { ...result, heliosCleanup, annualPastYearsCleanup },
    {
      status: result.ok || result.skipped ? 200 : 500,
    },
  );
}
