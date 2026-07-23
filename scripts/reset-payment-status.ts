import "dotenv/config";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL non configurata. Controlla il file .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

async function main() {
  const result = await prisma.contract.updateMany({
    data: {
      paymentStatus: "Da incassare",
      collectionDate: null,
    },
  });
  console.log(`done — updated ${result.count} contracts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
