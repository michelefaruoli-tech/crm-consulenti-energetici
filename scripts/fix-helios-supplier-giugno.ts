import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { clientDisplayName } from "../src/lib/utils";

const PODS = [
  "IT001E71921483",
  "IT001E89314477",
  "IT001E89235936",
  "IT001E65720310",
  "IT001E89292022",
  "IT001E76562047",
  "IT001E89761624",
  "IT001E11522518",
  "IT001E74735660",
  "IT001E11522504",
  "IT001E12611913",
  "IT001E72251161",
  "IT001E45731948",
  "IT001E13441025",
];

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL!, {
    arrayMode: false,
    fullResults: true,
  }),
});

async function main() {
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
  });
  for (const pod of PODS) {
    const rows = await prisma.contract.findMany({
      where: { deletedAt: null, OR: [{ podPdr: pod }, { pod }] },
      select: {
        id: true,
        supplier: { select: { name: true } },
        client: {
          select: { firstName: true, lastName: true, companyName: true, type: true },
        },
        recurringMonths: { where: { period: "2026-06" } },
      },
    });
    for (const r of rows) {
      const ok = r.supplier.name.toLowerCase() === "helios";
      console.log(
        ok ? "✓" : "✗",
        pod,
        clientDisplayName(r.client),
        r.supplier.name,
        r.recurringMonths[0]?.status ?? "—",
      );
      if (!ok && helios) {
        await prisma.contract.update({
          where: { id: r.id },
          data: { supplierId: helios.id, recurrence: "Ricorrente" },
        });
        console.log("  → spostato su Helios");
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
