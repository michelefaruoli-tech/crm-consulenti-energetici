import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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

  // Solo script di test locali (Postgres TCP, es. check-backfill-apply-pg.ts).
  if (process.env.PRISMA_PG_DIRECT === "1") {
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
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

function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;
  const created = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = created;
  } else {
    productionClient = created;
  }
  return created;
}

let productionClient: PrismaClient | undefined;

/**
 * Client inizializzato alla prima query, non all'import del modulo.
 *
 * `next build` valuta i moduli di ogni route nella fase «Collecting page data»
 * senza eseguire query: con l'inizializzazione immediata bastava l'assenza di
 * DATABASE_URL per far fallire il build di una route che importa questo file.
 * Con l'inizializzazione differita l'import è sempre sicuro e l'errore di
 * configurazione resta esplicito, ma arriva alla prima query reale.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = productionClient ?? getPrismaClient();
    // Il receiver è il client, non il proxy: i getter interni di Prisma non
    // devono rientrare da questo handler
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in (productionClient ?? getPrismaClient());
  },
});
