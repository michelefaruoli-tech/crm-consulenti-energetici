/**
 * Verifica il perimetro di visibilità collaboratori/righe per i 4 ruoli
 * (Collaboratore, Area Manager, Backoffice, Admin), senza database:
 * testa le funzioni pure di `src/lib/user-scope.ts` che ogni pagina/API deve
 * usare per popolare tendine «Collab.» (nomi) e liste contratti (righe).
 *
 * Bug privacy risolto: `commissions.view_all` / `contracts.work_scoped` sono
 * permessi condivisi da Backoffice (rete intera) e Area Manager (solo team),
 * quindi non possono essere l'unico gate per decidere quali nomi mostrare —
 * serve `loadUserVisibilityScope` + `collaboratorOptionsWhereFromScope`.
 *
 * Scenario concreto segnalato: Area Manager Blasucci con in team solo
 * Genzano L. deve vedere esattamente "Blasucci + Genzano" ovunque, mai il
 * resto della rete (Doto, Fagiano, …).
 *
 * Uso: npx tsx scripts/check-collaborator-visibility.ts
 */
import {
  collaboratorOptionsWhereFromScope,
  contractWhereFromScope,
  panelContractScopeWhere,
  type UserVisibilityScope,
} from "../src/lib/visibility-scope";
import type { Prisma, Role } from "../src/generated/prisma/client";

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

// ---------------------------------------------------------------------------
// Rete di prova: un Area Manager (Blasucci) con un solo collaboratore in team
// (Genzano), un collaboratore di un altro team (Doto), un Commerciale
// (Fagiano), un Backoffice e un Admin. Rispecchia lo screenshot del bug.
// ---------------------------------------------------------------------------
type FakeUser = { id: string; name: string; role: Role; active: boolean };

const NETWORK: FakeUser[] = [
  { id: "u_admin", name: "Ada Admin", role: "ADMIN", active: true },
  { id: "u_segreteria", name: "Sara Segreteria", role: "SEGRETERIA", active: true },
  { id: "u_backoffice", name: "Bruno Backoffice", role: "BACKOFFICE", active: true },
  { id: "u_blasucci", name: "Blasucci", role: "AREA_MANAGER", active: true },
  { id: "u_genzano", name: "Genzano L.", role: "COLLABORATORE", active: true },
  { id: "u_doto", name: "Doto A.", role: "COLLABORATORE", active: true },
  { id: "u_fagiano", name: "Fagiano M.", role: "COMMERCIALE", active: true },
];

/** Reimplementazione minima della semantica Prisma usata dai `where` prodotti. */
function matchesUserWhere(user: FakeUser, where: Prisma.UserWhereInput): boolean {
  const w = where as Record<string, unknown>;
  if (typeof w.id === "string" && user.id !== w.id) return false;
  const idIn = w.id as { in?: string[] } | undefined;
  if (idIn?.in && !idIn.in.includes(user.id)) return false;
  if (typeof w.active === "boolean" && user.active !== w.active) return false;
  const roleIn = w.role as { in?: Role[] } | undefined;
  if (roleIn?.in && !roleIn.in.includes(user.role)) return false;
  return true;
}

function visibleNames(where: Prisma.UserWhereInput): string[] {
  return NETWORK.filter((u) => matchesUserWhere(u, where))
    .map((u) => u.name)
    .sort((a, b) => a.localeCompare(b, "it"));
}

const scopes: Record<
  "collaboratore" | "areaManager" | "backoffice" | "admin",
  { session: { id: string; role: Role }; scope: UserVisibilityScope }
> = {
  collaboratore: {
    session: { id: "u_genzano", role: "COLLABORATORE" },
    scope: { kind: "own", supplierIds: [], collaboratorIds: ["u_genzano"] },
  },
  areaManager: {
    session: { id: "u_blasucci", role: "AREA_MANAGER" },
    scope: {
      kind: "team",
      supplierIds: [],
      collaboratorIds: ["u_blasucci", "u_genzano"],
    },
  },
  backoffice: {
    session: { id: "u_backoffice", role: "BACKOFFICE" },
    scope: { kind: "scoped", supplierIds: ["enel"], collaboratorIds: [] },
  },
  admin: {
    session: { id: "u_admin", role: "ADMIN" },
    scope: { kind: "all", supplierIds: [], collaboratorIds: [] },
  },
};

