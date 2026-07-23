import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const where = {};
  const recent = await prisma.contract.findMany({
    where,
    include: { client: true, supplier: true, collaborator: true },
    orderBy: { insertionDate: "desc" },
    take: 50,
  });
  console.log("recent", recent.length);

  const lav = await prisma.contract.findMany({
    where: {
      ...where,
      OR: [
        { status: "IN_LAVORAZIONE" },
        { workStatus: { contains: "lavorare", mode: "insensitive" } },
        { toWork: true },
      ],
    },
    take: 10,
    include: { client: true, collaborator: true, supplier: true },
  });
  console.log("lav", lav.length);

  const agg = await prisma.commission.aggregate({
    _sum: { expected: true, received: true, paid: true, accrued: true },
  });
  console.log("agg", agg);

  console.log("OK");
}

main()
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
