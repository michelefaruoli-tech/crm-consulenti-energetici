import "server-only";
import type { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getMasterEmail } from "@/lib/mail";
import { hasPermission } from "@/lib/permissions";
import {
  COLLABORATOR_ROLES,
  collaboratorOptionsWhereFromScope,
  contractWhereFromScope,
  panelContractScopeWhere,
  type CollaboratorOption,
  type UserVisibilityScope,
} from "@/lib/visibility-scope";

export {
  COLLABORATOR_ROLES,
  collaboratorOptionsWhereFromScope,
  contractWhereFromScope,
  panelContractScopeWhere,
  type CollaboratorOption,
  type UserVisibilityScope,
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

/**
 * Nomi visibili nei menu «Collab.» / selettori di collaboratore.
 *
 * Ogni tendina/filtro che elenca collaboratori deve passare da qui, mai da
 * una query `prisma.user.findMany` ad-hoc filtrata solo su `hasPermission`:
 * più permessi (es. `commissions.view_all`, `contracts.work_scoped`) sono
 * condivisi da ruoli con perimetri diversi (Backoffice = rete intera, Area
 * Manager = solo team) e usarli come unico gate mostra nomi fuori perimetro.
 */
export async function loadVisibleCollaboratorOptions(
  session: { id: string; role: Role },
): Promise<CollaboratorOption[]> {
  const scope = await loadUserVisibilityScope(session);
  return prisma.user.findMany({
    where: collaboratorOptionsWhereFromScope(scope, session.id),
    select: { id: true, name: true, role: true, active: true },
    orderBy: { name: "asc" },
  });
}

export async function contractVisibilityWhere(session: {
  id: string;
  role: Role;
}): Promise<Prisma.ContractWhereInput> {
  return contractWhereFromScope(await loadUserVisibilityScope(session));
}

/**
 * Filtro Prisma clienti coerente con lo scope contratti:
 * clienti creati da te oppure con almeno un contratto nel tuo perimetro.
 * Stessa regola già usata dalla pagina Clienti, estesa a fornitori/team.
 */
export async function clientVisibilityWhere(session: {
  id: string;
  role: Role;
}): Promise<Prisma.ClientWhereInput> {
  const scope = await loadUserVisibilityScope(session);
  if (scope.kind === "all") return {};
  return {
    OR: [
      { createdById: session.id },
      {
        contracts: {
          some: { deletedAt: null, ...contractWhereFromScope(scope) },
        },
      },
    ],
  };
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
