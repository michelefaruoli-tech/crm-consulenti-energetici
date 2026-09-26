/**
 * Report «Da incassare» deve coincidere con Provvigioni (stesso team/collab).
 * Caso Blasucci: 60 € UT + 4 € rata Helios fuori mese Report → 64 €.
 *
 * Uso: npx tsx scripts/check-report-provvigioni-da-incassare.ts
 */
import {
  buildReportRecurringWhere,
  reportRecurringHeliosLagWhere,
} from "../src/lib/report-recurring";
import {
  buildRendiconto,
  reportIncassatoAmount,
  type RendicontoIncassatoSource,
} from "../src/lib/report-rendiconto";
import { compareReportProvvigioniDaIncassare } from "../src/lib/report-provvigioni-totals";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Rate Da incassare: nessun filtro periodo (mese Report ≠ competenza)");
{
  const where = buildReportRecurringWhere({
    from: "2026-09-01",
    to: "2026-09-30",
    month: "2026-09",
    stato: "Da incassare",
    competenceOnly: true,
    visibility: {},
    collaboratorId: "collab-genzano",
  });
  const serialized = JSON.stringify(where);
  check(
    "include ramo PENDING senza period in periods",
    serialized.includes("PENDING") && !serialized.includes('"period":{"in":["2026-09"]}'),
    true,
  );
}

console.log("\n• Rate Incassato: periodo competenza ancora applicato");
{
  const where = buildReportRecurringWhere({
    from: "2026-09-01",
    to: "2026-09-30",
    month: "2026-09",
    stato: "Incassato",
    competenceOnly: true,
    visibility: {},
  });
  check(
    "PAID nel mese",
    JSON.stringify(where).includes('"period":{"in":["2026-09"]}'),
    true,
  );
}

console.log("\n• Tutti: OR tra rate pagate nel mese e da incassare senza periodo");
{
  const where = buildReportRecurringWhere({
    month: "2026-09",
    from: "2026-09-01",
    to: "2026-09-30",
    stato: "Tutti",
    competenceOnly: true,
    visibility: {},
  });
  const s = JSON.stringify(where);
  check("ha OR", s.includes('"OR"'), true);
  check("include PAID con periodo", s.includes("PAID"), true);
  check("include PENDING senza vincolo unico periodo su tutto il where", s.includes("PENDING"), true);
}

console.log("\n• Caso 60+4: una tantum + rata 4 € (simulazione totali Report)");
{
  const ut60: RendicontoIncassatoSource = {
    contractNumber: "UT-60",
    collectionDate: null,
    insertionDate: new Date(2026, 5, 1),
    status: "IN_ATTESA_PAGAMENTO",
    podPdr: "IT001E000001",
    pod: null,
    pdr: null,
    collaborator: { name: "Genzano L." },
    supplier: { name: "Enel" },
    client: { type: "PRIVATO", companyName: null, firstName: "A", lastName: "B" },
    commission: { received: 60, expected: 60 },
    recurrence: "Una tantum",
  };
  const recurringAmount = 4;
  const oneShotTotal = reportIncassatoAmount(ut60.commission, {
    clientType: ut60.client.type ?? "",
    supplierName: ut60.supplier.name,
  });
  const reportTotal = oneShotTotal + recurringAmount;
  const alignment = compareReportProvvigioniDaIncassare(reportTotal, 64);
  check("totale Report 64", reportTotal, 64);
  check("allineamento Provvigioni", alignment.ok, true);

  const rendiconto = buildRendiconto({
    contracts: [ut60],
    stornoRows: [],
    recurringRows: [
      {
        id: "r1",
        contractId: "c-helios",
        period: "2026-07",
        settledPeriod: null,
        amount: 4,
        paidAt: null,
        contractNumber: "M-4",
        podPdr: "IT001E89300588",
        collaboratorId: "collab-genzano",
        collaboratorName: "Genzano L.",
        supplierName: "Helios",
        clientName: "Malatesta Donato",
        clientType: "PRIVATO",
      },
    ],
    incassatoMonths: ["2026-09"],
    inlineRecurring: true,
  });
  check("rendiconto inline include rata 4 €", rendiconto.totIncassato, 64);
}

console.log("\n• Helios lag: stessa clausola NOT di Provvigioni");
{
  const lag = reportRecurringHeliosLagWhere(new Date(2026, 8, 26));
  check("esclude competenze oltre lag", JSON.stringify(lag).includes("NOT"), true);
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Report / Provvigioni Da incassare: verifiche superate.");
