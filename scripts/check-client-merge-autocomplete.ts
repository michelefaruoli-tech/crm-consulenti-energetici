/**
 * Verifica logica pura per unificazione anagrafiche (autocomplete ragione sociale).
 * Nessun database: clientMergeKey e regole di selezione keeper.
 *
 * Uso: npx tsx scripts/check-client-merge-autocomplete.ts
 */
import { clientMergeKey } from "../src/lib/client-dedupe";

let failures = 0;

function check(name: string, got: unknown, expected: unknown) {
  const gotStr = JSON.stringify(got);
  const expectedStr = JSON.stringify(expected);
  if (gotStr !== expectedStr) {
    failures += 1;
    console.error(`❌ ${name}\n   got:      ${gotStr}\n   expected: ${expectedStr}`);
    return;
  }
  console.log(`✅ ${name}`);
}

check(
  "azienda stessa ragione + P.IVA → stessa chiave",
  clientMergeKey({
    type: "AZIENDA",
    companyName: "CASTALDI costruzioni",
    vatNumber: "01234567890",
  }),
  clientMergeKey({
    type: "AZIENDA",
    companyName: "CASTALDI COSTRUZIONI",
    vatNumber: "01234567890",
  }),
);

check(
  "omonimi azienda senza codice fiscale → chiave NOME",
  clientMergeKey({
    type: "AZIENDA",
    companyName: "CASTALDI costruzioni",
  }),
  "A|CASTALDI COSTRUZIONI|NOME",
);

check(
  "azienda P.IVA diverse → chiavi diverse",
  clientMergeKey({
    type: "AZIENDA",
    companyName: "CASTALDI",
    vatNumber: "11111111111",
  }) ===
    clientMergeKey({
      type: "AZIENDA",
      companyName: "CASTALDI",
      vatNumber: "22222222222",
    }),
  false,
);

check(
  "privato cognome+nome+CF",
  clientMergeKey({
    type: "PRIVATO",
    firstName: "Mario",
    lastName: "Rossi",
    fiscalCode: "RSSMRA80A01H501U",
  }),
  "P|ROSSI|MARIO|CF:RSSMRA80A01H501U",
);

check(
  "ragione sociale troppo corta → null",
  clientMergeKey({ type: "AZIENDA", companyName: "A" }),
  null,
);

if (failures > 0) {
  console.error(`\n${failures} test falliti`);
  process.exit(1);
}
console.log("\nTutti i check client-merge-autocomplete ok");
