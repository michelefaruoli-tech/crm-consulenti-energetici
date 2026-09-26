/**
 * Verifica del bug "Report a zero con stato Tutti + mese di incasso, mentre
 * Provvigioni mostra righe Da incassare" (senza database).
 *
 * Caso concreto segnalato: Provvigioni, filtro Tutti/Genzano → Da incassare
 * 2 contratti, 64,00 €. Report, Mese di incasso Settembre 2026, Stato Tutti
 * → tutte le card a 0 (i 2 contratti non hanno mai un incasso, quindi non
 * possono avere un incasso "di settembre" — venivano scartati comunque).
 *
 * Root cause: `dateWhereForStato`/"Tutti" applicava `collectionDate` a
 * QUALSIASI stato, anche a chi non ha mai un incasso (Da incassare/Da
 * controllare/KO). Fix: «Da incassare» non ha vincolo di periodo (compare
 * sempre) e "Tutti" ora equivale a selezionare ogni stato singolarmente.
 *
 * Uso: npx tsx scripts/check-report-filters.ts
 */
import { buildRendiconto, type RendicontoIncassatoSource } from "../src/lib/report-rendiconto";
import { reportStatoHint, resolveReportStati } from "../src/lib/report-filters";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

function utContract(overrides: Partial<RendicontoIncassatoSource>): RendicontoIncassatoSource {
  return {
    contractNumber: "1",
    collectionDate: null,
    insertionDate: new Date(2026, 7, 10), // agosto 2026: mese diverso da quello scelto nel Report
    status: "IN_ATTESA_PAGAMENTO",
    podPdr: "IT001E000001",
    pod: null,
    pdr: null,
    collaborator: { name: "Luca Genzano" },
    supplier: { name: "Enel" },
    client: { type: "PRIVATO", companyName: null, firstName: "Mario", lastName: "Blasucci" },
    commission: { received: 32, expected: 32 },
    recurrence: "Una tantum",
    ...overrides,
  };
}

console.log("\n• Caso Blasucci: 2 contratti Da incassare, Report a Settembre 2026 (mese di incasso)");
{
  const contracts = [
    utContract({ contractNumber: "1001" }),
    utContract({ contractNumber: "1002" }),
  ];
  const rendiconto = buildRendiconto({
    contracts,
    stornoRows: [],
    recurringRows: [],
    incassatoMonths: ["2026-09"], // "Mese di incasso: Settembre 2026" selezionato nel Report
    inlineRecurring: false,
  });
  check("prima del fix sarebbero stati 0: ora entrambi entrano", rendiconto.countIncassato, 2);
  check("somma corretta: 64,00 €", rendiconto.totIncassato, 64);
}

console.log("\n• Un contratto realmente Incassato in agosto NON entra a Settembre (corretto)");
{
  const contracts = [
    utContract({ contractNumber: "2001", collectionDate: new Date(2026, 7, 15), status: "PAGATO_DAL_FORNITORE" }),
  ];
  const rendiconto = buildRendiconto({
    contracts,
    stornoRows: [],
    recurringRows: [],
    incassatoMonths: ["2026-09"],
    inlineRecurring: false,
  });
  check("incassato fuori mese: escluso", rendiconto.countIncassato, 0);
}

console.log("\n• Lo stesso contratto Incassato ENTRA se il mese scelto è quello giusto");
{
  const contracts = [
    utContract({ contractNumber: "2002", collectionDate: new Date(2026, 8, 3), status: "PAGATO_DAL_FORNITORE" }),
  ];
  const rendiconto = buildRendiconto({
    contracts,
    stornoRows: [],
    recurringRows: [],
    incassatoMonths: ["2026-09"],
    inlineRecurring: false,
  });
  check("incassato nel mese giusto: incluso", rendiconto.countIncassato, 1);
}

console.log("\n• Annuale (R) primo anno, ancora Da incassare: entra anche senza incasso");
{
  const contracts = [
    utContract({ contractNumber: "3001", recurrence: "R", collectionDate: null }),
  ];
  const rendiconto = buildRendiconto({
    contracts,
    stornoRows: [],
    recurringRows: [],
    incassatoMonths: ["2026-09"],
    inlineRecurring: false,
  });
  check("annuale primo anno Da incassare: incluso", rendiconto.countIncassato, 1);
}

console.log("\n• Senza nessun filtro mese (periodo personalizzato ampio): comportamento invariato");
{
  const contracts = [utContract({ contractNumber: "4001" })];
  const rendiconto = buildRendiconto({
    contracts,
    stornoRows: [],
    recurringRows: [],
    incassatoMonths: [],
    inlineRecurring: false,
  });
  check("nessun vincolo mese: incluso comunque", rendiconto.countIncassato, 1);
}

console.log("\n• Testo di aiuto UI: chiaro che «Da incassare» non ha un mese di incasso");
check(
  "hint «Da incassare» esplicita «sempre», non più «data inserimento»",
  reportStatoHint("Da incassare").includes("Nessun periodo"),
  true,
);
check(
  "hint «Tutti» spiega la regola per stato, non un unico campo data",
  reportStatoHint("Tutti").includes("Da incassare"),
  true,
);
check("«Tutti» risolto come singolo stato", resolveReportStati("Tutti"), ["Tutti"]);

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Filtri Report (Tutti / Da incassare): tutte le verifiche superate.");
