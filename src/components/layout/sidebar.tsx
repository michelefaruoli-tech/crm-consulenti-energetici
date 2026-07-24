"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  Building2,
  Coins,
  BarChart3,
  Settings,
  LogOut,
  Zap,
  Archive,
  Briefcase,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/lib/logout-action";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";

type NavRoles = "all" | AppRole[];

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: NavRoles;
}> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: "all" },
  {
    href: "/lavorazione",
    label: "In lavorazione",
    icon: Briefcase,
    roles: ["ADMIN", "SEGRETERIA"],
  },
  { href: "/clienti", label: "Clienti", icon: Users, roles: "all" },
  { href: "/contratti", label: "Contratti", icon: FileText, roles: "all" },
  {
    href: "/archivio",
    label: "Archivio",
    icon: Archive,
    roles: ["ADMIN", "SEGRETERIA"],
  },
  {
    href: "/fornitori",
    label: "Fornitori",
    icon: Building2,
    roles: ["ADMIN", "SEGRETERIA"],
  },
  { href: "/provvigioni", label: "Provvigioni", icon: Coins, roles: "all" },
  {
    href: "/report",
    label: "Report",
    icon: BarChart3,
    roles: ["ADMIN", "SEGRETERIA", "COLLABORATORE", "COMMERCIALE"],
  },
  { href: "/account", label: "Sicurezza", icon: Shield, roles: "all" },
  { href: "/utenti", label: "Utenti", icon: Settings, roles: ["ADMIN"] },
];

function canSee(roles: NavRoles, role: AppRole): boolean {
  return roles === "all" || roles.includes(role);
}

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: AppRole };
}) {
  const pathname = usePathname();

  const items = NAV_ITEMS.filter((item) => canSee(item.roles, user.role));

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-white">
      <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-5">
        <div className="rounded-lg bg-emerald-500 p-2">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">CRM Energia</p>
          <p className="text-xs text-slate-400">Gestionale consulenti</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {/* Esci subito sotto Utenti (o fine menu) */}
        <form action={logoutAction} className="pt-1">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Esci
          </button>
        </form>
      </nav>

      <div className="border-t border-slate-800 p-4">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-xs text-slate-400">{ROLE_LABELS[user.role]}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}</p>
      </div>
    </aside>
  );
}
