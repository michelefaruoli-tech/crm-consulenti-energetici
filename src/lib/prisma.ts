import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function normalizeDatabaseUrl(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
    ? normalizeDatabaseUrl(process.env.DATABASE_URL)
    : "";
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL non configurata. Imposta la connection string Neon in .env / Vercel.",
    );
  }

  // HTTP adapter: più stabile su Vercel serverless rispetto ai WebSocket
  const adapter = new PrismaNeonHttp(connectionString, {
    arrayMode: false,
    fullResults: true,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