console.log("--- Menu «Collab.» / tendine selezione collaboratore ---\n");

for (const [label, { session, scope }] of Object.entries(scopes)) {
  const where = collaboratorOptionsWhereFromScope(scope, session.id);
  const names = visibleNames(where);
  console.log(`  ${label}: vede → ${names.join(", ")}`);
}
console.log("");

check(
  "Collaboratore (Genzano): vede solo sé stesso",
  visibleNames(
    collaboratorOptionsWhereFromScope(scopes.collaboratore.scope, "u_genzano"),
  ),
  ["Genzano L."],
);

check(
  "Area Manager Blasucci: vede esattamente Blasucci + Genzano (il suo team)",
  visibleNames(
    collaboratorOptionsWhereFromScope(scopes.areaManager.scope, "u_blasucci"),
  ),
  ["Blasucci", "Genzano L."],
);

{
  const blasucciNames = visibleNames(
    collaboratorOptionsWhereFromScope(scopes.areaManager.scope, "u_blasucci"),
  );
  check("Area Manager Blasucci: NON vede Doto A. (altro team)", blasucciNames.includes("Doto A."), false);
  check("Area Manager Blasucci: NON vede Fagiano M. (fuori team)", blasucciNames.includes("Fagiano M."), false);
  check("Area Manager Blasucci: NON vede Bruno Backoffice", blasucciNames.includes("Bruno Backoffice"), false);
}

check(
  "Backoffice: vede tutta la rete (collaboratori/commerciali/AM/admin/segreteria)",
  visibleNames(collaboratorOptionsWhereFromScope(scopes.backoffice.scope, "u_backoffice")),
  ["Ada Admin", "Blasucci", "Doto A.", "Fagiano M.", "Genzano L.", "Sara Segreteria"].sort((a, b) =>
    a.localeCompare(b, "it"),
  ),
);

check(
  "Admin: vede tutta la rete",
  visibleNames(collaboratorOptionsWhereFromScope(scopes.admin.scope, "u_admin")),
  ["Ada Admin", "Blasucci", "Doto A.", "Fagiano M.", "Genzano L.", "Sara Segreteria"].sort((a, b) =>
    a.localeCompare(b, "it"),
  ),
);

check(
  "Backoffice NON vede se stesso in elenco (ruolo Backoffice non è un collaboratore contrattuale)",
  visibleNames(collaboratorOptionsWhereFromScope(scopes.backoffice.scope, "u_backoffice")).includes(
    "Bruno Backoffice",
  ),
  false,
);

// ---------------------------------------------------------------------------
// Righe contratti (stessa regola, `contractWhereFromScope`): un AM/collab non
// deve vedere righe di contratti fuori dal proprio perimetro.
// ---------------------------------------------------------------------------
console.log("\n--- Righe contratti (Provvigioni / Contratti / Report) ---\n");

type FakeContract = { id: string; collaboratorId: string; supplierId: string };

const CONTRACTS: FakeContract[] = [
  { id: "c_genzano_enel", collaboratorId: "u_genzano", supplierId: "enel" },
  { id: "c_doto_enel", collaboratorId: "u_doto", supplierId: "enel" },
  { id: "c_blasucci_sorgenia", collaboratorId: "u_blasucci", supplierId: "sorgenia" },
  { id: "c_fagiano_enel", collaboratorId: "u_fagiano", supplierId: "enel" },
];

function matchesContractWhere(
  contract: FakeContract,
  where: Prisma.ContractWhereInput,
): boolean {
  const w = where as Record<string, unknown>;
  if (Object.keys(w).length === 0) return true; // {} = nessuna restrizione (Admin/Segreteria)
  if (w.id === "__no_supplier_scope__") return false; // sentinella "non vede nulla"
  if (Array.isArray(w.AND)) {
    return (w.AND as Prisma.ContractWhereInput[]).every((part) =>
      matchesContractWhere(contract, part),
    );
  }
  const collabEq = w.collaboratorId;
  if (typeof collabEq === "string" && contract.collaboratorId !== collabEq) return false;
  const collabIn = collabEq as { in?: string[] } | undefined;
  if (collabIn?.in && !collabIn.in.includes(contract.collaboratorId)) return false;
  const supplierEq = w.supplierId;
  if (typeof supplierEq === "string" && contract.supplierId !== supplierEq) return false;
  const supplierIn = supplierEq as { in?: string[] } | undefined;
  if (supplierIn?.in && !supplierIn.in.includes(contract.supplierId)) return false;
  return true;
}

