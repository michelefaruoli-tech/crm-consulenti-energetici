/**
 * Snapshot di una versione funzionante:
 * - dump JSON dati CRM in backups/
 * - elenco versioni in backups/INDEX.md
 *
 * Uso: npm run snapshot -- "descrizione breve"
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL mancante");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

async function main() {
  const note = process.argv.slice(2).join(" ") || "snapshot";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });

  let gitHash = "unknown";
  try {
    gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  const [users, clients, contracts, commissions, suppliers] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true },
    }),
    prisma.client.findMany(),
    prisma.contract.findMany(),
    prisma.commission.findMany({ include: { entries: true } }),
    prisma.supplier.findMany({ include: { services: true, commissionRules: true } }),
  ]);

  const payload = {
    createdAt: new Date().toISOString(),
    gitHash,
    note,
    counts: {
      users: users.length,
      clients: clients.length,
      contracts: contracts.length,
      commissions: commissions.length,
      suppliers: suppliers.length,
    },
    users,
    clients,
    contracts,
    commissions,
    suppliers,
  };

  const filename = `working-${stamp}-${gitHash}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  const indexPath = path.join(dir, "INDEX.md");
  const line = `- \`${filename}\` — ${payload.createdAt} — git ${gitHash} — ${note} (${payload.counts.contracts} contratti)\n`;
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# Backup versioni funzionanti\n\nPer ripartire da una versione: tieni il file JSON e il tag git corrispondente.\n\n${line}`,
      "utf8",
    );
  } else {
    fs.appendFileSync(indexPath, line, "utf8");
  }

  console.log(`OK snapshot → ${filePath}`);
  console.log(`contratti: ${payload.counts.contracts}, git: ${gitHash}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
