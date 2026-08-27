/**
 * Corregge contratti DUAL salvati come unico record: crea il contratto GAS mancante.
 * Uso: npx tsx scripts/fix-dual-contract.ts "Angela Finelli"
 */
import "dotenv/config";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

function normalizeDatabaseUrl(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

const dbUrl = process.env.DATABASE_URL
  ? normalizeDatabaseUrl(process.env.DATABASE_URL)
  : "";
if (!dbUrl) {
  console.error("DATABASE_URL mancante");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(dbUrl, {
    arrayMode: false,
    fullResults: true,
  }),
});

const searchName = process.argv[2] ?? "Angela Finelli";
const parts = searchName.trim().split(/\s+/);
const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
const firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

async function nextContractNumber(): Promise<string> {
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

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        {
          AND: [
            { firstName: { contains: firstName, mode: "insensitive" } },
            { lastName: { contains: lastName, mode: "insensitive" } },
          ],
        },
        { lastName: { contains: searchName, mode: "insensitive" } },
        { companyName: { contains: searchName, mode: "insensitive" } },
      ],
    },
    include: {
      contracts: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!clients.length) {
    console.log("Cliente non trovato:", searchName);
    return;
  }

  for (const client of clients) {
    console.log(
      `\nCliente: ${client.firstName ?? ""} ${client.lastName ?? ""} ${client.companyName ?? ""} (${client.id})`,
    );
    for (const c of client.contracts) {
      console.log(
        `  - ${c.contractNumber} ${c.utilityType} POD=${c.pod ?? "-"} PDR=${c.pdr ?? "-"} ${c.createdAt.toISOString()}`,
      );
    }

    const dual = client.contracts.find(
      (c) => norm(c.utilityType) === "DUAL" && c.pod?.trim() && c.pdr?.trim(),
    );

    const luceOnly = client.contracts.find(
      (c) =>
        norm(c.utilityType) === "LUCE" &&
        c.pod?.trim() &&
        !client.contracts.some(
          (g) =>
            g.id !== c.id &&
            norm(g.utilityType) === "GAS" &&
            Math.abs(g.createdAt.getTime() - c.createdAt.getTime()) < 3600_000,
        ),
    );

    let source = dual;
    let pdrForGas = dual?.pdr?.trim() ?? "";

    if (!source && luceOnly) {
      const pdrFromSibling = clients
        .flatMap((cl) => cl.contracts)
        .find(
          (c) =>
            norm(c.utilityType) === "GAS" &&
            (c.pdr?.trim() || c.pod?.trim()) &&
            (c.pdr?.trim()?.length === 14 || c.pod?.trim()?.length === 14),
        );
      pdrForGas =
        pdrFromSibling?.pdr?.trim() ||
        pdrFromSibling?.pod?.trim() ||
        "";
      if (pdrForGas && luceOnly) {
        source = { ...luceOnly, pdr: pdrForGas };
        console.log("  Trovato LUCE senza GAS gemello, PDR da anagrafica collegata.");
      }
    }

    if (!source || !source.pod?.trim() || !pdrForGas) {
      console.log("  Nessun contratto DUAL / LUCE incompleto da correggere.");
      continue;
    }

    const hasGasSibling = client.contracts.some(
      (c) =>
        c.id !== source!.id &&
        norm(c.utilityType) === "GAS" &&
        c.pdr?.trim() === pdrForGas &&
        Math.abs(c.createdAt.getTime() - source!.createdAt.getTime()) < 3600_000,
    );
    if (hasGasSibling) {
      console.log("  Contratto GAS gemello già presente.");
      continue;
    }

    console.log("  Correggo → LUCE + GAS...");

    if (norm(source.utilityType) === "DUAL") {
      await prisma.contract.update({
        where: { id: source.id },
        data: {
          utilityType: "LUCE",
          pdr: null,
          podPdr: source.pod?.trim() || null,
        },
      });
    }

    const gasNumber = await nextContractNumber();
    const gas = await prisma.contract.create({
      data: {
        contractNumber: gasNumber,
        clientId: client.id,
        supplierId: source.supplierId,
        collaboratorId: source.collaboratorId,
        createdById: source.createdById,
        status: source.status,
        utilityType: "GAS",
        serviceOther: source.serviceOther,
        operationType: source.operationType,
        operationOther: source.operationOther,
        productName: source.productName,
        offerCode: source.offerCode,
        commissionRuleId: source.commissionRuleId,
        contractKind: source.contractKind,
        priceType: source.priceType,
        pod: null,
        pdr: pdrForGas,
        podPdr: pdrForGas,
        powerKw: source.powerKw,
        annualKwh: source.annualKwh,
        annualSmc: source.annualSmc,
        pricePerKwh: source.pricePerKwh,
        pricePerSmc: source.pricePerSmc,
        pcv: source.pcv,
        spread: source.spread,
        monthlyFee: source.monthlyFee,
        oneOffFee: source.oneOffFee,
        discount: source.discount,
        economicNotes: source.economicNotes,
        paymentMethod: source.paymentMethod,
        contractIban: source.contractIban,
        ibanHolder: source.ibanHolder,
        ibanHolderCf: source.ibanHolderCf,
        invoiceEmail: source.invoiceEmail,
        invoiceMode: source.invoiceMode,
        supplyClassification: source.supplyClassification,
        durationMonths: source.durationMonths,
        supplyStartDate: source.supplyStartDate,
        expiryDate: source.expiryDate,
        insertionDate: source.insertionDate,
        addressesMatch: source.addressesMatch,
        supplyStreet: source.supplyStreet,
        supplyStreetNumber: source.supplyStreetNumber,
        supplyZipCode: source.supplyZipCode,
        supplyCity: source.supplyCity,
        supplyProvince: source.supplyProvince,
        supplyRegion: source.supplyRegion,
        supplyAddress: source.supplyAddress,
        supplyCountry: source.supplyCountry,
        sendToMaster: source.sendToMaster,
        assignedToMaster: source.assignedToMaster,
        masterEmail: source.masterEmail,
        emailIdempotencyKey: source.emailIdempotencyKey,
        emailStatus: source.emailStatus,
        toWork: source.toWork,
        notes: source.notes,
        masterNotes: source.masterNotes,
        internalNotes: source.internalNotes,
        technicalJson: source.technicalJson,
        parentContractId: source.id,
      },
    });

    const commission = await prisma.commission.findFirst({
      where: { contractId: source.id },
    });
    if (commission) {
      await prisma.commission.create({
        data: {
          contractId: gas.id,
          expected: commission.expected,
        },
      });
    }

    console.log(`  ✓ LUCE: ${source.contractNumber} | GAS creato: ${gasNumber}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
