"use server";

import { revalidatePath } from "next/cache";
import { requireSession, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";
import {
  roleSupportsCollaboratorScope,
  roleSupportsSupplierScope,
} from "@/lib/user-scope";

const ROLES: Role[] = [
  "ADMIN",
  "SEGRETERIA",
  "BACKOFFICE",
  "AREA_MANAGER",
  "COLLABORATORE",
  "COMMERCIALE",
];

/** Ruoli che un Area Manager può creare. */
const TEAM_CREATABLE: Role[] = ["COLLABORATORE", "COMMERCIALE"];

function parseIds(formData: FormData, key: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(key)
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ];
}

function parseRole(raw: string): Role | null {
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

async function replaceUserScopes(opts: {
  userId: string;
  supplierIds: string[];
  collaboratorIds: string[];
}): Promise<void> {
  const { userId, supplierIds, collaboratorIds } = opts;

  await prisma.userSupplierScope.deleteMany({ where: { userId } });
  await prisma.userCollaboratorScope.deleteMany({ where: { userId } });

  for (const supplierId of supplierIds) {
    await prisma.userSupplierScope.create({
      data: { userId, supplierId },
    });
  }
  for (const collaboratorId of collaboratorIds) {
    await prisma.userCollaboratorScope.create({
      data: { userId, collaboratorId },
    });
  }
}

function canManageUsers(role: Role): boolean {
  return (
    hasPermission(role, "users.manage") ||
    hasPermission(role, "users.manage_team")
  );
}

/**
 * Crea utente.
 * - Admin: qualsiasi ruolo + scope
 * - Area Manager: solo Collaboratore/Commerciale, aggiunti al proprio team
 */
export async function createUserAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!canManageUsers(session.role)) {
      return { error: "Permesso negato" };
    }

    const isAdmin = hasPermission(session.role, "users.manage");
    const isAreaManager = session.role === "AREA_MANAGER";

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const role = parseRole(String(formData.get("role") ?? "COLLABORATORE"));
    const allCollaborators =
      String(formData.get("allCollaborators") ?? "") === "1" ||
      String(formData.get("allCollaborators") ?? "") === "on";
    const allSuppliers =
      String(formData.get("allSuppliers") ?? "") === "1" ||
      String(formData.get("allSuppliers") ?? "") === "on";

    if (!name) return { error: "Nome obbligatorio" };
    if (!email || !email.includes("@")) return { error: "Email non valida" };
    if (!role) return { error: "Ruolo non valido" };

    if (isAreaManager && !isAdmin) {
      if (!TEAM_CREATABLE.includes(role)) {
        return {
          error:
            "Come Area Manager puoi creare solo Collaboratori o Commerciali",
        };
      }
    }

    const { validatePassword } = await import("@/lib/password-policy");
    const pwCheck = validatePassword(password, { email });
    if (!pwCheck.ok) return { error: pwCheck.error };

    let supplierIds = allSuppliers ? [] : parseIds(formData, "supplierIds");
    const collaboratorIds = allCollaborators
      ? []
      : parseIds(formData, "collaboratorIds");

    // Area Manager: i fornitori del nuovo collab = intersezione col proprio scope (se ha scope)
    if (isAreaManager && !isAdmin) {
      const mySuppliers = await prisma.userSupplierScope.findMany({
        where: { userId: session.id },
        select: { supplierId: true },
      });
      if (mySuppliers.length > 0) {
        const allowed = new Set(mySuppliers.map((s) => s.supplierId));
        if (supplierIds.length === 0) {
          supplierIds = [...allowed];
        } else {
          supplierIds = supplierIds.filter((id) => allowed.has(id));
        }
      }
    }

    if (role === "BACKOFFICE" && supplierIds.length === 0 && !allSuppliers) {
      return {
        error:
          "Per un Backoffice seleziona almeno un fornitore (es. Enel). I collaboratori puoi lasciare «Tutti».",
      };
    }

    if (role === "AREA_MANAGER" && supplierIds.length === 0 && !allSuppliers) {
      // Area Manager può partire senza fornitori = tutti; ok
    }

    const existing = await prisma.user.findFirst({
      where: { email },
      select: { id: true, active: true },
    });
    if (existing) {
      return {
        error: existing.active
          ? "Esiste già un utente con questa email"
          : "Email già usata da un utente eliminato: ripristinalo o scegli un’altra email",
      };
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        role,
        password: await hashPassword(password),
      },
    });

    if (roleSupportsSupplierScope(role)) {
      try {
        // allSuppliers = nessuna riga → nessun filtro (vedono tutti i fornitori)
        const saveSuppliers = allSuppliers ? [] : supplierIds;
        const saveCollabs = roleSupportsCollaboratorScope(role)
          ? collaboratorIds
          : [];
        await replaceUserScopes({
          userId: user.id,
          supplierIds: saveSuppliers,
          collaboratorIds: saveCollabs,
        });
      } catch (scopeErr) {
        console.error("[createUserAction scopes]", scopeErr);
        revalidatePath("/utenti");
        return {
          ok: true,
          error: `Utente creato, ma scope fornitori non salvato: ${
            scopeErr instanceof Error ? scopeErr.message.slice(0, 120) : "errore"
          }. Apri «Scope fornitori» e salva di nuovo.`,
        };
      }
    }

    // Area Manager: il nuovo collaboratore entra nel suo team
    if (isAreaManager && !isAdmin && TEAM_CREATABLE.includes(role)) {
      await prisma.userCollaboratorScope.create({
        data: { userId: session.id, collaboratorId: user.id },
      }).catch(() => undefined);
    }

    revalidatePath("/utenti");
    return { ok: true };
  } catch (e) {
    console.error("[createUserAction]", e);
    const msg = e instanceof Error ? e.message : "Errore creazione utente";
    if (msg.includes("Transactions are not supported")) {
      return {
        error:
          "Errore database (Neon HTTP). Riprova: se persiste, crea l’utente senza scope e assegna i fornitori dopo.",
      };
    }
    if (msg.includes("Unique constraint") || msg.includes("User_email")) {
      return { error: "Email già registrata" };
    }
    if (msg.includes("invalid input value for enum")) {
      return {
        error:
          "Il database non ha ancora il ruolo richiesto. Esegui le migrazioni Prisma.",
      };
    }
    return { error: msg.slice(0, 200) };
  }
}

