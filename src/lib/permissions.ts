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
  | "clients.edit_all"
  | "clients.create"
  | "documents.manage"
  | "commissions.view_all"
  | "commissions.view_own"
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
    "clients.edit_all",
    "clients.create",
    "documents.manage",
    "commissions.view_all",
    "reports.export",
    "reports.email",
  ],
  SEGRETERIA: [
    "contracts.edit_all",
    "contracts.create",
    "contracts.change_status",
    "clients.edit_all",
    "clients.create",
    "documents.manage",
    "commissions.view_all",
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
