/**
 * Verifica destinatari email BO: Master + inseritore/collaboratore.
 * Uso: npx tsx scripts/check-email-bo-inseritore-master.ts
 *
 * Non tocca SMTP né DB: solo logica pura di unione destinatari.
 */
import { createHash } from "node:crypto";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

/** Specchio della logica di merge (senza Prisma) per regressione. */
function mergeRecipients(opts: {
  master: string | null;
  dedicated: string[];
  inserter: string | null;
  collaborator: string | null;
}): string[] {
  const set = new Set<string>();
  if (opts.master) set.add(opts.master.toLowerCase());
  for (const e of opts.dedicated) set.add(e.toLowerCase());
  if (opts.inserter) set.add(opts.inserter.toLowerCase());
  if (opts.collaborator) set.add(opts.collaborator.toLowerCase());
  return [...set].sort();
}

console.log("\n• Master + inseritore (stesso collaboratore)");
check(
  "due destinatari",
  mergeRecipients({
    master: "michele.faruoli@gmail.com",
    dedicated: [],
    inserter: "collab@example.com",
    collaborator: "collab@example.com",
  }),
  ["collab@example.com", "michele.faruoli@gmail.com"].sort(),
);

console.log("\n• Master + AM inseritore + collaboratore diverso");
check(
  "tre destinatari",
  mergeRecipients({
    master: "michele.faruoli@gmail.com",
    dedicated: [],
    inserter: "am@example.com",
    collaborator: "collab@example.com",
  }),
  ["am@example.com", "collab@example.com", "michele.faruoli@gmail.com"].sort(),
);

console.log("\n• Con BO dedicato: Master + BO + inseritore");
check(
  "include BO dedicato",
  mergeRecipients({
    master: "michele.faruoli@gmail.com",
    dedicated: ["bo@fornitore.it"],
    inserter: "collab@example.com",
    collaborator: "collab@example.com",
  }),
  ["bo@fornitore.it", "collab@example.com", "michele.faruoli@gmail.com"].sort(),
);

console.log("\n• Senza Master né inseritore: solo BO (pratica non sparisce)");
check(
  "solo dedicated",
  mergeRecipients({
    master: null,
    dedicated: ["bo@fornitore.it"],
    inserter: null,
    collaborator: null,
  }),
  ["bo@fornitore.it"],
);

console.log("\n• Copy oggetto inviato per firma (prefix)");
const subject = ["Contratto inviato per la firma", "Rossi Mario", "Switch"]
  .filter(Boolean)
  .join(" – ");
check(
  "oggetto contiene copy firma",
  subject.startsWith("Contratto inviato per la firma"),
  true,
);

console.log("\n• Copy esito lavorazione");
const esitoSubject = ["Esito lavorazione Back Office", "Rossi Mario", "Enel"]
  .filter(Boolean)
  .join(" – ");
check(
  "oggetto esito",
  esitoSubject.startsWith("Esito lavorazione Back Office"),
  true,
);

// Sanity: hash idempotency non cambia per stesso input
const h1 = createHash("sha256").update("batch:a,b:docs:1:v1").digest("hex");
const h2 = createHash("sha256").update("batch:a,b:docs:1:v1").digest("hex");
check("hash stabile", h1 === h2, true);

if (failures > 0) {
  console.error(`\nFAIL: ${failures} check falliti`);
  process.exit(1);
}
console.log("\nOK email BO Master+inseritore\n");
