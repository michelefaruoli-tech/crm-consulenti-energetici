/**
 * Verifica logica bonifica annuali anni passati (senza DB).
 * Uso: npx tsx scripts/check-annual-past-years.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANNUAL_PAST_YEARS_MONTH_NOTE,
  ANNUAL_PAST_YEARS_OPEN_FROM,
  annualUnitCompetencePeriod,
  isAnnualPastPeriod,
  shouldLiquidateAnnualContractUnit,
  shouldLiquidateAnnualMonth,
} from "../src/lib/annual-past-years-shared";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  console.log(
    `${ok ? "✅" : "❌"} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
  if (!ok) failures += 1;
}

check("openFrom default = 2026-01", ANNUAL_PAST_YEARS_OPEN_FROM, "2026-01");

check("2024-03 è passato", isAnnualPastPeriod("2024-03"), true);
check("2025-12 è passato", isAnnualPastPeriod("2025-12"), true);
check("2026-01 NON è passato", isAnnualPastPeriod("2026-01"), false);
check("2026-03 NON è passato", isAnnualPastPeriod("2026-03"), false);
check("periodo invalido", isAnnualPastPeriod("2024"), false);

check(
  "PENDING 2024 da liquidare",
  shouldLiquidateAnnualMonth({ period: "2024-03", status: "PENDING" }),
  true,
);
check(
  "PAID 2025 da liquidare",
  shouldLiquidateAnnualMonth({ period: "2025-03", status: "PAID" }),
  true,
);
check(
  "LIQUIDATED 2024 skip",
  shouldLiquidateAnnualMonth({ period: "2024-03", status: "LIQUIDATED" }),
  false,
);
check(
  "PENDING 2026 NON liquidare",
  shouldLiquidateAnnualMonth({ period: "2026-03", status: "PENDING" }),
  false,
);
check(
  "LIQUIDATED 2026 NON toccare",
  shouldLiquidateAnnualMonth({ period: "2026-03", status: "LIQUIDATED" }),
  false,
);

check(
  "unità 2024 aperta da liquidare",
  shouldLiquidateAnnualContractUnit({
    status: "PAGATO_DAL_FORNITORE",
    unitPeriod: "2024-03",
  }),
  true,
);
check(
  "unità già LIQUIDATA skip",
  shouldLiquidateAnnualContractUnit({
    status: "PROVVIGIONE_LIQUIDATA",
    unitPeriod: "2024-03",
  }),
  false,
);
check(
  "unità 2026 NON liquidare",
  shouldLiquidateAnnualContractUnit({
    status: "IN_ATTESA_PAGAMENTO",
    unitPeriod: "2026-03",
  }),
  false,
);
check(
  "KO non liquidare",
  shouldLiquidateAnnualContractUnit({
    status: "KO",
    unitPeriod: "2024-03",
  }),
  false,
);

const unit = annualUnitCompetencePeriod(
  new Date(2024, 2, 1),
  null,
  new Date(2024, 0, 15),
);
check("unitCompetence da supplyStart", unit, "2024-03");

check(
  "nota bonifica definita",
  ANNUAL_PAST_YEARS_MONTH_NOTE.includes("pre-2026"),
  true,
);

const syncSrc = readFileSync(
  join(process.cwd(), "src/lib/recurring-sync.ts"),
  "utf8",
);
check(
  "sync richiama annual past-years auto",
  syncSrc.includes("runAnnualPastYearsCleanupAuto") &&
    syncSrc.includes("annual-past-years-cleanup"),
  true,
);

const backupCron = readFileSync(
  join(process.cwd(), "src/app/api/cron/daily-backup/route.ts"),
  "utf8",
);
check(
  "daily-backup richiama annual past-years",
  backupCron.includes("runAnnualPastYearsCleanupAuto"),
  true,
);

const cleanupSrc = readFileSync(
  join(process.cwd(), "src/lib/annual-past-years-cleanup.ts"),
  "utf8",
);
check(
  "cleanup non usa updateMany",
  !cleanupSrc.includes(".updateMany("),
  true,
);
check(
  "cleanup non usa $transaction",
  !cleanupSrc.includes("$transaction("),
  true,
);
check(
  "cleanup filtra solo recurrenceKind R",
  cleanupSrc.includes('recurrenceKind: "R"'),
  true,
);

const panelSrc = readFileSync(
  join(
    process.cwd(),
    "src/components/backup/annual-past-years-panel.tsx",
  ),
  "utf8",
);
check(
  "panel client non importa cleanup server-only",
  !panelSrc.includes("annual-past-years-cleanup") &&
    panelSrc.includes("annual-past-years-actions"),
  true,
);

const backupPage = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/backup/page.tsx"),
  "utf8",
);
check(
  "Backup page monta AnnualPastYearsCleanupPanel",
  backupPage.includes("AnnualPastYearsCleanupPanel"),
  true,
);

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };
check(
  "build production applica annual past-years",
  String(pkg.scripts.build ?? "").includes("db:annual-past-years:prod"),
  true,
);
check(
  "script db:annual-past-years:prod presente",
  String(pkg.scripts["db:annual-past-years:prod"] ?? "").includes(
    "--apply-if-production",
  ),
  true,
);

if (failures > 0) {
  console.error(`\n❌ check-annual-past-years: ${failures} falliti`);
  process.exit(1);
}
console.log("✅ check-annual-past-years ok");
