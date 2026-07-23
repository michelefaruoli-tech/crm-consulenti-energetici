import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { PrismaClient } from "../src/generated/prisma/client";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.includes("user:password@host")) {
  throw new Error(
    "Imposta DATABASE_URL con la connection string reale di Neon (vedi DEPLOY.md).",
  );
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await bcrypt.hash("Admin123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@crm.local" },
    update: {},
    create: {
      email: "admin@crm.local",
      password,
      name: "Amministratore",
      role: "ADMIN",
    },
  });

  const segreteria = await prisma.user.upsert({
    where: { email: "segreteria@crm.local" },
    update: {},
    create: {
      email: "segreteria@crm.local",
      password: await bcrypt.hash("Segreteria123!", 10),
      name: "Maria Rossi",
      role: "SEGRETERIA",
    },
  });

  const collaboratore = await prisma.user.upsert({
    where: { email: "collaboratore@crm.local" },
    update: {},
    create: {
      email: "collaboratore@crm.local",
      password: await bcrypt.hash("Collab123!", 10),
      name: "Luca Bianchi",
      role: "COLLABORATORE",
    },
  });

  const commerciale = await prisma.user.upsert({
    where: { email: "commerciale@crm.local" },
    update: {},
    create: {
      email: "commerciale@crm.local",
      password: await bcrypt.hash("Comm123!", 10),
      name: "Giulia Verdi",
      role: "COMMERCIALE",
    },
  });

  const enel = await prisma.supplier.upsert({
    where: { code: "ENEL" },
    update: {},
    create: {
      name: "Enel Energia",
      code: "ENEL",
      email: "partner@enel.it",
    },
  });

  const edison = await prisma.supplier.upsert({
    where: { code: "EDISON" },
    update: {},
    create: {
      name: "Edison Energia",
      code: "EDISON",
      email: "partner@edison.it",
    },
  });

  const luceEnel = await prisma.service.upsert({
    where: { id: "seed-luce-enel" },
    update: {},
    create: {
      id: "seed-luce-enel",
      name: "Luce domestica",
      supplierId: enel.id,
    },
  });

  const gasEnel = await prisma.service.upsert({
    where: { id: "seed-gas-enel" },
    update: {},
    create: {
      id: "seed-gas-enel",
      name: "Gas domestico",
      supplierId: enel.id,
    },
  });

  const luceEdison = await prisma.service.upsert({
    where: { id: "seed-luce-edison" },
    update: {},
    create: {
      id: "seed-luce-edison",
      name: "Luce business",
      supplierId: edison.id,
    },
  });

  const ruleEnelLuce = await prisma.commissionRule.upsert({
    where: { id: "seed-rule-enel-luce" },
    update: {},
    create: {
      id: "seed-rule-enel-luce",
      supplierId: enel.id,
      serviceId: luceEnel.id,
      name: "Provvigione luce Enel",
      paymentType: "UNA_TANTUM",
      fixedAmount: 85,
    },
  });

  await prisma.commissionRule.upsert({
    where: { id: "seed-rule-enel-gas" },
    update: {},
    create: {
      id: "seed-rule-enel-gas",
      supplierId: enel.id,
      serviceId: gasEnel.id,
      name: "Provvigione gas Enel",
      paymentType: "UNA_TANTUM",
      fixedAmount: 65,
    },
  });

  const ruleEdison = await prisma.commissionRule.upsert({
    where: { id: "seed-rule-edison" },
    update: {},
    create: {
      id: "seed-rule-edison",
      supplierId: edison.id,
      serviceId: luceEdison.id,
      name: "Provvigione luce Edison",
      paymentType: "RATEIZZATO",
      fixedAmount: 120,
      installments: 3,
    },
  });

  const existingClients = await prisma.client.count();
  if (existingClients === 0) {
    const client1 = await prisma.client.create({
      data: {
        type: "PRIVATO",
        firstName: "Marco",
        lastName: "Ferrari",
        fiscalCode: "FRRMRC85M01H501Z",
        email: "marco.ferrari@email.it",
        phone: "+39 333 1234567",
        address: "Via Roma 10",
        city: "Milano",
        province: "MI",
        zipCode: "20121",
        createdById: collaboratore.id,
      },
    });

    const client2 = await prisma.client.create({
      data: {
        type: "AZIENDA",
        companyName: "Bar Centrale Srl",
        vatNumber: "12345678901",
        fiscalCode: "12345678901",
        email: "info@barcentrale.it",
        phone: "+39 02 9876543",
        address: "Corso Garibaldi 45",
        city: "Milano",
        province: "MI",
        zipCode: "20121",
        createdById: commerciale.id,
      },
    });

    const contract1 = await prisma.contract.create({
      data: {
        contractNumber: "CTR-2026-10001",
        clientId: client1.id,
        collaboratorId: collaboratore.id,
        supplierId: enel.id,
        serviceId: luceEnel.id,
        commissionRuleId: ruleEnelLuce.id,
        status: "ATTIVATO",
        activationDate: new Date("2026-01-15"),
        expiryDate: new Date("2027-01-15"),
      },
    });

    await prisma.contractStatusHistory.create({
      data: {
        contractId: contract1.id,
        fromStatus: "BOZZA",
        toStatus: "ATTIVATO",
        changedById: segreteria.id,
      },
    });

    await prisma.commission.create({
      data: {
        contractId: contract1.id,
        expected: 85,
        accrued: 85,
        received: 0,
        paid: 0,
      },
    });

    const contract2 = await prisma.contract.create({
      data: {
        contractNumber: "CTR-2026-10002",
        clientId: client2.id,
        collaboratorId: commerciale.id,
        supplierId: edison.id,
        serviceId: luceEdison.id,
        commissionRuleId: ruleEdison.id,
        status: "IN_LAVORAZIONE",
      },
    });

    await prisma.contractStatusHistory.create({
      data: {
        contractId: contract2.id,
        toStatus: "IN_LAVORAZIONE",
        changedById: segreteria.id,
      },
    });

    await prisma.commission.create({
      data: {
        contractId: contract2.id,
        expected: 120,
      },
    });
  }

  console.log("Seed completato (Neon/PostgreSQL).");
  console.log("Utenti demo:");
  console.log("  admin@crm.local / Admin123!");
  console.log("  segreteria@crm.local / Segreteria123!");
  console.log("  collaboratore@crm.local / Collab123!");
  console.log("  commerciale@crm.local / Comm123!");
  console.log(`Admin ID: ${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
