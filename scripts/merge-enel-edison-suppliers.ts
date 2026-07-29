/**
 * Unisce Enel* → Enel e Edison* → Edison.
 *   npx tsx scripts/merge-enel-edison-suppliers.ts
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.includes("user:password@host")) {
  throw new Error("DATABASE_URL non configurata");
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

function canonicalSupplierName(raw: string): string {
  const n = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!n) return n;
  const key = n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (
    key === "enel" ||
    key.startsWith("enel ") ||
    key.startsWith("enelenergia") ||
    key.startsWith("enelbox")
  ) {
    return "Enel";
  }
  if (
    key === "edison" ||
    key.startsWith("edison ") ||
    key.startsWith("edisonenergia")
  ) {
    return "Edison";
  }
  return n;
}

async function main() {
  const all = await prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
      stornoMonths: true,
      _count: { select: { contracts: true, commissionRules: true } },
    },
  });

  const byCanon = new Map<string, typeof all>();
  for (const s of all) {
    const canon = canonicalSupplierName(s.name);
    if (canon !== "Enel" && canon !== "Edison") continue;
    const list = byCanon.get(canon) ?? [];
    list.push(s);
    byCanon.set(canon, list);
  }

  for (const [canonical, list] of byCanon) {
    console.log(`\n=== ${canonical} (${list.length} record) ===`);
    for (const s of list) {
      console.log(
        `  ${s.name} | contracts=${s._count.contracts} rules=${s._count.commissionRules} active=${s.active}`,
      );
    }

    if (list.length === 0) continue;

    if (list.length === 1) {
      const only = list[0]!;
      if (only.name !== canonical) {
        await prisma.supplier.update({
          where: { id: only.id },
          data: { name: canonical, active: true },
        });
        console.log(`  → rinominato in ${canonical}`);
      }
      continue;
    }

    list.sort((a, b) => {
      const exactA = a.name === canonical ? 1 : 0;
      const exactB = b.name === canonical ? 1 : 0;
      if (exactB !== exactA) return exactB - exactA;
      if (b._count.contracts !== a._count.contracts) {
        return b._count.contracts - a._count.contracts;
      }
      return b._count.commissionRules - a._count.commissionRules;
    });

    const keep = list[0]!;
    const others = list.slice(1);
    console.log(`  KEEP: ${keep.name} (${keep.id})`);

    for (const other of others) {
      const c = await prisma.contract.updateMany({
        where: { supplierId: other.id },
        data: { supplierId: keep.id },
      });
      const r = await prisma.commissionRule.updateMany({
        where: { supplierId: other.id },
        data: { supplierId: keep.id },
      });
      await prisma.service.updateMany({
        where: { supplierId: other.id },
        data: { supplierId: keep.id },
      });
      await prisma.supplier.update({
        where: { id: other.id },
        data: {
          active: false,
          name: `_archivio_${canonical.toLowerCase()}_${other.id.slice(-6)}`,
          code: `${other.code}_MERGED_${Date.now()}`.slice(0, 60),
        },
      });
      console.log(
        `  merged ${other.name}: contracts=${c.count} rules=${r.count}`,
      );
    }

    await prisma.supplier.update({
      where: { id: keep.id },
      data: {
        name: canonical,
        active: true,
        ...(keep.stornoMonths == null
          ? {
              stornoMonths:
                others.find((o) => o.stornoMonths != null)?.stornoMonths ??
                undefined,
            }
          : {}),
      },
    });
    console.log(`  → nome finale: ${canonical}`);
  }

  const left = await prisma.supplier.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: "enel", mode: "insensitive" } },
        { name: { contains: "edison", mode: "insensitive" } },
      ],
    },
    select: { name: true, _count: { select: { contracts: true } } },
    orderBy: { name: "asc" },
  });
  console.log("\nAttivi Enel/Edison dopo merge:");
  for (const s of left) {
    console.log(`  ${s.name} (${s._count.contracts})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
