/**
 * Backup completo database + archivio codice CRM (senza node_modules).
 *
 * Uso: npx tsx scripts/full-backup.ts "nota opzionale"
 *
 * Output in backups/:
 * - full-db-*.json  → tutti i dati principali
 * - crm-code-*.zip  → codice sorgente (no node_modules / .next)
 * - aggiorna INDEX.md
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
  throw new Error("DATABASE_URL mancante nel .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

async function main() {
  const note = process.argv.slice(2).join(" ") || "backup completo pre-caricamento";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });

  let gitHash = "unknown";
  try {
    gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  console.log("Dump database in corso…");

  const [
    users,
    clients,
    suppliers,
    services,
    commissionRules,
    contracts,
    commissions,
    commissionEntries,
    recurringMonths,
    statusHistory,
    documents,
    emailLogs,
    dailyReports,
    clientHistory,
    auditLogs,
    contractNumberSequence,
    createIdempotency,
    backupLogs,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.client.findMany(),
    prisma.supplier.findMany(),
    prisma.service.findMany(),
    prisma.commissionRule.findMany(),
    prisma.contract.findMany(),
    prisma.commission.findMany(),
    prisma.commissionEntry.findMany(),
    prisma.recurringMonth.findMany(),
    prisma.contractStatusHistory.findMany(),
    // Allegati: metadati sì, contenuto base64 no (file troppo grandi)
    prisma.document.findMany({
      select: {
        id: true,
        clientId: true,
        contractId: true,
        filename: true,
        mimeType: true,
        size: true,
        path: true,
        docType: true,
        storageProvider: true,
        uploadedById: true,
        uploadedAt: true,
        contentClearedAt: true,
        contentClearedReason: true,
        deletedAt: true,
        // contentBase64 escluso di proposito (troppo grande)
      },
    }),
    prisma.contractEmailLog.findMany(),
    prisma.dailyContractReport.findMany(),
    prisma.clientHistory.findMany(),
    prisma.auditLog.findMany({ take: 5000, orderBy: { createdAt: "desc" } }),
    prisma.contractNumberSequence.findMany(),
    prisma.createIdempotency.findMany(),
    prisma.backupLog.findMany(),
  ]);

  // Rimuovi password hash dal dump utenti? Per restore serve — le teniamo,
  // ma avvisiamo. File locale in backups/ (già in .gitignore per *.json).

  const payload = {
    createdAt: new Date().toISOString(),
    gitHash,
    note,
    version: 2,
    counts: {
      users: users.length,
      clients: clients.length,
      suppliers: suppliers.length,
      services: services.length,
      commissionRules: commissionRules.length,
      contracts: contracts.length,
      commissions: commissions.length,
      commissionEntries: commissionEntries.length,
      recurringMonths: recurringMonths.length,
      statusHistory: statusHistory.length,
      documentsMeta: documents.length,
      emailLogs: emailLogs.length,
      dailyReports: dailyReports.length,
      clientHistory: clientHistory.length,
      auditLogs: auditLogs.length,
    },
    noteDocuments:
      "I Document hanno solo metadati (no contentBase64). Gli allegati restano sul DB Neon.",
    users,
    clients,
    suppliers,
    services,
    commissionRules,
    contracts,
    commissions,
    commissionEntries,
    recurringMonths,
    statusHistory,
    documents,
    emailLogs,
    dailyReports,
    clientHistory,
    auditLogs,
    contractNumberSequence,
    createIdempotency,
    backupLogs,
  };

  const dbName = `full-db-${stamp}-${gitHash}.json`;
  const dbPath = path.join(dir, dbName);
  fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2), "utf8");
  const dbMb = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);
  console.log(`OK DB → ${dbPath} (${dbMb} MB)`);
  console.log("Conteggi:", payload.counts);

  // Zip codice (escluse cartelle pesanti)
  const zipName = `crm-code-${stamp}-${gitHash}.zip`;
  const zipPath = path.join(dir, zipName);
  console.log("Zip codice CRM…");

  // Preferisci tar (Windows 10+); fallback Compress-Archive
  const exclude = [
    "node_modules",
    ".next",
    "backups",
    ".git",
    "*.log",
    ".env",
    ".env.local",
  ];
  try {
    // tar su Windows: --exclude=pattern
    const excludes = exclude.map((e) => `--exclude=${e}`).join(" ");
    execSync(`tar -a -c -f "${zipPath}" ${excludes} .`, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    });
  } catch {
    console.warn("tar fallito, provo Compress-Archive (più lento)…");
    const staging = path.join(dir, `_staging-${stamp}`);
    fs.mkdirSync(staging, { recursive: true });
    // Copia selettiva minimale
    for (const item of ["src", "prisma", "scripts", "public", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "AGENTS.md", "DEPLOY.md", "README.md"]) {
      const from = path.join(process.cwd(), item);
      if (!fs.existsSync(from)) continue;
      const to = path.join(staging, item);
      fs.cpSync(from, to, { recursive: true });
    }
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${zipPath}' -Force"`,
      { stdio: "inherit" },
    );
    fs.rmSync(staging, { recursive: true, force: true });
  }

  const zipMb = fs.existsSync(zipPath)
    ? (fs.statSync(zipPath).size / (1024 * 1024)).toFixed(2)
    : "?";
  console.log(`OK codice → ${zipPath} (${zipMb} MB)`);

  // Manifest leggibile
  const manifestName = `MANIFEST-${stamp}.md`;
  const manifestPath = path.join(dir, manifestName);
  fs.writeFileSync(
    manifestPath,
    `# Backup ${stamp}

- **Quando:** ${payload.createdAt}
- **Git:** ${gitHash}
- **Nota:** ${note}

## File
- Database (JSON): \`${dbName}\` (${dbMb} MB)
- Codice CRM (ZIP): \`${zipName}\` (${zipMb} MB)

## Conteggi DB
${Object.entries(payload.counts)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

## Cosa manca / limiti
- Allegati Document: solo metadati (il contenuto resta su Neon).
- \`.env\` escluso dallo zip (contiene segreti).
- Per ripristino DB: serve script dedicato o re-import selettivo.

## Prossimo lavoro (report fornitori)
Ogni fornitore invia un Excel diverso → mapping per fornitore →
match contratti (POD/PDR) → assegna gettone + mese pagamento →
export report per liquidare i collaboratori.
`,
    "utf8",
  );

  const indexPath = path.join(dir, "INDEX.md");
  const line = `- \`${dbName}\` + \`${zipName}\` — ${payload.createdAt} — git ${gitHash} — ${note} (${payload.counts.contracts} contratti)\n`;
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# Backup CRM\n\n${line}`,
      "utf8",
    );
  } else {
    fs.appendFileSync(indexPath, line, "utf8");
  }

  try {
    await prisma.backupLog.create({
      data: {
        filename: dbName,
        status: "ok",
        size: fs.statSync(dbPath).size,
      },
    });
  } catch {
    /* non bloccante */
  }

  console.log("\n=== BACKUP COMPLETATO ===");
  console.log(`Cartella: ${dir}`);
  console.log(`1) ${dbName}`);
  console.log(`2) ${zipName}`);
  console.log(`3) ${manifestName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
