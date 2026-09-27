/**
 * Verifica logica cleanup Helios anticipate (senza DB).
 * Uso: npx tsx scripts/check-helios-anticipatory.ts
 */
import {
  heliosLastPayableCompetence,
  isHeliosCompetenceNotYetPayable,
} from "../src/lib/helios-contract-rules";
import { lastGeneratedPeriod } from "../src/lib/recurring-window";
import { HELIOS_RECURRING_GENERATION_LAG_MONTHS } from "../src/lib/helios-contract-rules";

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

if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite`);
  process.exit(1);
}
console.log("✅ check-helios-anticipatory ok");
