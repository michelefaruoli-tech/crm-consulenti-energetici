import { adminSendPasswordResetAction } from "@/lib/master-actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { DeleteAllUsersButton } from "@/components/utenti/delete-all-users-button";
import { AdminSetPasswordButton } from "@/components/utenti/admin-set-password-button";
import { CreateUserForm } from "@/components/utenti/create-user-form";
import { EditUserScopesForm } from "@/components/utenti/edit-user-scopes-form";
import {
  deleteUserAction,
  restoreUserAction,
  restoreAllDeletedUsersAction,
} from "@/lib/actions";

export default async function UtentiPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "users.manage")) redirect("/");

  const [users, deletedUsers, suppliers, collaborators] = await Promise.all([
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
        supplierScopes: { select: { supplierId: true, supplier: { select: { name: true } } } },
        collaboratorScopes: {
          select: {
            collaboratorId: true,
            collaborator: { select: { name: true } },
          },
        },
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
    prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Utenti</h1>
          <p className="text-slate-500">
            Gestione accessi, ruoli e scope Backoffice (fornitori / collaboratori)
          </p>
        </div>
        <DeleteAllUsersButton />
      </div>

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Non puoi eliminare l&apos;account con cui sei collegato. Gli utenti
        eliminati non spariscono dal database: restano disattivati e li puoi
        ripristinare qui sotto. Per i <strong>Backoffice</strong>: assegna i
        fornitori (es. Enel, oppure Dolomiti + Edison). Quando arriva un
        contratto «da lavorare» di quel fornitore, l&apos;email parte a te
        (Admin) <strong>e</strong> ai backoffice di quel fornitore.
      </p>

      <CreateUserForm suppliers={suppliers} collaborators={collaborators} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ruolo / scope</th>
              <th className="px-4 py-3">Stato</th>
              <th className="px-4 py-3">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 font-medium">
                  {user.name}
                  {user.id === session.id ? (
                    <span className="ml-2 text-xs text-emerald-700">(tu)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <p>{ROLE_LABELS[user.role as AppRole] ?? String(user.role)}</p>
                    {user.role === "BACKOFFICE" ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Fornitori:{" "}
                          {user.supplierScopes?.length
                            ? user.supplierScopes
                                .map((s) => s.supplier?.name ?? "?")
                                .join(", ")
                            : "nessuno (non vede contratti)"}
                        </p>
                        <p className="text-xs text-slate-500">
                          Collab:{" "}
                          {user.collaboratorScopes?.length
                            ? user.collaboratorScopes
                                .map((c) => c.collaborator?.name ?? "?")
                                .join(", ")
                            : "tutti"}
                        </p>
                        <EditUserScopesForm
                          user={{
                            id: user.id,
                            name: user.name,
                            role: user.role as AppRole,
                          }}
                          suppliers={suppliers}
                          collaborators={collaborators}
                          selectedSupplierIds={(user.supplierScopes ?? []).map(
                            (s) => s.supplierId,
                          )}
                          selectedCollaboratorIds={(
                            user.collaboratorScopes ?? []
                          ).map((c) => c.collaboratorId)}
                        />
                      </>
                    ) : null}
                  </div>
                </td>
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
                        <AdminSetPasswordButton
                          userId={user.id}
                          userName={user.name}
                        />
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
                    <td className="px-4 py-3">
                      {ROLE_LABELS[user.role as AppRole] ?? user.role}
                    </td>
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
