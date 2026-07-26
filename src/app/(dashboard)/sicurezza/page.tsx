import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatRomeDateTime } from "@/lib/timezone";

const EVENT_LABELS: Record<string, string> = {
  LOGIN: "Login riuscito",
  LOGIN_FAILED: "Login fallito",
  LOGIN_BLOCKED: "Login bloccato (rate limit)",
  HONEYPOT: "Bot / honeypot",
  PASSWORD_CHANGED: "Password cambiata",
  PASSWORD_RESET_REQUESTED: "Reset password richiesto",
  PASSWORD_RESET_COMPLETED: "Reset password completato",
  PASSWORD_RESET_BLOCKED: "Reset bloccato (rate limit)",
};

export default async function SicurezzaPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "security.view")) redirect("/");

  const events = await prisma.userSecurityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [fails24h, blocks24h, logins24h] = await Promise.all([
    prisma.userSecurityEvent.count({
      where: { eventType: "LOGIN_FAILED", createdAt: { gte: since } },
    }),
    prisma.userSecurityEvent.count({
      where: {
        eventType: { in: ["LOGIN_BLOCKED", "PASSWORD_RESET_BLOCKED"] },
        createdAt: { gte: since },
      },
    }),
    prisma.userSecurityEvent.count({
      where: { eventType: "LOGIN", createdAt: { gte: since } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Eventi sicurezza</h1>
        <p className="mt-1 text-sm text-slate-600">
          Accessi, tentativi falliti, reset password. Solo Admin. Ultime 100
          righe.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-emerald-700">{logins24h}</p>
          <p className="text-xs text-slate-500">Login ok (24h)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-amber-700">{fails24h}</p>
          <p className="text-xs text-slate-500">Login falliti (24h)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-rose-700">{blocks24h}</p>
          <p className="text-xs text-slate-500">Blocchi rate-limit (24h)</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Evento</th>
              <th className="px-3 py-2">Email / utente</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Nessun evento ancora. Appariranno ai prossimi login.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                    {formatRomeDateTime(e.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        e.eventType.includes("FAIL") ||
                        e.eventType.includes("BLOCK") ||
                        e.eventType === "HONEYPOT"
                          ? "font-medium text-rose-700"
                          : e.eventType === "LOGIN"
                            ? "font-medium text-emerald-700"
                            : "text-slate-800"
                      }
                    >
                      {EVENT_LABELS[e.eventType] ?? e.eventType}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div>{e.email || e.user?.email || "—"}</div>
                    {e.user?.name ? (
                      <div className="text-xs text-slate-500">{e.user.name}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {e.ipAddress || "—"}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">
                    {e.details || e.userAgent?.slice(0, 60) || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-500">
        Vedi anche{" "}
        <Link href="/privacy" className="text-emerald-700 underline">
          Informativa privacy
        </Link>{" "}
        (pubblica) e{" "}
        <Link href="/account" className="text-emerald-700 underline">
          Account
        </Link>{" "}
        per cambiare la tua password.
      </p>
    </div>
  );
}
