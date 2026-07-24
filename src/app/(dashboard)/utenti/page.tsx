import {
  createUserAction,
  deleteUserAction,
  deleteAllOtherUsersAction,
} from "@/lib/actions";
import { adminSendPasswordResetAction } from "@/lib/master-actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ROLE_LABELS } from "@/lib/constants";

export default async function UtentiPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) redirect("/");

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Utenti</h1>
          <p className="text-slate-500">Gestione accessi e ruoli</p>
        </div>
        <form action={deleteAllOtherUsersAction}>
          <Button type="submit" variant="danger">
            Elimina tutti tranne me
          </Button>
        </form>
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Non puoi eliminare l&apos;account con cui sei collegato. Prima crea il
        tuo admin reale, poi usa &quot;Elimina tutti tranne me&quot; oppure
        elimina gli utenti uno per uno.
      </p>

      <form
        action={createUserAction}
        className="grid max-w-3xl gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2"
      >
        <Field label="Nome">
          <Input name="name" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required minLength={6} />
        </Field>
        <Field label="Ruolo">
          <Select name="role" defaultValue="COLLABORATORE">
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Button type="submit">Crea utente</Button>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ruolo</th>
              <th className="px-4 py-3">Stato</th>
              <th className="px-4 py-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">
                  {user.name}
                  {user.id === session.id ? (
                    <span className="ml-2 text-xs text-emerald-700">(tu)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-3">{user.active ? "Attivo" : "Disattivo"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {user.id === session.id ? (
                      <Link href="/account">
                        <Button type="button" size="sm" variant="secondary">
                          Sicurezza
                        </Button>
                      </Link>
                    ) : (
                      <>
                        <form action={adminSendPasswordResetAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <Button type="submit" size="sm" variant="secondary">
                            Invia reset
                          </Button>
                        </form>
                        <form action={deleteUserAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <Button type="submit" variant="danger" size="sm">
                            Elimina
                          </Button>
                        </form>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
