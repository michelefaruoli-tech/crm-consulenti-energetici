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
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/lib/logout-action";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: "all" as const },
  { href: "/lavorazione", label: "In lavorazione", icon: Briefcase, roles: "all" as const },
  {
    href: "/attesa-pagamento",
    label: "In attesa pagamento",
    icon: Wallet,
    roles: "all" as const,
  },
  {
    href: "/attivati",
    label: "Attivati",
    icon: CheckCircle2,
    roles: "all" as const,
  },
  { href: "/clienti", label: "Clienti", icon: Users, roles: "all" as const },
  { href: "/contratti", label: "Contratti", icon: FileText, roles: "all" as const },
  { href: "/archivio", label: "Archivio", icon: Archive, roles: ["ADMIN", "SEGRETERIA"] as AppRole[] },
  { href: "/fornitori", label: "Fornitori", icon: Building2, roles: ["ADMIN", "SEGRETERIA"] as AppRole[] },
  { href: "/provvigioni", label: "Provvigioni", icon: Coins, roles: "all" as const },
  { href: "/report", label: "Report", icon: BarChart3, roles: ["ADMIN", "SEGRETERIA", "COLLABORATORE"] as AppRole[] },
  { href: "/account", label: "Sicurezza", icon: Shield, roles: "all" as const },
  { href: "/utenti", label: "Utenti", icon: Settings, roles: ["ADMIN"] as AppRole[] },
];

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: AppRole };
}) {
  const pathname = usePathname();

  const items = NAV_ITEMS.filter(
    (item) => item.roles === "all" || item.roles.includes(user.role),
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-white">
      <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-5">
        <div className="rounded-lg bg-emerald-500 p-2">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">CRM Energia</p>
          <p className="text-xs text-slate-400">Gestionale consulenti</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-slate-400">{ROLE_LABELS[user.role]}</p>
        <form action={logoutAction} className="mt-3">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Esci
          </button>
        </form>
      </div>
    </aside>
  );
}
