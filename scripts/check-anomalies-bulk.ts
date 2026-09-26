/**
 * Verifica classificazione bonifica anomalie (elimina prima inizio / segna pagate).
 * Uso: npx tsx scripts/check-anomalies-bulk.ts
 */
import { classifyAnomalyMonth } from "../src/lib/anomalies-bulk";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const window = { start: "2026-05", end: null as string | null };

console.log("\n• Prima dell'inizio fornitura → elimina");
{
  const r = classifyAnomalyMonth({
    period: "2026-04",
    status: "PENDING",
    window,
  });
  check("decision", r.decision, "delete_before_start");
}

console.log("\n• Prima dell'inizio anche se ERROR_UNPAID → elimina");
{
  const r = classifyAnomalyMonth({
    period: "2026-01",
    status: "ERROR_UNPAID",
    window,
  });
  check("decision", r.decision, "delete_before_start");
}

console.log("\n• In intervallo PENDING → segna pagata");
{
  const r = classifyAnomalyMonth({
    period: "2026-05",
    status: "PENDING",
    window,
  });
  check("decision", r.decision, "mark_paid");
}

console.log("\n• In intervallo MISSING → segna pagata");
{
  const r = classifyAnomalyMonth({
    period: "2026-06",
    status: "MISSING",
    window,
  });
  check("decision", r.decision, "mark_paid");
}

console.log("\n• In intervallo ASSENTE_RENDICONTO (ERROR_UNPAID) → segna pagata");
{
  const r = classifyAnomalyMonth({
    period: "2026-07",
    status: "ERROR_UNPAID",
    window,
  });
  check("decision", r.decision, "mark_paid");
}

console.log("\n• Già PAID in intervallo → salta");
{
  const r = classifyAnomalyMonth({
    period: "2026-08",
    status: "PAID",
    window,
  });
  check("decision", r.decision, "skip");
}

console.log("\n• Dopo chiusura → salta (non elimina automaticamente)");
{
  const r = classifyAnomalyMonth({
    period: "2026-12",
    status: "PENDING",
    window: { start: "2026-05", end: "2026-10" },
  });
  check("decision", r.decision, "skip");
}

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche fallite`);
  process.exit(1);
}
console.log("\n✅ Classificazione anomalie: verifiche superate.");
