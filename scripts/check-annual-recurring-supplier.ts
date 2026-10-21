/**
 * Guardrail: default ricorrenza annuale (R) per Duferco/Sinergy/Etruria/Dolomiti.
 * Uso: npx tsx scripts/check-annual-recurring-supplier.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAnnualRecurringSupplier } from "../src/lib/helios-contract-rules";

let failures = 0;

function check(name: string, got: unknown, expected: unknown) {
  if (got !== expected) {
    failures += 1;
    console.error(`❌ ${name}\n   got: ${String(got)}\n   expected: ${String(expected)}`);
    return;
  }
  console.log(`✅ ${name}`);
}

check("Duferco", isAnnualRecurringSupplier("Duferco"), true);
check("Duferco Energia", isAnnualRecurringSupplier("Duferco Energia"), true);
check("duferco energia spa", isAnnualRecurringSupplier("duferco energia spa"), true);
check("Sinergy", isAnnualRecurringSupplier("Sinergy"), true);
check("Etruria", isAnnualRecurringSupplier("Etruria"), true);
check("Dolomiti Energia", isAnnualRecurringSupplier("Dolomiti Energia"), true);
check("Helios", isAnnualRecurringSupplier("Helios"), false);
check("Enel", isAnnualRecurringSupplier("Enel"), false);
check("vuoto", isAnnualRecurringSupplier(""), false);
check("null", isAnnualRecurringSupplier(null), false);

const createAction = readFileSync(
  join(process.cwd(), "src/lib/contract-create-action.ts"),
  "utf8",
);
check(
  "create usa isAnnualRecurringSupplier",
  createAction.includes("isAnnualRecurringSupplier"),
  true,
);
check(
  "create scrive R per annuali",
  createAction.includes('recurrenceWriteData("R")'),
  true,
);

const script = readFileSync(
  join(process.cwd(), "scripts/set-duferco-annual-r.ts"),
  "utf8",
);
check(
  "script Duferco usa recurrenceWriteData R",
  script.includes('recurrenceWriteData("R")'),
  true,
);
check(
  "script Duferco sync rate",
  script.includes("syncRecurringMonthsForContract"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\ncheck-annual-recurring-supplier: ok");
