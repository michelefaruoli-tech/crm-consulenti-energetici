/**
 * Logica pura di visibilità per ruolo (nessuna query database).
 *
 * Estratta da `user-scope.ts` (marcato `server-only`) così può essere
 * importata anche da script di verifica (`scripts/check-collaborator-visibility.ts`)
 * senza tirarsi dietro Prisma/Next: qui vivono solo le trasformazioni
 * `UserVisibilityScope` → `where` Prisma, sia per le righe contratto sia per
 * l'elenco nomi nei menu «Collab.».
 */
import type { Prisma, Role } from "@/generated/prisma/client";

export type UserVisibilityScope = {
  /**
   * all = admin/segreteria
   * own = collaboratore (solo sé; se ha supplierScopes li filtra)
   * scoped = backoffice (fornitori + collab opzionali)
   * team = area manager (sé + team in collaboratorScopes; fornitori opzionali)
   */
  kind: "all" | "own" | "scoped" | "team";
  supplierIds: string[];
  /** Vuoto = tutti i collaboratori (entro i fornitori), tranne in team dove vuoto = solo sé */
  collaboratorIds: string[];
};

/** Ruoli che possono comparire come "collaboratore" assegnato a un contratto. */
export const COLLABORATOR_ROLES: Role[] = [
  "COLLABORATORE",
  "COMMERCIALE",
  "AREA_MANAGER",
  "ADMIN",
  "SEGRETERIA",
];

export type CollaboratorOption = {
  id: string;
  name: string;
  role: Role;
  active: boolean;
};

/** Filtro Prisma contratti in base al ruolo / scope. */
export function contractWhereFromScope(
  scope: UserVisibilityScope,
): Prisma.ContractWhereInput {
  if (scope.kind === "all") return {};

  if (scope.kind === "own") {
    const where: Prisma.ContractWhereInput = {
      collaboratorId: sessionOwnId(scope),
    };
    if (scope.supplierIds.length > 0) {
      where.supplierId = { in: scope.supplierIds };
    }
    return where;
  }

  if (scope.kind === "team") {
    const where: Prisma.ContractWhereInput = {
      collaboratorId: { in: scope.collaboratorIds },
    };
    if (scope.supplierIds.length > 0) {
      where.supplierId = { in: scope.supplierIds };
    }
    return where;
  }

  // Backoffice senza fornitori assegnati → non vede nulla
  if (scope.supplierIds.length === 0) {
    return { id: "__no_supplier_scope__" };
  }

  const where: Prisma.ContractWhereInput = {
    supplierId: { in: scope.supplierIds },
  };
  if (scope.collaboratorIds.length > 0) {
    where.collaboratorId = { in: scope.collaboratorIds };
  }
  return where;
}

function sessionOwnId(scope: UserVisibilityScope): string {
  return scope.collaboratorIds[0] ?? "__none__";
}

/**
 * Where Prisma per la lista utenti selezionabili come "collaboratore" nei
 * menu / tendine, con la stessa regola di visibilità già usata per le righe
 * (`contractWhereFromScope`, che questa funzione rispecchia 1:1):
 * - own (Collaboratore / Commerciale): solo sé stesso
 * - team (Area Manager): sé stesso + il proprio team (`UserCollaboratorScope`)
 * - scoped (Backoffice) / all (Admin / Segreteria): tutta la rete
 */
export function collaboratorOptionsWhereFromScope(
  scope: UserVisibilityScope,
  sessionId: string,
): Prisma.UserWhereInput {
  if (scope.kind === "own") {
    return { id: sessionId };
  }
  if (scope.kind === "team") {
    return { id: { in: scope.collaboratorIds }, active: true };
  }
  // "all" (Admin/Segreteria) e "scoped" (Backoffice): tutta la rete.
  return { active: true, role: { in: COLLABORATOR_ROLES } };
}
