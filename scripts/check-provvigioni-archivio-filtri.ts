/**
 * I menu filtro di Provvigioni non mostrano le etichette interne `_archivio_…`.
 * I contratti e i fornitori restano nel database: si toglie solo la voce.
 *
 * Uso: npx tsx scripts/check-provvigioni-archivio-filtri.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isArchivioInternalLabel,
  omitArchivioFilterOptions,
} from "../src/lib/supplier-names";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const archived = [
  "_archivio_edison_dei9bc",
  "_archivio_enel_61lurk",
  "_archivio_enel_sb9vsp",
  "_archivio_enel_swtlz5",
];

console.log("\n• Le quattro etichette di archivio non sono voci di menu");
for (const name of archived) {
  check(name, isArchivioInternalLabel(name), true);
}

console.log("\n• Fornitore, agenzia e gli altri campi veri restano");
const menu = omitArchivioFilterOptions([
  "Edison",
  ...archived,
  "Enel",
  "Helios",
  "MADA",
  "Achille",
  "120",
  "2026-09",
  "(vuoto)",
  "nota _archivio_ nel testo",
]);
check("menu fornitore e altri campi", menu, [
  "Edison",
  "Enel",
  "Helios",
  "MADA",
  "Achille",
  "120",
  "2026-09",
  "(vuoto)",
  "nota _archivio_ nel testo",
]);

console.log("\n• Solo il prefisso iniziale, anche con spazi");
check("spazi", isArchivioInternalLabel("  _archivio_enel_x"), true);
check("in mezzo al nome", isArchivioInternalLabel("Enel _archivio_x"), false);
check("maiuscolo diverso", isArchivioInternalLabel("_ARCHIVIO_enel"), false);

console.log("\n• Provvigioni applica il filtro su query, API e tendina");
const root = process.cwd();
const page = readFileSync(
  join(root, "src/app/(dashboard)/provvigioni/page.tsx"),
  "utf8",
);
const options = readFileSync(
  join(root, "src/lib/provvigioni-filter-options.ts"),
  "utf8",
);
const table = readFileSync(
  join(root, "src/components/provvigioni/provvigioni-filter-table.tsx"),
  "utf8",
);
const excel = readFileSync(
  join(root, "src/components/table/excel-filter-table.tsx"),
  "utf8",
);
check(
  "elenco fornitori senza etichette archivio",
  page.includes('{ NOT: { name: { startsWith: "_archivio_" } } }'),
  true,
);
check(
  "opzioni dal database senza etichette",
  options.includes("omitArchivioFilterOptions"),
  true,
);
check(
  "tendina Provvigioni omette il prefisso",
  table.includes("omitFilterOption={isArchivioInternalLabel}"),
  true,
);
check(
  "il menu Cerca/Tutti/Nessuno rispetta l’omissione",
  excel.includes("omitFilterOption"),
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check falliti (etichette archivio nei filtri)`);
  process.exit(1);
}
console.log("\n✅ Menu filtri Provvigioni: etichette _archivio_ nascoste.");
