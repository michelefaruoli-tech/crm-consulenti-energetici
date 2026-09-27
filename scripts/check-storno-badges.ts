/**
 * P1.2 B1 — mapping badge storno testo+icona.
 * Uso: npx tsx scripts/check-storno-badges.ts
 *
 * Verifica etichette P1.2 e risoluzione da segnali esistenti.
 * Non tocca regole archivio / switch / Helios.
 */
import {
  resolveStornoBadges,
  STORNO_BADGE_DEFS,
  stornoBadgesFilterText,
  type StornoBadgeId,
} from "../src/lib/storno-badges";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const REQUIRED: StornoBadgeId[] = [
  "in_storno",
  "storno_in_scadenza",
  "fuori_storno",
  "doppia_posizione",
  "storico",
  "stornato",
];

console.log("\n• Definizioni badge P1.2 (testo obbligatorio)");
for (const id of REQUIRED) {
  const def = STORNO_BADGE_DEFS[id];
  check(`${id} presente`, Boolean(def?.label && def?.icon), true);
}
check(
  "label In storno",
  STORNO_BADGE_DEFS.in_storno.label,
  "In storno",
);
check(
  "label Storno in scadenza",
  STORNO_BADGE_DEFS.storno_in_scadenza.label,
  "Storno in scadenza",
);
check(
  "label Fuori storno",
  STORNO_BADGE_DEFS.fuori_storno.label,
  "Fuori storno",
);
check(
  "label Doppia posizione",
  STORNO_BADGE_DEFS.doppia_posizione.label,
  "Doppia posizione",
);
check("label Storico", STORNO_BADGE_DEFS.storico.label, "Storico");
check("label Stornato", STORNO_BADGE_DEFS.stornato.label, "Stornato");

console.log("\n• resolveStornoBadges — mapping kind");
check(
  "in_storno",
  resolveStornoBadges({ stornoKind: "in_storno" }).map((b) => b.id),
  ["in_storno"],
);
check(
  "in_scadenza",
  resolveStornoBadges({ stornoKind: "in_scadenza" }).map((b) => b.id),
  ["storno_in_scadenza"],
);
check(
  "fuori_storno",
  resolveStornoBadges({ stornoKind: "fuori_storno" }).map((b) => b.id),
  ["fuori_storno"],
);
check(
  "precedente → doppia",
  resolveStornoBadges({ stornoKind: "precedente" }).map((b) => b.id),
  ["doppia_posizione"],
);
check(
  "early reswitch + in_storno → entrambi",
  resolveStornoBadges({
    stornoKind: "in_storno",
    isEarlyReswitch: true,
  }).map((b) => b.id),
  ["in_storno", "doppia_posizione"],
);
check(
  "storico non mostra fuori_storno",
  resolveStornoBadges({
    stornoKind: "fuori_storno",
    isHistorical: true,
  }).map((b) => b.id),
  ["storico"],
);
check(
  "stornato",
  resolveStornoBadges({ isStornato: true }).map((b) => b.id),
  ["stornato"],
);
check(
  "peer attivo → doppia",
  resolveStornoBadges({
    stornoKind: "fuori_storno",
    hasActivePodPeer: true,
  }).map((b) => b.id),
  ["doppia_posizione", "fuori_storno"],
);
check(
  "da_pagare senza badge P1.2",
  resolveStornoBadges({ stornoKind: "da_pagare" }).map((b) => b.id),
  [],
);

console.log("\n• Filter text");
check(
  "filter text multi",
  stornoBadgesFilterText(
    resolveStornoBadges({
      stornoKind: "in_storno",
      isEarlyReswitch: true,
    }),
  ),
  "In storno · Doppia posizione",
);

if (failures > 0) {
  console.error(`\nFAIL: ${failures} asserzioni fallite`);
  process.exit(1);
}
console.log("\nOK check-storno-badges\n");
