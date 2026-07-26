import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Dump JSON completo del database (per snapshot «versione funzionante»).
 * Esclude contentBase64 degli allegati (troppo pesante).
 */
export async function buildFullDbJsonDump(note: string): Promise<{
  filename: string;
  buffer: Buffer;
  counts: Record<string, number>;
  gitHash: string;
}> {
  const gitHash =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.GIT_HASH?.slice(0, 7) ||
    "online";

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
      },
    }),
    prisma.contractEmailLog.findMany(),
    prisma.dailyContractReport.findMany(),
    prisma.clientHistory.findMany(),
    prisma.auditLog.findMany({ take: 5000, orderBy: { createdAt: "desc" } }),
    prisma.contractNumberSequence.findMany(),
    prisma.createIdempotency.findMany(),
    prisma.backupLog.findMany({ take: 200, orderBy: { createdAt: "desc" } }),
  ]);

  const counts = {
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
  };

  const payload = {
    createdAt: new Date().toISOString(),
    gitHash,
    note,
    version: 2,
    counts,
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

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `full-db-${stamp}-${gitHash}.json`;
  const buffer = Buffer.from(JSON.stringify(payload), "utf8");

  return { filename, buffer, counts, gitHash };
}
