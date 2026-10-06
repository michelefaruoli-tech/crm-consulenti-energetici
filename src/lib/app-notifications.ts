import "server-only";
import { prisma } from "@/lib/prisma";
import { getMasterEmail } from "@/lib/mail";
import { MASTER_EMAIL } from "@/lib/constants";

export const APP_NOTIFICATION_TYPES = [
  "CTE_UPDATE",
  "CONTRACT_SENT_BO",
  "CONTRACT_OUTCOME",
  "INFO",
] as const;

export type AppNotificationType = (typeof APP_NOTIFICATION_TYPES)[number];

export type CreateAppNotificationInput = {
  userId: string;
  type: AppNotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
};

/**
 * Crea una notifica in-app. Una `create` per volta (Neon HTTP: no createMany).
 * Non lancia: fallimenti loggati, non bloccano il flusso chiamante.
 */
export async function createAppNotification(
  input: CreateAppNotificationInput,
): Promise<string | null> {
  try {
    const row = await prisma.appNotification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 2000) ?? null,
        link: input.link?.slice(0, 500) ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    console.error("[createAppNotification]", e);
    return null;
  }
}

/** Crea la stessa notifica per più utenti (dedup id). */
export async function createAppNotificationsForUsers(
  userIds: string[],
  payload: Omit<CreateAppNotificationInput, "userId">,
): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  let created = 0;
  for (const userId of unique) {
    const id = await createAppNotification({ ...payload, userId });
    if (id) created += 1;
  }
  return created;
}

/** Risolve userId attivi da elenco email (case-insensitive). */
export async function resolveActiveUserIdsByEmails(
  emails: string[],
): Promise<string[]> {
  const normalized = [
    ...new Set(
      emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
  if (normalized.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: normalized.map((email) => ({
        email: { equals: email, mode: "insensitive" as const },
      })),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Admin attivi + account Master (email Michele / env).
 * Usato per broadcast CTE e altri avvisi staff.
 */
export async function resolveAdminAndMasterUserIds(): Promise<string[]> {
  const masterEmail = (
    process.env.MASTER_EMAIL?.trim() ||
    getMasterEmail() ||
    MASTER_EMAIL
  )
    .trim()
    .toLowerCase();

  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: "ADMIN" },
        ...(masterEmail
          ? [{ email: { equals: masterEmail, mode: "insensitive" as const } }]
          : []),
      ],
    },
    select: { id: true },
  });
  return [...new Set(users.map((u) => u.id))];
}

/** Admin + Back Office attivi (aggiornamenti catalogo CTE). */
export async function resolveCteBroadcastUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["ADMIN", "BACKOFFICE"] },
    },
    select: { id: true },
  });
  const ids = new Set(users.map((u) => u.id));
  for (const id of await resolveAdminAndMasterUserIds()) ids.add(id);
  return [...ids];
}

export async function listAppNotificationsForUser(
  userId: string,
  opts?: { limit?: number },
) {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 50);
  const items = await prisma.appNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });
  const unreadCount = items.filter((n) => n.readAt == null).length;
  // Conteggio non lette totale (anche oltre la pagina): query separata leggera
  const unreadTotal = await prisma.appNotification.count({
    where: { userId, readAt: null },
  });
  return {
    items,
    unreadCount: unreadTotal > 0 ? unreadTotal : unreadCount,
  };
}

/**
 * Marca una notifica come letta (solo se appartiene all’utente).
 */
export async function markAppNotificationRead(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const row = await prisma.appNotification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, readAt: true },
  });
  if (!row) return false;
  if (row.readAt) return true;
  await prisma.appNotification.update({
    where: { id: row.id },
    data: { readAt: new Date() },
  });
  return true;
}

/**
 * Marca tutte le non lette dell’utente.
 * Usa UPDATE SQL unica (Neon HTTP: no updateMany).
 */
export async function markAllAppNotificationsRead(
  userId: string,
): Promise<number> {
  const now = new Date();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE "AppNotification" SET "readAt" = $1 WHERE "userId" = $2 AND "readAt" IS NULL`,
    now,
    userId,
  );
  return typeof result === "number" ? result : 0;
}
