"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { roleDisplayLabel, type AppRole } from "@/lib/constants";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const TYPE_SECTION: Record<string, string> = {
  CONTRACT_SENT_BO: "Contratti — invio BO",
  CONTRACT_OUTCOME: "Contratti — esito lavorazione",
  CTE_UPDATE: "Catalogo CTE",
  INFO: "Avvisi",
};

function formatRelativeIt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "ora";
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} g fa`;
  return d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function NotificationsPanel({
  open,
  items,
  unreadCount,
  loading,
  error,
  onClose,
  onMarkRead,
  onMarkAll,
}: {
  open: boolean;
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}) {
  if (!open) return null;

  const grouped = items.reduce<Record<string, NotificationItem[]>>((acc, n) => {
    const key = TYPE_SECTION[n.type] ?? "Altro";
    (acc[key] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
      role="dialog"
      aria-label="Notifiche"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
        <p className="text-sm font-semibold text-slate-900">Notifiche</p>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <button
              type="button"
              className="text-xs font-medium text-emerald-700 hover:underline"
              onClick={onMarkAll}
            >
              Segna tutte lette
            </button>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Chiudi"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
        </div>
      </div>

      <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
        {loading ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            Caricamento…
          </p>
        ) : error ? (
          <p className="px-3 py-6 text-center text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            Nessuna notifica
          </p>
        ) : (
          Object.entries(grouped).map(([section, list]) => (
            <div key={section}>
              <p className="bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {section}
              </p>
              <ul>
                {list.map((n) => {
                  const unread = !n.readAt;
                  const content = (
                    <>
                      <p
                        className={cn(
                          "text-sm text-slate-900",
                          unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {n.title}
                      </p>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatRelativeIt(n.createdAt)}
                      </p>
                    </>
                  );
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "border-b border-slate-100 last:border-0",
                        unread && "bg-emerald-50/40",
                      )}
                    >
                      {n.link ? (
                        <Link
                          href={n.link}
                          className="block px-3 py-2.5 hover:bg-slate-50"
                          onClick={() => {
                            if (unread) onMarkRead(n.id);
                            onClose();
                          }}
                        >
                          {content}
                          <span className="mt-1 inline-block text-xs font-medium text-emerald-700">
                            Apri →
                          </span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="block w-full px-3 py-2.5 text-left hover:bg-slate-50"
                          onClick={() => {
                            if (unread) onMarkRead(n.id);
                          }}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function TopBar({
  user,
  variant = "desktop",
}: {
  user: { name: string; email: string; role: AppRole };
  variant?: "desktop" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const roleLabel = roleDisplayLabel(user.role, user.email);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=1", {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount?: number };
      startTransition(() => {
        setUnread(data.unreadCount ?? 0);
      });
    } catch {
      /* ignore */
    }
  }, []);

  const loadPanel = useCallback(async () => {
    setPanelLoading(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/notifications?limit=30", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setPanelError("Impossibile caricare le notifiche");
        return;
      }
      const data = (await res.json()) as {
        items: NotificationItem[];
        unreadCount: number;
      };
      setItems(data.items ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      setPanelError("Errore di rete");
    } finally {
      setPanelLoading(false);
    }
  }, []);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) void loadPanel();
      else void refreshUnread();
      return next;
    });
  };

  useEffect(() => {
    const t = window.setInterval(() => void refreshUnread(), 60_000);
    queueMicrotask(() => void refreshUnread());
    return () => window.clearInterval(t);
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = (id: string) => {
    void (async () => {
      try {
        await fetch("/api/notifications/mark-read", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        setItems((prev) =>
          prev.map((n) =>
            n.id === id
              ? { ...n, readAt: n.readAt ?? new Date().toISOString() }
              : n,
          ),
        );
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    })();
  };

  const markAll = () => {
    void (async () => {
      try {
        await fetch("/api/notifications/mark-read", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        setItems((prev) =>
          prev.map((n) => ({
            ...n,
            readAt: n.readAt ?? new Date().toISOString(),
          })),
        );
        setUnread(0);
      } catch {
        /* ignore */
      }
    })();
  };

  const bell = (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={cn(
          "relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900",
          open && "bg-slate-100 text-slate-900",
        )}
        aria-label={
          unread > 0 ? `Notifiche, ${unread} non lette` : "Notifiche"
        }
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      <NotificationsPanel
        open={open}
        items={items}
        unreadCount={unread}
        loading={panelLoading}
        error={panelError}
        onClose={() => setOpen(false)}
        onMarkRead={markRead}
        onMarkAll={markAll}
      />
    </div>
  );

  if (variant === "mobile") {
    return <div className="flex items-center gap-1.5">{bell}</div>;
  }

  return (
    <header className="sticky top-0 z-30 mb-4 hidden border-b border-slate-200 bg-slate-50/95 backdrop-blur md:block">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-end gap-3 px-3 py-2.5 sm:px-6 lg:px-8">
        {bell}
        <div className="flex min-w-0 items-center gap-2.5 border-l border-slate-200 pl-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white"
            aria-hidden
          >
            {initials(user.name)}
          </div>
          <div className="min-w-0 text-right sm:text-left">
            <p className="truncate text-sm font-semibold uppercase tracking-wide text-slate-900">
              {user.name}
            </p>
            <p className="truncate text-xs text-slate-500">{roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
