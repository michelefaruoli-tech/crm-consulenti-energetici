/**
 * Card Dashboard «Collaboratori più produttivi»:
 * - Admin (`stats.full`): vista globale
 * - Agente/AM con ≥1 collaboratore attivo in UserCollaboratorScope: solo rete
 * - Collaboratore senza sottoposti: card nascosta
 * - Subtitle non più «Solo admin» quando la card è visibile agli agenti
 *
 * Uso: npx tsx scripts/check-productive-collaborators-card.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  productiveCollaboratorsSubtitle,
  resolveProductiveCollaboratorsAudience,
  shouldShowProductiveCollaboratorsCard,
} from "../src/lib/dashboard-aggregates";

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

console.log("\n• Audience card produttivi");

check(
  "admin → admin_global",
  resolveProductiveCollaboratorsAudience({
    isAdminStats: true,
    activeNetworkCollaboratorCount: 0,
  }),
  "admin_global",
);

check(
  "admin con rete → comunque admin_global (vista globale)",
  resolveProductiveCollaboratorsAudience({
    isAdminStats: true,
    activeNetworkCollaboratorCount: 5,
  }),
  "admin_global",
);

check(
  "agente/AM con 1 collab attivo → network",
  resolveProductiveCollaboratorsAudience({
    isAdminStats: false,
    activeNetworkCollaboratorCount: 1,
  }),
  "network",
);

check(
  "agente/AM con più collab → network",
  resolveProductiveCollaboratorsAudience({
    isAdminStats: false,
    activeNetworkCollaboratorCount: 3,
  }),
  "network",
);

check(
  "collaboratore senza rete → hidden",
  resolveProductiveCollaboratorsAudience({
    isAdminStats: false,
    activeNetworkCollaboratorCount: 0,
  }),
  "hidden",
);

check(
  "mostra card admin",
  shouldShowProductiveCollaboratorsCard("admin_global"),
  true,
);
check(
  "mostra card rete",
  shouldShowProductiveCollaboratorsCard("network"),
  true,
);
check(
  "nasconde card senza rete",
  shouldShowProductiveCollaboratorsCard("hidden"),
  false,
);

console.log("\n• Subtitle");

check(
  "subtitle admin",
  productiveCollaboratorsSubtitle("admin_global"),
  "Vista globale · nomi unificati",
);
check(
  "subtitle rete",
  productiveCollaboratorsSubtitle("network"),
  "La tua rete · nomi unificati",
);
check(
  "subtitle hidden vuoto",
  productiveCollaboratorsSubtitle("hidden"),
  "",
);

console.log("\n• Wiring dashboard page");

const pageSrc = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/page.tsx"),
  "utf8",
);
const userScopeSrc = readFileSync(
  join(process.cwd(), "src/lib/user-scope.ts"),
  "utf8",
);

check(
  "page usa showProductiveCard (non solo isAdminStats)",
  pageSrc.includes("showProductiveCard") &&
    pageSrc.includes("resolveProductiveCollaboratorsAudience") &&
    pageSrc.includes("productiveCollaboratorsSubtitle") &&
    pageSrc.includes("countActiveNetworkCollaborators"),
  true,
);

check(
  "page non ha più copy «Solo admin · nomi unificati»",
  pageSrc.includes("Solo admin · nomi unificati"),
  false,
);

check(
  "page ranking admin globale / rete con visibility",
  pageSrc.includes("productiveRankingWhere") &&
    pageSrc.includes("isAdminStats") &&
    pageSrc.includes("...visibility"),
  true,
);

check(
  "user-scope espone countActiveNetworkCollaborators",
  userScopeSrc.includes("export async function countActiveNetworkCollaborators") &&
    userScopeSrc.includes("userCollaboratorScope.count") &&
    userScopeSrc.includes("collaborator: { active: true }"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check falliti`);
  process.exit(1);
}
console.log("\n✅ check-productive-collaborators-card: tutti i casi OK");
