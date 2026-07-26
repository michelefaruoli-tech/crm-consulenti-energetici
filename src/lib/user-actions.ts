"use server";

import { revalidatePath } from "next/cache";
import { requireSession, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/client";

const ROLES: Role[] = [
  "ADMIN",
  "SEGRETERIA",
  "BACKOFFICE",
  "COLLABORATORE",
  "COMMERCIALE",
];

function parseIds(formData: FormData, key: string): string[] {
  return [...new Set(formData.getAll(key).map((v) => String(v).trim()).filter(Boolean))];
}

function parseRole(raw: string): Role | null {
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

/**
 * Crea utente. Per Backoffice: fornitori obbligatori; collaboratori vuoti = TUTTI.
 */
export async function createUserAction(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "users.manage")) {
      return { error: "Permesso negato" };
    }

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const role = parseRole(String(formData.get("role") ?? "COLLABORATORE"));
    const allCollaborators =
      String(formData.get("allCollaborators") ?? "") === "1" ||
      String(formData.get("allCollaborators") ?? "") === "on";

    if (!name) return { error: "Nome obbligatorio" };
    if (!email || !email.includes("@")) return { error: "Email non valida" };
    if (password.length < 6) return { error: "Password: minimo 6 caratteri" };
    if (!role) return { error: "Ruolo non valido" };

    const supplierIds = parseIds(formData, "supplierIds");
    const collaboratorIds = allCollaborators
      ? []
      : parseIds(formData, "collaboratorIds");

    if (role === "BACKOFFICE" && supplierIds.length === 0) {
      return {
        error:
          "Per un Backoffice seleziona almeno un fornitore (es. Enel). I collaboratori puoi lasciare «Tutti».",
      };
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

    // 1) utente  2) scope (separati = errori più chiari)
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role,
        password: await hashPassword(password),
      },
    });

    if (role === "BACKOFFICE") {
      if (supplierIds.length) {
        await prisma.userSupplierScope.createMany({
          data: supplierIds.map((supplierId) => ({
            userId: user.id,
            supplierId,
          })),
          skipDuplicates: true,
        });
      }
      if (collaboratorIds.length) {
        await prisma.userCollaboratorScope.createMany({
          data: collaboratorIds.map((collaboratorId) => ({
            userId: user.id,
            collaboratorId,
          })),
          skipDuplicates: true,
        });
      }
    }

    revalidatePath("/utenti");
    return { ok: true };
  } catch (e) {
    console.error("[createUserAction]", e);
    const msg = e instanceof Error ? e.message : "Errore creazione utente";
    if (msg.includes("Unique constraint") || msg.includes("User_email")) {
      return { error: "Email già registrata" };
    }
    if (msg.includes("BACKOFFICE") || msg.includes("invalid input value for enum")) {
      return {
        error:
          "Il database non ha ancora il ruolo Backoffice. Contatta il supporto o esegui le migrazioni.",
      };
    }
    if (msg.includes("UserSupplierScope") || msg.includes("does not exist")) {
      return {
        error:
          "Tabelle scope Backoffice mancanti sul database. Esegui le migrazioni Prisma.",
      };
    }
    return { error: msg.slice(0, 200) };
  }
}

/** Aggiorna fornitori/collaboratori visibili per un Backoffice. */
export async function updateUserScopesAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireSession();
    if (!hasPermission(session.role, "users.manage")) {
      return { error: "Permesso negato" };
    }

    const userId = String(formData.get("userId") ?? "");
    if (!userId) return { error: "Utente mancante" };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) return { error: "Utente non trovato" };
    if (user.role !== "BACKOFFICE") {
      return { error: "Lo scope si applica solo al ruolo Backoffice" };
    }

    const allCollaborators =
      String(formData.get("allCollaborators") ?? "") === "1" ||
      String(formData.get("allCollaborators") ?? "") === "on";
    const supplierIds = parseIds(formData, "supplierIds");
    const collaboratorIds = allCollaborators
      ? []
      : parseIds(formData, "collaboratorIds");

    if (supplierIds.length === 0) {
      return { error: "Seleziona almeno un fornitore" };
    }

    await prisma.$transaction([
      prisma.userSupplierScope.deleteMany({ where: { userId } }),
      prisma.userCollaboratorScope.deleteMany({ where: { userId } }),
      prisma.userSupplierScope.createMany({
        data: supplierIds.map((supplierId) => ({ userId, supplierId })),
        skipDuplicates: true,
      }),
      ...(collaboratorIds.length
        ? [
            prisma.userCollaboratorScope.createMany({
              data: collaboratorIds.map((collaboratorId) => ({
                userId,
                collaboratorId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    revalidatePath("/utenti");
    return { ok: true };
  } catch (e) {
    console.error("[updateUserScopesAction]", e);
    return {
      error: e instanceof Error ? e.message.slice(0, 200) : "Errore salvataggio scope",
    };
  }
}
