/**
 * Verifica logica cleanup Helios anticipate (senza DB).
 * Uso: npx tsx scripts/check-helios-anticipatory.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  heliosLastPayableCompetence,
  isHeliosCompetenceNotYetPayable,
  HELIOS_RECURRING_GENERATION_LAG_MONTHS,
} from "../src/lib/helios-contract-rules";
import { lastGeneratedPeriod, RECURRING_AUTO_CLOSED_NOTE } from "../src/lib/recurring-window";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  console.log(`${ok ? "✅" : "❌"} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) failures += 1;
}

const now = new Date(2026, 8, 27); // 27 set 2026
const last = heliosLastPayableCompetence(now);
check("lastPayable settembre = 2026-07", last, "2026-07");

const window = {
  start: "2025-01",
  end: null as string | null,
};
check(
  "lastGeneratedPeriod lag2 = lastPayable",
  lastGeneratedPeriod(window, now, HELIOS_RECURRING_GENERATION_LAG_MONTHS),
  last,
);

for (const period of ["2026-08", "2026-09", "2026-10"]) {
  check(
    `${period} da bonificare a settembre`,
    isHeliosCompetenceNotYetPayable(period, now) && period > last,
    true,
  );
}
check(
  "2026-07 NON da bonificare",
  isHeliosCompetenceNotYetPayable("2026-07", now),
  false,
);
check(
  "2026-06 NON da bonificare",
  isHeliosCompetenceNotYetPayable("2026-06", now),
  false,
);

check(
  "nota chiusura auto heliosLag definita",
  RECURRING_AUTO_CLOSED_NOTE.heliosLag.includes("Helios"),
  true,
);

const cronSrc = readFileSync(
  join(process.cwd(), "src/app/api/cron/helios-anticipatory-cleanup/route.ts"),
  "utf8",
);
check(
  "cron Helios usa authorizeCronRequest (niente ?secret=)",
  cronSrc.includes("authorizeCronRequest") &&
    !cronSrc.includes('searchParams.get("secret")'),
  true,
);

const syncSrc = readFileSync(
  join(process.cwd(), "src/lib/recurring-sync.ts"),
  "utf8",
);
check(
  "isPeriodAllowedForContract blocca Helios oltre lastPayable",
  syncSrc.includes("isHeliosCompetenceNotYetPayable(period)") &&
    syncSrc.includes("isPeriodAllowedForContract"),
  true,
);
check(
  "syncAllRecurringMonths invoca cleanup auto",
  syncSrc.includes("runHeliosAnticipatoryCleanupAuto"),
  true,
);

const backupSrc = readFileSync(
  join(process.cwd(), "src/app/api/cron/daily-backup/route.ts"),
  "utf8",
);
check(
  "daily-backup invoca cleanup auto (zero click Michele)",
  backupSrc.includes("runHeliosAnticipatoryCleanupAuto"),
  true,
);

const panelSrc = readFileSync(
  join(process.cwd(), "src/components/provvigioni/helios-anticipatory-cleanup-panel.tsx"),
  "utf8",
);
check(
  "panel client non importa helios-anticipatory-cleanup (server-only)",
  !panelSrc.includes("helios-anticipatory-cleanup") &&
    panelSrc.includes("helios-anticipatory-shared"),
  true,
);

const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
check(
  "vercel.json senza cron orario Helios (limite piano)",
  !vercel.includes("helios-anticipatory-cleanup"),
  true,
);

if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite`);
  process.exit(1);
}
console.log("✅ check-helios-anticipatory ok");
