import "server-only";
import type { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getMasterEmail } from "@/lib/mail";
import { hasPermission } from "@/lib/permissions";

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

/** Ruoli che possono avere scope fornitori assegnato. */
export function roleSupportsSupplierScope(role: Role): boolean {
  return (
    role === "BACKOFFICE" ||
    role === "AREA_MANAGER" ||
    role === "COLLABORATORE" ||
    role === "COMMERCIALE"
  );
}

/** Ruoli che gestiscono anche la lista collaboratori nello scope. */
export function roleSupportsCollaboratorScope(role: Role): boolean {
  return role === "BACKOFFICE" || role === "AREA_MANAGER";
}

export async function loadUserVisibilityScope(session: {
  id: string;
  role: Role;
}): Promise<UserVisibilityScope> {
  if (hasPermission(session.role, "contracts.edit_all")) {
    return { kind: "all", supplierIds: [], collaboratorIds: [] };
  }

  if (session.role === "AREA_MANAGER") {
    const [suppliers, collaborators] = await Promise.all([
      prisma.userSupplierScope.findMany({
        where: { userId: session.id },
        select: { supplierId: true },
      }),
      prisma.userCollaboratorScope.findMany({
        where: { userId: session.id },
        select: { collaboratorId: true },
      }),
    ]);
    const teamIds = [
      session.id,
      ...collaborators.map((c) => c.collaboratorId),
    ];
    return {
      kind: "team",
      supplierIds: suppliers.map((s) => s.supplierId),
      collaboratorIds: [...new Set(teamIds)],
    };
  }

  if (
    session.role === "BACKOFFICE" ||
    hasPermission(session.role, "contracts.work_scoped")
  ) {
    const [suppliers, collaborators] = await Promise.all([
      prisma.userSupplierScope.findMany({
        where: { userId: session.id },
        select: { supplierId: true },
      }),
      prisma.userCollaboratorScope.findMany({
        where: { userId: session.id },
        select: { collaboratorId: true },
      }),
    ]);
    return {
      kind: "scoped",
      supplierIds: suppliers.map((s) => s.supplierId),
      collaboratorIds: collaborators.map((c) => c.collaboratorId),
    };
  }

  // Collaboratore / Commerciale: own, con eventuale filtro fornitori
  const suppliers = await prisma.userSupplierScope.findMany({
    where: { userId: session.id },
    select: { supplierId: true },
  });
  return {
    kind: "own",
    supplierIds: suppliers.map((s) => s.supplierId),
    collaboratorIds: [session.id],
  };
}

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

export async function contractVisibilityWhere(session: {
  id: string;
  role: Role;
}): Promise<Prisma.ContractWhereInput> {
  return contractWhereFromScope(await loadUserVisibilityScope(session));
}

export async function userCanAccessContract(
  session: { id: string; role: Role },
  contract: { collaboratorId: string; supplierId: string },
): Promise<boolean> {
  const scope = await loadUserVisibilityScope(session);
  if (scope.kind === "all") return true;

  if (scope.kind === "own") {
    if (contract.collaboratorId !== session.id) return false;
    if (
      scope.supplierIds.length > 0 &&
      !scope.supplierIds.includes(contract.supplierId)
    ) {
      return false;
    }
    return true;
  }

  if (scope.kind === "team") {
    if (!scope.collaboratorIds.includes(contract.collaboratorId)) return false;
    if (
      scope.supplierIds.length > 0 &&
      !scope.supplierIds.includes(contract.supplierId)
    ) {
      return false;
    }
    return true;
  }

  if (!scope.supplierIds.includes(contract.supplierId)) return false;
  if (
    scope.collaboratorIds.length > 0 &&
    !scope.collaboratorIds.includes(contract.collaboratorId)
  ) {
    return false;
  }
  return true;
}

/**
 * Destinatari email pratica da lavorare:
 * - sempre Admin (MASTER_EMAIL)
 * - tutti i Backoffice attivi con scope su quel fornitore
 * - eventuali email salvate sul fornitore (campo email, più indirizzi separati da virgola)
 */
export async function getLavorazioneNotifyEmails(
  supplierId: string | null | undefined,
): Promise<string[]> {
  const admin = getMasterEmail().trim().toLowerCase();
  const set = new Set<string>();
  if (admin) set.add(admin);

  if (supplierId) {
    const [users, supplier] = await Promise.all([
      prisma.user.findMany({
        where: {
          active: true,
          role: "BACKOFFICE",
          supplierScopes: { some: { supplierId } },
        },
        select: { email: true },
      }),
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { email: true },
      }),
    ]);
    for (const u of users) {
      const e = u.email.trim().toLowerCase();
      if (e && !e.startsWith("deleted_")) set.add(e);
    }
    if (supplier?.email) {
      for (const part of supplier.email.split(/[,;\s]+/)) {
        const e = part.trim().toLowerCase();
        if (e.includes("@") && !e.startsWith("deleted_")) set.add(e);
      }
    }
  }

  return [...set];
}

export function formatEmailList(emails: string[]): string {
  return emails.join(", ");
}
