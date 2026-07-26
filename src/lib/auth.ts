import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { Role } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { getRequestMeta } from "@/lib/request-meta";
import {
  isAuthRateLimited,
  logSecurityEvent,
} from "@/lib/security-log";

const SESSION_COOKIE = "crm_session";
const SESSION_DURATION = 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET non configurato");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");

  // Rileggi sempre dal DB: il ruolo nel cookie JWT può essere vecchio
  // (es. promozione ad Admin senza nuovo login).
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user || !user.active) {
    await destroySession();
    redirect("/login");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export async function login(email: string, password: string) {
  const meta = await getRequestMeta();
  const normalized = email.trim().toLowerCase();

  const limited = await isAuthRateLimited({
    email: normalized,
    ipAddress: meta.ipAddress,
  });
  if (limited.blocked) {
    await logSecurityEvent({
      eventType: "LOGIN_BLOCKED",
      email: normalized,
      details: limited.reason,
      meta,
    });
    return { error: limited.reason ?? "Troppi tentativi. Riprova più tardi." };
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
  });
  if (!user || !user.active) {
    await logSecurityEvent({
      eventType: "LOGIN_FAILED",
      email: normalized,
      details: "utente assente o disattivo",
      meta,
    });
    return { error: "Credenziali non valide" };
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    await logSecurityEvent({
      eventType: "LOGIN_FAILED",
      userId: user.id,
      email: user.email,
      details: "password errata",
      meta,
    });
    return { error: "Credenziali non valide" };
  }

  await createSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
    },
  });

  await logSecurityEvent({
    eventType: "LOGIN",
    userId: user.id,
    email: user.email,
    meta,
  });

  return { success: true };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}
