/**
 * Unifica i due account «Michele» in produzione.
 *
 * Keep: Master michele.faruoli@gmail.com (più contratti).
 * Merge: admin@fmconsulenzautenze.it → riassegna contratti/payout, poi soft-delete.
 * Nominativo keep: «Michele Faruoli».
 *
 * Uso:
 *   npx tsx scripts/merge-duplicate-michele.ts           # dry-run
 *   npx tsx scripts/merge-duplicate-michele.ts --apply   # applica
 */
import { prisma } from "../src/lib/prisma";

const MASTER_EMAIL = "michele.faruoli@gmail.com";
const DUP_EMAIL = "admin@fmconsulenzautenze.it";
const KEEP_NAME = "Michele Faruoli";

const apply = process.argv.includes("--apply");

async function main() {
  const keep = await prisma.user.findUnique({
    where: { email: MASTER_EMAIL },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  const dup = await prisma.user.findUnique({
    where: { email: DUP_EMAIL },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!keep) throw new Error(`Keep non trovato: ${MASTER_EMAIL}`);
  if (!dup) {
    console.log("Duplicato già assente — niente da fare.");
    if (keep.name !== KEEP_NAME && apply) {
      await prisma.user.update({
        where: { id: keep.id },
        data: { name: KEEP_NAME },
      });
      console.log(`Rinominato keep → ${KEEP_NAME}`);
    }
    return;
  }
  if (keep.id === dup.id) throw new Error("Keep e dup coincidono");

  const [contracts, created, clients, payoutRows, payoutAdj, reportItems, scopedAs] =
    await Promise.all([
      prisma.contract.count({ where: { collaboratorId: dup.id } }),
      prisma.contract.count({ where: { createdById: dup.id } }),
      prisma.client.count({ where: { createdById: dup.id } }),
      prisma.payoutRow.count({ where: { collaboratorId: dup.id } }),
      prisma.payoutAdjustment.count({ where: { collaboratorId: dup.id } }),
      prisma.payoutReportItem.count({ where: { collaboratorId: dup.id } }),
      prisma.userCollaboratorScope.count({ where: { collaboratorId: dup.id } }),
    ]);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "APPLY" : "DRY-RUN",
        keep,
        dup,
        willMove: {
          contractsAsCollab: contracts,
          contractsCreated: created,
          clientsCreated: clients,
          payoutRows,
          payoutAdj,
          reportItems,
          scopedAsCollab: scopedAs,
        },
        renameKeepTo: KEEP_NAME,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("\nDry-run ok. Rilancia con --apply per eseguire.");
    return;
  }

  // Neon HTTP: preferire SQL grezzo per updateMany massivi.
  const movedContracts = await prisma.$executeRawUnsafe(
    `UPDATE "Contract" SET "collaboratorId" = $1 WHERE "collaboratorId" = $2`,
    keep.id,
    dup.id,
  );
  const movedCreated = await prisma.$executeRawUnsafe(
    `UPDATE "Contract" SET "createdById" = $1 WHERE "createdById" = $2`,
    keep.id,
    dup.id,
  );
  const movedClients = await prisma.$executeRawUnsafe(
    `UPDATE "Client" SET "createdById" = $1 WHERE "createdById" = $2`,
    keep.id,
    dup.id,
  );
  const movedPayoutRows = await prisma.$executeRawUnsafe(
    `UPDATE "PayoutRow" SET "collaboratorId" = $1 WHERE "collaboratorId" = $2`,
    keep.id,
    dup.id,
  );
  const movedPayoutAdj = await prisma.$executeRawUnsafe(
    `UPDATE "PayoutAdjustment" SET "collaboratorId" = $1 WHERE "collaboratorId" = $2`,
    keep.id,
    dup.id,
  );

  // Report item: unique(reportRunId, collaboratorId) — evita conflitti
  const dupReportItems = await prisma.payoutReportItem.findMany({
    where: { collaboratorId: dup.id },
    select: { id: true, reportRunId: true },
  });
  let reportMoved = 0;
  let reportDropped = 0;
  for (const item of dupReportItems) {
    const clash = await prisma.payoutReportItem.findFirst({
      where: {
        reportRunId: item.reportRunId,
        collaboratorId: keep.id,
      },
      select: { id: true },
    });
    if (clash) {
      await prisma.payoutReportItem.delete({ where: { id: item.id } });
      reportDropped++;
    } else {
      await prisma.payoutReportItem.update({
        where: { id: item.id },
        data: { collaboratorId: keep.id },
      });
      reportMoved++;
    }
  }

  // Scope: se un BO/AM ha già keep, droppa la riga dup; altrimenti riassegna
  const scopes = await prisma.userCollaboratorScope.findMany({
    where: { collaboratorId: dup.id },
  });
  let scopeMoved = 0;
  let scopeDropped = 0;
  for (const s of scopes) {
    const clash = await prisma.userCollaboratorScope.findUnique({
      where: {
        userId_collaboratorId: {
          userId: s.userId,
          collaboratorId: keep.id,
        },
      },
    });
    if (clash) {
      await prisma.userCollaboratorScope.delete({
        where: {
          userId_collaboratorId: {
            userId: s.userId,
            collaboratorId: dup.id,
          },
        },
      });
      scopeDropped++;
    } else {
      await prisma.userCollaboratorScope.update({
        where: {
          userId_collaboratorId: {
            userId: s.userId,
            collaboratorId: dup.id,
          },
        },
        data: { collaboratorId: keep.id },
      });
      scopeMoved++;
    }
  }

  // Soft-delete duplicato (stesso schema di deleteUserAction)
  const now = Date.now();
  await prisma.user.update({
    where: { id: dup.id },
    data: {
      active: false,
      email: `deleted_${now}_${dup.email}`,
      name: `[Eliminato] ${dup.name}`,
    },
  });

  if (keep.name !== KEEP_NAME) {
    await prisma.user.update({
      where: { id: keep.id },
      data: { name: KEEP_NAME },
    });
  }

  const keepContracts = await prisma.contract.count({
    where: { collaboratorId: keep.id },
  });
  const dupLeft = await prisma.contract.count({
    where: { collaboratorId: dup.id },
  });

  console.log(
    JSON.stringify(
      {
        moved: {
          contracts: movedContracts,
          createdBy: movedCreated,
          clients: movedClients,
          payoutRows: movedPayoutRows,
          payoutAdj: movedPayoutAdj,
          reportMoved,
          reportDropped,
          scopeMoved,
          scopeDropped,
        },
        after: {
          keepName: KEEP_NAME,
          keepContracts,
          dupContractsLeft: dupLeft,
          dupActive: false,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
