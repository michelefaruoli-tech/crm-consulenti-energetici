import { prisma } from "@/lib/prisma";
import {
  heliosMonthlyCommission,
  HELIOS_MONTHLY_ALTRO,
  HELIOS_MONTHLY_RESIDENTE,
  isHeliosSupplier,
} from "@/lib/helios-contract-rules";
import { isRecurringMonthly, recurrenceWriteData } from "@/lib/recurring";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";

export type AlignHeliosContractResult = {
  contractId: string;
  updated: boolean;
  expected: number;
  synced: boolean;
};

/** Allinea ricorrenza M, gettone 4/6€ e rate mensili per un contratto Helios. */
export async function alignHeliosContractIfNeeded(
  contractId: string,
): Promise<AlignHeliosContractResult | null> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      status: true,
      recurrence: true,
      recurrenceKind: true,
      supplyClassification: true,
      isHistorical: true,
      deletedAt: true,
      supplier: { select: { name: true } },
      client: { select: { type: true, classification: true } },
      commission: { select: { id: true, expected: true } },
    },
  });
  if (!contract || contract.deletedAt || contract.isHistorical) return null;
  if (!isHeliosSupplier(contract.supplier?.name)) return null;

  const classification =
    contract.supplyClassification || contract.client.classification;
  const expected = heliosMonthlyCommission({
    clientType: contract.client.type,
    classification,
  });
  const recurrenceData = recurrenceWriteData("M");

  const needsRecurrence =
    contract.recurrenceKind !== "M" ||
    !isRecurringMonthly(contract.recurrence);
  const currentExpected = Number(contract.commission?.expected ?? 0);
  const needsCommission =
    !contract.commission || Math.abs(currentExpected - expected) > 0.009;

  let updated = false;

  if (needsRecurrence) {
    await prisma.contract.update({
      where: { id: contractId },
      data: recurrenceData,
    });
    updated = true;
  }

  if (contract.commission?.id) {
    if (needsCommission) {
      await prisma.commission.update({
        where: { id: contract.commission.id },
        data: { expected },
      });
      updated = true;
    }
  } else {
    await prisma.commission.create({
      data: { contractId, expected },
    });
    updated = true;
  }

  let synced = false;
  if (contract.status !== "BOZZA") {
    await syncRecurringMonthsForContract(contractId);
    synced = true;
  }

  return { contractId, updated, expected, synced };
}

export type AlignAllHeliosResult = {
  checked: number;
  aligned: number;
  synced: number;
  listinoRules: number;
};

/** Allinea tutti i contratti Helios attivi + regole listino fornitore. */
export async function alignAllHeliosContracts(): Promise<AlignAllHeliosResult> {
  const helios = await prisma.supplier.findFirst({
    where: { name: { equals: "Helios", mode: "insensitive" } },
    select: { id: true },
  });
  if (!helios) {
    return { checked: 0, aligned: 0, synced: 0, listinoRules: 0 };
  }

  const listinoRules = await alignHeliosListinoRules(helios.id);

  const contracts = await prisma.contract.findMany({
    where: {
      supplierId: helios.id,
      deletedAt: null,
      isHistorical: false,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let aligned = 0;
  let synced = 0;
  for (const row of contracts) {
    const res = await alignHeliosContractIfNeeded(row.id);
    if (!res) continue;
    if (res.updated) aligned++;
    if (res.synced) synced++;
  }

  return {
    checked: contracts.length,
    aligned,
    synced,
    listinoRules,
  };
}

/** Imposta listino Helios: MENSILE, 4€ residente / 6€ business. */
export async function alignHeliosListinoRules(supplierId: string): Promise<number> {
  const rules = await prisma.commissionRule.findMany({
    where: { supplierId, active: true },
    select: { id: true, name: true, clientSegment: true },
  });

  let touched = 0;
  for (const rule of rules) {
    const segment = `${rule.clientSegment ?? ""} ${rule.name ?? ""}`.toLowerCase();
    const isResidente =
      /residente|privato|domestico/.test(segment) &&
      !/non\s*residente|business|azienda|condominio|altri|pa/.test(segment);
    const want = isResidente ? HELIOS_MONTHLY_RESIDENTE : HELIOS_MONTHLY_ALTRO;
    await prisma.commissionRule.update({
      where: { id: rule.id },
      data: {
        paymentType: "MENSILE",
        gettoneMensile: want,
        fixedAmount: want,
      },
    });
    touched++;
  }
  return touched;
}
