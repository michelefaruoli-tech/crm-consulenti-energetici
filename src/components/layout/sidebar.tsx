"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  Menu,
  X,
  PlusCircle,
  HardDrive,
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
    roles: ["ADMIN", "SEGRETERIA", "BACKOFFICE"],
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
    roles: ["ADMIN", "SEGRETERIA", "BACKOFFICE", "COLLABORATORE", "COMMERCIALE"],
  },
  {
    href: "/backup",
    label: "Backup",
    icon: HardDrive,
    roles: ["ADMIN"],
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
  const [open, setOpen] = useState(false);

  const items = NAV_ITEMS.filter((item) => canSee(item.roles, user.role));
  const canCreateContract =
    user.role === "ADMIN" ||
    user.role === "SEGRETERIA" ||
    user.role === "COLLABORATORE" ||
    user.role === "COMMERCIALE";

  // Chiudi menu al cambio pagina (navigazione telefono)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Blocca scroll body quando menu aperto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const nav = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-4 md:px-5 md:py-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500 p-2">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">CRM Energia</p>
            <p className="text-xs text-slate-400">Gestionale consulenti</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Chiudi menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {canCreateContract ? (
          <Link
            href="/contratti/nuovo"
            className="mb-2 flex items-center gap-3 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-semibold text-white shadow-sm"
            onClick={() => setOpen(false)}
          >
            <PlusCircle className="h-5 w-5 shrink-0" />
            Nuovo contratto
          </Link>
        ) : null}

        {items.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        <form action={logoutAction} className="pt-1">
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Esci
          </button>
        </form>
      </nav>

      <div className="border-t border-slate-800 p-4">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-xs text-slate-400">
          {ROLE_LABELS[user.role] ?? user.role}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}</p>
      </div>
    </>
  );

  return (
    <>
      {/* Barra telefono */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 md:hidden">
        <button
          type="button"
          className="rounded-lg border border-slate-200 p-2 text-slate-800"
          onClick={() => setOpen(true)}
          aria-label="Apri menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">CRM Energia</p>
          <p className="truncate text-[11px] text-slate-500">{user.name}</p>
        </div>
        {canCreateContract ? (
          <Link
            href="/contratti/nuovo"
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
          >
            + Contratto
          </Link>
        ) : null}
      </header>

      {/* Overlay */}
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Chiudi menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Drawer mobile + sidebar desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col border-r border-slate-200 bg-slate-950 text-white transition-transform duration-200 md:sticky md:top-0 md:z-0 md:h-screen md:w-64 md:translate-x-0 md:shrink-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {nav}
      </aside>
    </>
  );
}
