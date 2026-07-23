import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaNeonHttp(process.env.DATABASE_URL!, {
  arrayMode: false,
  fullResults: true,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.count();
  const contracts = await prisma.contract.count();
  console.log({ users, contracts, ok: true });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
