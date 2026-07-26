import {
  createUserAction,
  deleteUserAction,
  restoreUserAction,
  restoreAllDeletedUsersAction,
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
import { DeleteAllUsersButton } from "@/components/utenti/delete-all-users-button";

export default async function UtentiPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) redirect("/");

  const [users, deletedUsers] = await Promise.all([
    prisma.user.findMany({
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
    }),
    prisma.user.findMany({
      where: { active: false },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        updatedAt: true,
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Utenti</h1>
          <p className="text-slate-500">Gestione accessi e ruoli</p>
        </div>
        <DeleteAllUsersButton />
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Non puoi eliminare l&apos;account con cui sei collegato. Gli utenti
        eliminati non spariscono dal database: restano disattivati e li puoi
        ripristinare qui sotto. &quot;Elimina tutti tranne me&quot; richiede due
        conferme (finestra + digita <strong>ELIMINA TUTTI</strong>).
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
                <td className="px-4 py-3">
                  {user.active ? "Attivo" : "Disattivo"}
                </td>
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

      {deletedUsers.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Utenti eliminati (ripristinabili)
              </h2>
              <p className="text-sm text-slate-500">
                {deletedUsers.length} account disattivati — i contratti restano
                collegati a loro.
              </p>
            </div>
            <form action={restoreAllDeletedUsersAction}>
              <Button type="submit" variant="secondary">
                Ripristina tutti
              </Button>
            </form>
          </div>

          <div className="overflow-hidden rounded-xl border border-rose-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-rose-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Email (tecnica)</th>
                  <th className="px-4 py-3">Ruolo</th>
                  <th className="px-4 py-3">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {deletedUsers.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{user.name}</td>
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-slate-500">
                      {user.email}
                    </td>
                    <td className="px-4 py-3">{ROLE_LABELS[user.role]}</td>
                    <td className="px-4 py-3">
                      <form action={restoreUserAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <Button type="submit" size="sm">
                          Ripristina
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
