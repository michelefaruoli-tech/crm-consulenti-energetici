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
  purgeDeletedUsersPermanentlyAction,
} from "@/lib/actions";
import { roleSupportsSupplierScope } from "@/lib/user-scope";

function supplierLabel(
  scopes: { supplier?: { name: string } | null }[] | undefined,
  role: string,
): string {
  if (!scopes?.length) {
    if (role === "BACKOFFICE") return "nessuno (non vede contratti)";
    return "tutti";
  }
  return scopes.map((s) => s.supplier?.name ?? "?").join(", ");
}

export default async function UtentiPage() {
  const session = await requireSession();
  const isAdmin = hasPermission(session.role, "users.manage");
  const isAreaManager =
    session.role === "AREA_MANAGER" &&
    hasPermission(session.role, "users.manage_team");
  if (!isAdmin && !isAreaManager) redirect("/");

  const teamIds = isAreaManager
    ? (
        await prisma.userCollaboratorScope.findMany({
          where: { userId: session.id },
          select: { collaboratorId: true },
        })
      ).map((c) => c.collaboratorId)
    : [];

  const [users, deletedUsers, suppliers, collaborators] = await Promise.all([
    prisma.user.findMany({
      where: isAdmin
        ? { active: true }
        : {
            active: true,
            OR: [{ id: session.id }, { id: { in: teamIds } }],
          },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        supplierScopes: {
          select: { supplierId: true, supplier: { select: { name: true } } },
        },
        collaboratorScopes: {
          select: {
            collaboratorId: true,
            collaborator: { select: { name: true } },
          },
        },
      },
    }),
    isAdmin
      ? prisma.user.findMany({
          where: { active: false },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: {
          in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA", "AREA_MANAGER"],
        },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Area Manager: fornitori limitati al proprio scope (se impostato)
  let supplierOptions = suppliers;
  if (isAreaManager && !isAdmin) {
    const myScope = await prisma.userSupplierScope.findMany({
      where: { userId: session.id },
      select: { supplierId: true },
    });
    if (myScope.length > 0) {
      const allowed = new Set(myScope.map((s) => s.supplierId));
      supplierOptions = suppliers.filter((s) => allowed.has(s.id));
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isAreaManager && !isAdmin ? "Il mio team" : "Utenti"}
          </h1>
          <p className="text-slate-500">
            {isAreaManager && !isAdmin
              ? "Crea e gestisci i collaboratori che inseriscono contratti per te"
              : "Gestione accessi, ruoli, fornitori e Area Manager"}
          </p>
        </div>
        {isAdmin ? <DeleteAllUsersButton /> : null}
      </div>

      {isAdmin ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Per ogni ruolo (Backoffice, Area Manager, Collaboratore, Commerciale)
          puoi assegnare <strong>tutti</strong> o <strong>parte dei fornitori</strong>.
          L&apos;<strong>Area Manager</strong> può creare collaboratori e vedere i
          loro contratti. I Backoffice ricevono le email «da lavorare» sui
          fornitori assegnati.
        </p>
      ) : (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Come Area Manager puoi creare Collaboratori o Commerciali: entrano nel
          tuo team e tu vedi i loro contratti in Provvigioni / Contratti.
        </p>
      )}

      <CreateUserForm
        suppliers={supplierOptions}
        collaborators={collaborators}
        allowedRoles={
          isAreaManager && !isAdmin
            ? ["COLLABORATORE", "COMMERCIALE"]
            : undefined
        }
        isAreaManager={isAreaManager && !isAdmin}
      />

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
                    <p>
                      {ROLE_LABELS[user.role as AppRole] ?? String(user.role)}
                    </p>
                    {roleSupportsSupplierScope(user.role) ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Fornitori:{" "}
                          {supplierLabel(user.supplierScopes, user.role)}
                        </p>
                        {user.role === "BACKOFFICE" ||
                        user.role === "AREA_MANAGER" ? (
                          <p className="text-xs text-slate-500">
                            {user.role === "AREA_MANAGER" ? "Team" : "Collab"}:{" "}
                            {user.collaboratorScopes?.length
                              ? user.collaboratorScopes
                                  .map((c) => c.collaborator?.name ?? "?")
                                  .join(", ")
                              : user.role === "AREA_MANAGER"
                                ? "vuoto (crea collaboratori)"
                                : "tutti"}
                          </p>
                        ) : null}
                        {isAdmin || user.id === session.id || teamIds.includes(user.id) ? (
                          <EditUserScopesForm
                            user={{
                              id: user.id,
                              name: user.name,
                              role: user.role as AppRole,
                            }}
                            suppliers={supplierOptions}
                            collaborators={collaborators}
                            selectedSupplierIds={(user.supplierScopes ?? []).map(
                              (s) => s.supplierId,
                            )}
                            selectedCollaboratorIds={(
                              user.collaboratorScopes ?? []
                            ).map((c) => c.collaboratorId)}
                          />
                        ) : null}
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
                    ) : isAdmin ? (
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
                    ) : (
                      <span className="text-xs text-slate-500">Nel tuo team</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && deletedUsers.length > 0 ? (
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
            <div className="flex flex-wrap gap-2">
              <form action={restoreAllDeletedUsersAction}>
                <Button type="submit" variant="secondary">
                  Ripristina tutti
                </Button>
              </form>
              <form action={purgeDeletedUsersPermanentlyAction}>
                <Button type="submit" variant="danger">
                  Elimina definitivamente
                </Button>
              </form>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            «Elimina definitivamente» cancella dal database gli account senza
            contratti collegati (non si possono più ripristinare).
          </p>

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