/** Aggiorna fornitori / collaboratori nello scope di un utente. */
export async function updateUserScopesAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireSession();
    if (!canManageUsers(session.role)) {
      return { error: "Permesso negato" };
    }

    const isAdmin = hasPermission(session.role, "users.manage");
    const userId = String(formData.get("userId") ?? "");
    if (!userId) return { error: "Utente mancante" };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) return { error: "Utente non trovato" };

    if (!roleSupportsSupplierScope(user.role)) {
      return {
        error:
          "Questo ruolo non usa lo scope fornitori (Admin/Segreteria vedono tutto)",
      };
    }

    // Area Manager può modificare solo membri del proprio team (o sé stesso)
    if (!isAdmin && session.role === "AREA_MANAGER") {
      if (userId === session.id) {
        // ok: può aggiornare i propri fornitori
      } else {
        const inTeam = await prisma.userCollaboratorScope.findFirst({
          where: { userId: session.id, collaboratorId: userId },
        });
        if (!inTeam) {
          return { error: "Puoi gestire solo i collaboratori del tuo team" };
        }
      }
    }

    const allCollaborators =
      String(formData.get("allCollaborators") ?? "") === "1" ||
      String(formData.get("allCollaborators") ?? "") === "on";
    const allSuppliers =
      String(formData.get("allSuppliers") ?? "") === "1" ||
      String(formData.get("allSuppliers") ?? "") === "on";

    let supplierIds = allSuppliers ? [] : parseIds(formData, "supplierIds");
    const collaboratorIds =
      roleSupportsCollaboratorScope(user.role) && !allCollaborators
        ? parseIds(formData, "collaboratorIds")
        : [];

    if (user.role === "BACKOFFICE" && supplierIds.length === 0 && !allSuppliers) {
      return { error: "Seleziona almeno un fornitore" };
    }

    if (!isAdmin && session.role === "AREA_MANAGER" && userId !== session.id) {
      const mySuppliers = await prisma.userSupplierScope.findMany({
        where: { userId: session.id },
        select: { supplierId: true },
      });
      if (mySuppliers.length > 0) {
        const allowed = new Set(mySuppliers.map((s) => s.supplierId));
        supplierIds = supplierIds.filter((id) => allowed.has(id));
      }
    }

    await replaceUserScopes({
      userId,
      supplierIds,
      collaboratorIds,
    });

    revalidatePath("/utenti");
    return { ok: true };
  } catch (e) {
    console.error("[updateUserScopesAction]", e);
    const msg = e instanceof Error ? e.message : "Errore salvataggio scope";
    if (msg.includes("Transactions are not supported")) {
      return {
        error:
          "Errore database Neon (transazioni). Riprova tra qualche secondo.",
      };
    }
    return { error: msg.slice(0, 200) };
  }
}
