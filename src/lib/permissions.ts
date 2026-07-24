import { Role } from "@/generated/prisma/client";

export type Permission =
  | "users.manage"
  | "suppliers.manage"
  | "commission_rules.manage"
  | "backup.manage"
  | "stats.full"
  | "contracts.edit_all"
  | "contracts.edit_own"
  | "contracts.create"
  | "contracts.change_status"
  | "contracts.change_collaborator_dashboard"
  | "contracts.change_collaborator"
  | "clients.edit_all"
  | "clients.create"
  | "documents.manage"
  | "commissions.view_all"
  | "commissions.view_own"
  | "commissions.edit_gettone"
  | "reports.export"
  | "reports.email";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    "users.manage",
    "suppliers.manage",
    "commission_rules.manage",
    "backup.manage",
    "stats.full",
    "contracts.edit_all",
    "contracts.create",
    "contracts.change_status",
    "contracts.change_collaborator_dashboard",
    "contracts.change_collaborator",
    "clients.edit_all",
    "clients.create",
    "documents.manage",
    "commissions.view_all",
    "commissions.edit_gettone",
    "reports.export",
    "reports.email",
  ],
  SEGRETERIA: [
    "contracts.edit_all",
    "contracts.create",
    "contracts.change_status",
    "contracts.change_collaborator_dashboard",
    "clients.edit_all",
    "clients.create",
    "documents.manage",
    "commissions.view_all",
    "commissions.edit_gettone",
    "reports.export",
    "reports.email",
  ],
  COLLABORATORE: [
    "contracts.edit_own",
    "contracts.create",
    "clients.create",
    "commissions.view_own",
    "reports.export",
  ],
  COMMERCIALE: [
    "contracts.edit_own",
    "contracts.create",
    "clients.create",
    "commissions.view_own",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canViewContract(
  role: Role,
  userId: string,
  collaboratorId: string,
): boolean {
  if (hasPermission(role, "contracts.edit_all")) return true;
  return userId === collaboratorId;
}

/** Admin/Segreteria (Master operativo) o proprietario della riga. */
export function canDeleteContract(
  role: Role,
  userId: string,
  collaboratorId: string,
): boolean {
  if (hasPermission(role, "contracts.edit_all")) return true;
  if (hasPermission(role, "contracts.edit_own") && userId === collaboratorId) return true;
  return false;
}

/** Admin/Segreteria oppure creatore del cliente. */
export function canDeleteClient(
  role: Role,
  userId: string,
  createdById: string | null | undefined,
): boolean {
  if (hasPermission(role, "clients.edit_all")) return true;
  if (createdById && userId === createdById) return true;
  return false;
}