function visibleContractIds(where: Prisma.ContractWhereInput): string[] {
  return CONTRACTS.filter((c) => matchesContractWhere(c, where)).map((c) => c.id).sort();
}

check(
  "Collaboratore Genzano: vede solo le proprie righe",
  visibleContractIds(contractWhereFromScope(scopes.collaboratore.scope)),
  ["c_genzano_enel"],
);

check(
  "Area Manager Blasucci: vede solo le righe del suo team (sé + Genzano)",
  visibleContractIds(contractWhereFromScope(scopes.areaManager.scope)),
  ["c_blasucci_sorgenia", "c_genzano_enel"],
);

check(
  "Backoffice scope Enel: vede tutte le righe Enel (di chiunque), non Sorgenia",
  visibleContractIds(contractWhereFromScope(scopes.backoffice.scope)),
  ["c_doto_enel", "c_fagiano_enel", "c_genzano_enel"],
);

check(
  "Backoffice SENZA fornitori assegnati: non vede nulla",
  visibleContractIds(
    contractWhereFromScope({ kind: "scoped", supplierIds: [], collaboratorIds: [] }),
  ),
  [],
);

check(
  "Admin: vede tutte le righe",
  visibleContractIds(contractWhereFromScope(scopes.admin.scope)),
  ["c_blasucci_sorgenia", "c_doto_enel", "c_fagiano_enel", "c_genzano_enel"],
);

// ---------------------------------------------------------------------------
// Pannelli Anomalie / Cestino: `panelContractScopeWhere` = visibility + filtro
// collab UI. Stesso bug di `canViewAll` come unico gate: l’AM vedeva 63
// segnalazioni e 12 cestino della rete intera invece del solo team.
// ---------------------------------------------------------------------------
console.log("\n--- Pannelli Anomalie / Cestino (panelContractScopeWhere) ---\n");

check(
  "AM Blasucci senza filtro collab: solo team (sé + Genzano)",
  visibleContractIds(
    panelContractScopeWhere(
      contractWhereFromScope(scopes.areaManager.scope),
      undefined,
    ),
  ),
  ["c_blasucci_sorgenia", "c_genzano_enel"],
);

check(
  "AM Blasucci con filtro collab=Genzano: solo Genzano (non Doto)",
  visibleContractIds(
    panelContractScopeWhere(
      contractWhereFromScope(scopes.areaManager.scope),
      "u_genzano",
    ),
  ),
  ["c_genzano_enel"],
);

check(
  "AM Blasucci non può allargare lo scope filtrando un collab fuori team (Doto)",
  visibleContractIds(
    panelContractScopeWhere(
      contractWhereFromScope(scopes.areaManager.scope),
      "u_doto",
    ),
  ),
  [],
);

check(
  "Collaboratore: solo sé, indipendentemente dal filtro (scope own)",
  visibleContractIds(
    panelContractScopeWhere(
      contractWhereFromScope(scopes.collaboratore.scope),
      "u_doto",
    ),
  ),
  [],
);

check(
  "Admin senza filtro: tutta la rete",
  visibleContractIds(
    panelContractScopeWhere(contractWhereFromScope(scopes.admin.scope), null),
  ),
  ["c_blasucci_sorgenia", "c_doto_enel", "c_fagiano_enel", "c_genzano_enel"],
);

check(
  "Admin con filtro collab=Doto: solo Doto",
  visibleContractIds(
    panelContractScopeWhere(
      contractWhereFromScope(scopes.admin.scope),
      "u_doto",
    ),
  ),
  ["c_doto_enel"],
);

if (failures > 0) {
  console.error(`\n❌ ${failures} verifiche fallite (visibilità collaboratori).`);
  process.exit(1);
}
console.log("\n✅ Visibilità collaboratori/righe per i 4 ruoli: ok.");
