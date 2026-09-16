import "server-only";
import type { Prisma, Role } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions";
import { loadUserVisibilityScope } from "@/lib/user-scope";

/** Filtro visibilità catalogo CTE: tutti vedono; BACKOFFICE limitato ai fornitori in scope. */
export async function cteCatalogVisibilityWhere(session: {
  id: string;
  role: Role;
}): Promise<Prisma.CteOfferWhereInput> {
  if (hasPermission(session.role, "contracts.edit_all")) {
    return { active: true };
  }

  const scope = await loadUserVisibilityScope(session);
  if (scope.kind === "scoped") {
    if (scope.supplierIds.length === 0) {
      return { id: "__no_supplier_scope__" };
    }
    return { active: true, supplierId: { in: scope.supplierIds } };
  }

  return { active: true };
}

export async function userCanManageCteOffer(
  session: { id: string; role: Role },
  supplierId: string,
): Promise<boolean> {
  if (!hasPermission(session.role, "cte.catalog.manage")) return false;
  if (hasPermission(session.role, "contracts.edit_all")) return true;

  const scope = await loadUserVisibilityScope(session);
  if (scope.kind !== "scoped") return true;
  return scope.supplierIds.includes(supplierId);
}
