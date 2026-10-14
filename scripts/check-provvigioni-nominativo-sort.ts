/**
 * Nominativo in Provvigioni: il clic ordina l'elenco già filtrato
 * (es. Helios + settembre) sul nome visibile in cella, poi pagina.
 *
 * Uso: npx tsx scripts/check-provvigioni-nominativo-sort.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pageByVisibleClientName,
  sortByVisibleClientName,
  visibleClientName,
} from "../src/lib/provvigioni-client-sort";
import { clientSortKey } from "../src/lib/utils";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

type Row = {
  client: {
    type: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  pod: string;
  amount: number;
  stato: string;
};

/** Elenco Helios/settembre in ordine di inserimento, non alfabetico. */
const filtered: Row[] = [
  {
    client: { type: "PRIVATO", lastName: "MARANO", firstName: "ERNESTO" },
    pod: "IT001E74236655",
    amount: 4,
    stato: "Da incassare",
  },
  {
    client: { type: "PRIVATO", lastName: "ALBANESE", firstName: "VALERIA" },
    pod: "IT001E71921483",
    amount: 6,
    stato: "Da incassare",
  },
  {
    client: {
      type: "PRIVATO",
      lastName: "LIOI",
      firstName: "MARIA",
      companyName: "ZZZ ENERGIA",
    },
    pod: "IT001E89188339",
    amount: 4,
    stato: "Incassato",
  },
  {
    client: {
      type: "AZIENDA",
      companyName: "ELITE LOGRIPPO SILVIA",
      lastName: "ROSSI",
      firstName: "LUCA",
    },
    pod: "IT001E89110239",
    amount: 10,
    stato: "Da incassare",
  },
  {
    client: { type: "PRIVATO", lastName: "CIGNARALE", firstName: "SALVATORE" },
    pod: "IT001E89326021",
    amount: 6,
    stato: "Da incassare",
  },
  {
    client: { type: "PRIVATO", lastName: "BIANCHI", firstName: "ANNA" },
    pod: "IT001E00000001",
    amount: 4,
    stato: "Da incassare",
  },
];

const ascNames = [
  "ALBANESE VALERIA",
  "BIANCHI ANNA",
  "CIGNARALE SALVATORE",
  "ELITE LOGRIPPO SILVIA",
  "LIOI MARIA",
  "MARANO ERNESTO",
];

console.log("\n• Nome visibile, non la ragione sociale del privato");
check(
  "cella LIOI",
  visibleClientName(filtered[2]!.client),
  "LIOI MARIA",
);
check(
  "chiave vecchia metterebbe LIOI in fondo",
  clientSortKey(filtered[2]!.client),
  "zzz energia",
);
check(
  "azienda: cella = ragione sociale",
  visibleClientName(filtered[3]!.client),
  "ELITE LOGRIPPO SILVIA",
);

console.log("\n• A→Z sull'elenco filtrato intero, poi la pagina");
const asc = sortByVisibleClientName(filtered, (row) => row.client, "asc", (a, b) =>
  a.pod.localeCompare(b.pod),
);
check(
  "ordine A→Z",
  asc.map((row) => visibleClientName(row.client)),
  ascNames,
);
check(
  "importi e stati restano attaccati alla riga",
  asc.map((row) => [visibleClientName(row.client), row.amount, row.stato, row.pod]),
  [
    ["ALBANESE VALERIA", 6, "Da incassare", "IT001E71921483"],
    ["BIANCHI ANNA", 4, "Da incassare", "IT001E00000001"],
    ["CIGNARALE SALVATORE", 6, "Da incassare", "IT001E89326021"],
    ["ELITE LOGRIPPO SILVIA", 10, "Da incassare", "IT001E89110239"],
    ["LIOI MARIA", 4, "Incassato", "IT001E89188339"],
    ["MARANO ERNESTO", 4, "Da incassare", "IT001E74236655"],
  ],
);

const page1 = pageByVisibleClientName(
  filtered,
  (row) => row.client,
  "asc",
  0,
  2,
  (a, b) => a.pod.localeCompare(b.pod),
);
const page2 = pageByVisibleClientName(
  filtered,
  (row) => row.client,
  "asc",
  2,
  2,
  (a, b) => a.pod.localeCompare(b.pod),
);
check(
  "pagina 1 dopo l'ordine",
  page1.map((row) => visibleClientName(row.client)),
  ["ALBANESE VALERIA", "BIANCHI ANNA"],
);
check(
  "pagina 2 non è la fetta non ordinata",
  page2.map((row) => visibleClientName(row.client)),
  ["CIGNARALE SALVATORE", "ELITE LOGRIPPO SILVIA"],
);

console.log("\n• Secondo clic: Z→A");
const desc = sortByVisibleClientName(filtered, (row) => row.client, "desc", (a, b) =>
  a.pod.localeCompare(b.pod),
);
check(
  "ordine Z→A",
  desc.map((row) => visibleClientName(row.client)),
  [...ascNames].reverse(),
);

const sameName: Row[] = [
  {
    client: { type: "PRIVATO", lastName: "ROSSI", firstName: "MARIO" },
    pod: "IT001E00000009",
    amount: 4,
    stato: "Da incassare",
  },
  {
    client: { type: "PRIVATO", lastName: "ROSSI", firstName: "MARIO" },
    pod: "IT001E00000002",
    amount: 6,
    stato: "Da incassare",
  },
];
const tie = (a: Row, b: Row) => a.pod.localeCompare(b.pod);
check(
  "stesso nominativo: il POD non si rovescia con Z→A",
  sortByVisibleClientName(sameName, (row) => row.client, "desc", tie).map(
    (row) => row.pod,
  ),
  sortByVisibleClientName(sameName, (row) => row.client, "asc", tie).map(
    (row) => row.pod,
  ),
);

console.log("\n• Il fetch usa l'ordine sul nome visibile, senza tetto che lo ignora");
const pageSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/provvigioni/page.tsx"),
  "utf8",
);
const rowsSrc = readFileSync(
  join(process.cwd(), "src/lib/provvigioni-rows.ts"),
  "utf8",
);
check("pagina senza tetto 800", pageSrc.includes("total <= 800"), false);
check(
  "pagina non ordina con clientSortKey",
  pageSrc.includes("clientSortKey"),
  false,
);
check(
  "elenco non espanso: pagina dopo il nome visibile",
  pageSrc.includes("pageByVisibleClientName"),
  true,
);
check(
  "elenco espanso riceve il verso Nominativo",
  pageSrc.includes("clientSort: sortByClient ? sortDir : undefined"),
  true,
);
check(
  "rate Helios/mese: ordine prima della pagina",
  rowsSrc.includes("pageByVisibleClientName"),
  true,
);
check(
  "il ramo ordinato non riscrive le rate",
  rowsSrc.includes("Non riscrive rate né importi"),
  true,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check falliti (ordinamento Nominativo)`);
  process.exit(1);
}
console.log("\n✅ Ordinamento Nominativo: tutte le verifiche superate.");
