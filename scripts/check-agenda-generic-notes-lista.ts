/**
 * Note generiche Agenda: lista lavorabile con stati (da controllare / risolta).
 *
 * Controlla che:
 * - lo schema Prisma esponga enum + indici multi-nota (niente più unique userId)
 * - le server action CRUD/stato siano presenti e scope-aware (requireSession + userId)
 * - la UI abbia filtro, creazione, modifica e «Segna risolta»
 * - non restino le API monolitiche get/save del blocco testo unico
 *
 * Uso: npx tsx scripts/check-agenda-generic-notes-lista.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (!ok) {
    failures += 1;
    console.error(`❌ ${name}${detail ? `\n   ${detail}` : ""}`);
    return;
  }
  console.log(`✅ ${name}`);
}

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const actions = readFileSync(join(root, "src/lib/agenda-actions.ts"), "utf8");
const ui = readFileSync(join(root, "src/components/agenda/agenda-app.tsx"), "utf8");
const page = readFileSync(join(root, "src/app/(dashboard)/agenda/page.tsx"), "utf8");
const migration = readFileSync(
  join(
    root,
    "prisma/migrations/20261010070000_agenda_generic_notes_lista_stati/migration.sql",
  ),
  "utf8",
);

console.log("\n• Schema e migrazione");

check(
  "enum AgendaGenericNoteStatus con DA_CONTROLLARE e RISOLTA",
  /enum AgendaGenericNoteStatus\s*\{[\s\S]*DA_CONTROLLARE[\s\S]*RISOLTA[\s\S]*\}/.test(
    schema,
  ),
);

check(
  "AgendaGenericNote ha status e non ha più userId @unique",
  /model AgendaGenericNote\s*\{[\s\S]*status\s+AgendaGenericNoteStatus/.test(schema) &&
    !/model AgendaGenericNote\s*\{[\s\S]*userId\s+String\s+@unique/.test(schema),
);

check(
  "User.agendaGenericNotes (relazione lista)",
  /agendaGenericNotes\s+AgendaGenericNote\[\]/.test(schema),
);

check(
  "migrazione droppa unique userId e aggiunge status",
  migration.includes('DROP INDEX "AgendaGenericNote_userId_key"') &&
    migration.includes("AgendaGenericNoteStatus") &&
    migration.includes('ADD COLUMN "status"'),
);

check(
  "migrazione conserva testo esistente come DA_CONTROLLARE (default)",
  migration.includes("DEFAULT 'DA_CONTROLLARE'"),
);

console.log("\n• Server actions");

for (const name of [
  "listAgendaGenericNotesAction",
  "createAgendaGenericNoteAction",
  "updateAgendaGenericNoteAction",
  "setAgendaGenericNoteStatusAction",
  "deleteAgendaGenericNoteAction",
]) {
  check(`export async function ${name}`, actions.includes(`export async function ${name}`));
}

check(
  "niente più getAgendaGenericNoteAction / saveAgendaGenericNoteAction",
  !actions.includes("getAgendaGenericNoteAction") &&
    !actions.includes("saveAgendaGenericNoteAction"),
);

check(
  "list filtra per session.id (scope utente)",
  /listAgendaGenericNotesAction[\s\S]*requireSession\(\)[\s\S]*userId:\s*session\.id/.test(
    actions,
  ),
);

check(
  "update/setStatus/delete verificano ownership userId",
  (actions.match(/existing\.userId !== session\.id/g) ?? []).length >= 3,
);

check(
  "nessun updateMany/createMany/$transaction nelle note",
  !/agendaGenericNote[\s\S]{0,200}(updateMany|createMany|\$transaction)/.test(actions),
);

console.log("\n• UI Agenda");

check("filtro Da controllare / Risolte / Tutte", ui.includes('key: "aperte"') && ui.includes('key: "risolte"') && ui.includes('key: "tutte"'));
check("Aggiungi nota", ui.includes("Aggiungi nota") && ui.includes("createAgendaGenericNoteAction"));
check("Segna risolta", ui.includes("Segna risolta") && ui.includes("setAgendaGenericNoteStatusAction"));
check("Modifica nota", ui.includes("updateAgendaGenericNoteAction") && ui.includes("Modifica"));
check("page carica lista note aperte", page.includes('listAgendaGenericNotesAction("aperte")') && page.includes("initialNotes"));

if (failures > 0) {
  console.error(`\n${failures} controlli falliti`);
  process.exit(1);
}

console.log("\nTutti i controlli ok");
