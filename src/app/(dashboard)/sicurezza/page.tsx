import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatRomeDateTime } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  LOGIN: "Login riuscito",
  LOGIN_FAILED: "Login fallito",
  LOGIN_BLOCKED: "Login bloccato (rate limit)",
  ACCESS: "Accesso pagina",
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
  const [fails24h, blocks24h, logins24h, accesses24h] = await Promise.all([
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
    prisma.userSecurityEvent.count({
      where: { eventType: "ACCESS", createdAt: { gte: since } },
    }),
  ]);

  const lastFail = events.find((e) => e.eventType === "LOGIN_FAILED");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Eventi sicurezza</h1>
        <p className="mt-1 text-sm text-slate-600">
          Login, accessi alle pagine del CRM, reset password e tentativi
          sospetti. Solo Admin. Aggiorna la pagina (F5) per vedere gli eventi
          più recenti.
        </p>
      </div>

      {lastFail ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <strong>Ultimo login fallito:</strong>{" "}
          {formatRomeDateTime(lastFail.createdAt)} —{" "}
          {lastFail.email || lastFail.user?.email || "email sconosciuta"}
          {lastFail.details ? ` (${lastFail.details})` : ""}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Nessun login fallito in elenco. Prova ad accedere con password sbagliata
          da un’altra scheda, poi torna qui e premi F5.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-sky-700">{accesses24h}</p>
          <p className="text-xs text-slate-500">Accessi pagine (24h)</p>
        </div>
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
                  Nessun evento ancora.
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const isFail =
                  e.eventType.includes("FAIL") ||
                  e.eventType.includes("BLOCK") ||
                  e.eventType === "HONEYPOT";
                const isAccess = e.eventType === "ACCESS";
                return (
                  <tr
                    key={e.id}
                    className={`border-t border-slate-100 align-top ${
                      isFail ? "bg-rose-50/40" : isAccess ? "bg-sky-50/30" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                      {formatRomeDateTime(e.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          isFail
                            ? "font-medium text-rose-700"
                            : e.eventType === "LOGIN"
                              ? "font-medium text-emerald-700"
                              : isAccess
                                ? "font-medium text-sky-700"
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
                    <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
                      {e.details || "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-500">
        Nota: nella schermata di login compare solo «Credenziali non valide» (non
        dice se è email o password), per non aiutare chi prova a entrare. Il
        dettaglio «password errata» lo vedi solo qui.
      </p>

      <p className="text-sm text-slate-500">
        <Link href="/privacy" className="text-emerald-700 underline">
          Informativa privacy
        </Link>
        {" · "}
        <Link href="/account" className="text-emerald-700 underline">
          Account (cambio password)
        </Link>
      </p>
    </div>
  );
}
