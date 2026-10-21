/**
 * Guardrail: sync globale su Provvigioni deve usare il path con cooldown
 * (Hobby Fluid Active CPU). Force resta su syncAllRecurringMonths altrove.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(label: string, cond: boolean, expected = true) {
  if (cond !== expected) {
    console.error(`FAIL: ${label}`);
    failures++;
  } else {
    console.log(`OK: ${label}`);
  }
}

const syncSrc = readFileSync(
  join(process.cwd(), "src/lib/recurring-sync.ts"),
  "utf8",
);
check(
  "esiste syncAllRecurringMonthsBackground con cooldown",
  syncSrc.includes("export async function syncAllRecurringMonthsBackground") &&
    syncSrc.includes("BACKGROUND_RECURRING_SYNC_COOLDOWN_MS") &&
    syncSrc.includes("skip cooldown"),
);
check(
  "syncAllRecurringMonths resta disponibile per force (Backup/cron/azioni)",
  syncSrc.includes("export async function syncAllRecurringMonths("),
);

const pageSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/provvigioni/page.tsx"),
  "utf8",
);
check(
  "Provvigioni usa syncAllRecurringMonthsBackground",
  pageSrc.includes("syncAllRecurringMonthsBackground"),
);
check(
  "Provvigioni non chiama syncAllRecurringMonths diretto",
  !pageSrc.includes("syncAllRecurringMonths(") &&
    !/\bvoid\s+syncAllRecurringMonths\s*\(/.test(pageSrc) &&
    !/\bawait\s+syncAllRecurringMonths\s*\(/.test(pageSrc),
);
check(
  "Provvigioni non rilancia reconcileAllRecurringBounds a ogni visita",
  !pageSrc.includes("reconcileAllRecurringBounds"),
);

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\nTutti i check OK");
