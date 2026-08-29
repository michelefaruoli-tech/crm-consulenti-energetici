import "server-only";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";

const WINDOW_MS = 15 * 60 * 1000; // 15 minuti
const MAX_FAILS_IP = 12;
const MAX_FAILS_EMAIL = 8;

export type SecurityEventType =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "ACCESS"
  | "HONEYPOT"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "PASSWORD_RESET_BLOCKED";

const ACCESS_DEDUP_MS = 15 * 60 * 1000; // stessa pagina, stesso utente: max 1 evento / 15 min

/** Scrive evento (senza transaction: Neon HTTP). */
export async function logSecurityEvent(opts: {
  eventType: SecurityEventType;
  userId?: string | null;
  email?: string | null;
  details?: string | null;
  meta?: RequestMeta;
}): Promise<void> {
  try {
    await prisma.userSecurityEvent.create({
      data: {
        eventType: opts.eventType,
        userId: opts.userId || null,
        email: opts.email?.trim().toLowerCase().slice(0, 200) || null,
        details: opts.details?.slice(0, 500) || null,
        ipAddress: opts.meta?.ipAddress?.slice(0, 80) || null,
        userAgent: opts.meta?.userAgent?.slice(0, 400) || null,
      },
    });
  } catch (e) {
    console.error("[logSecurityEvent]", e);
  }
}

/** Registra accesso a una pagina del CRM (con dedup per evitare flood da RSC/prefetch). */
export async function logAccessEvent(opts: {
  userId: string;
  email: string;
  path: string;
  meta?: RequestMeta;
}): Promise<void> {
  const path = opts.path.slice(0, 200) || "/";
  const since = new Date(Date.now() - ACCESS_DEDUP_MS);

  try {
    const recent = await prisma.userSecurityEvent.findFirst({
      where: {
        userId: opts.userId,
        eventType: "ACCESS",
        details: path,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) return;

    await logSecurityEvent({
      eventType: "ACCESS",
      userId: opts.userId,
      email: opts.email,
      details: path,
      meta: opts.meta,
    });
  } catch (e) {
    console.error("[logAccessEvent]", e);
  }
}

/**
 * Rate limit login / forgot: troppi fallimenti da stesso IP o stessa email.
 * Gratis, solo DB (nessun Redis).
 */
export async function isAuthRateLimited(opts: {
  email?: string | null;
  ipAddress?: string | null;
}): Promise<{ blocked: boolean; reason?: string }> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failTypes = ["LOGIN_FAILED", "LOGIN_BLOCKED", "HONEYPOT", "PASSWORD_RESET_BLOCKED"];

  try {
    if (opts.ipAddress) {
      const byIp = await prisma.userSecurityEvent.count({
        where: {
          ipAddress: opts.ipAddress,
          eventType: { in: failTypes },
          createdAt: { gte: since },
        },
      });
      if (byIp >= MAX_FAILS_IP) {
        return {
          blocked: true,
          reason: "Troppi tentativi da questa rete. Riprova tra 15 minuti.",
        };
      }
    }

    const email = opts.email?.trim().toLowerCase();
    if (email) {
      const byEmail = await prisma.userSecurityEvent.count({
        where: {
          email,
          eventType: { in: failTypes },
          createdAt: { gte: since },
        },
      });
      if (byEmail >= MAX_FAILS_EMAIL) {
        return {
          blocked: true,
          reason: "Troppi tentativi per questa email. Riprova tra 15 minuti.",
        };
      }
    }
  } catch (e) {
    console.error("[isAuthRateLimited]", e);
  }

  return { blocked: false };
}

/** Honeypot: campo nascosto compilato dai bot. */
export function isHoneypotFilled(formData: FormData): boolean {
  const v = String(formData.get("website") ?? formData.get("company_url") ?? "").trim();
  return v.length > 0;
}
