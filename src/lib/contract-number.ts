import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Allocazione atomica CTR-YYYY-###### (sicura con più istanze Vercel).
 */
export async function allocateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();

  const rows = await prisma.$queryRaw<Array<{ last: number }>>`
    INSERT INTO "ContractNumberSequence" ("year", "last")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "ContractNumberSequence"."last" + 1
    RETURNING "last"
  `;

  const last = Number(rows[0]?.last ?? 1);
  return `CTR-${year}-${String(last).padStart(6, "0")}`;
}

/** Allinea il contatore all'ultimo numero già presente (una tantum / recovery). */
export async function syncContractNumberSequenceFromExisting(): Promise<void> {
  const year = new Date().getFullYear();
  const prefix = `CTR-${year}-`;
  const latest = await prisma.contract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: "desc" },
    select: { contractNumber: true },
  });
  let max = 0;
  if (latest?.contractNumber) {
    const part = latest.contractNumber.split("-").pop();
    const n = Number(part);
    if (Number.isFinite(n)) max = n;
  }
  await prisma.$executeRaw`
    INSERT INTO "ContractNumberSequence" ("year", "last")
    VALUES (${year}, ${max})
    ON CONFLICT ("year")
    DO UPDATE SET "last" = GREATEST("ContractNumberSequence"."last", EXCLUDED."last")
  `;
}
