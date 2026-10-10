import "server-only";

/**
 * Crea Client + Contract + Commission minimi per una riga Compara
 * «Senza corrispondenza» che Michele ha selezionato e compilato.
 */

import { prisma } from "@/lib/prisma";
import { generateContractNumber } from "@/lib/contract-number";
import { recurrenceWriteData } from "@/lib/recurring";
import { normalizePodKey } from "@/lib/storno-status";

function splitNominativo(nominativo: string): {
  firstName: string;
  lastName: string;
} {
  const parts = nominativo.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Cliente", lastName: "Compara" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "-" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]!,
  };
}

async function resolveSupplierId(supplierHint: string): Promise<string> {
  const hint = supplierHint.trim() || "Compara";
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: hint, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const fuzzy = await prisma.supplier.findFirst({
    where: { name: { contains: hint.split(/\s+/)[0] || hint, mode: "insensitive" } },
    select: { id: true },
  });
  if (fuzzy) return fuzzy.id;
  const codeBase = hint
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 20) || "COMPARA";
  const code = `${codeBase}_${Date.now().toString(36).slice(-4)}`;
  const created = await prisma.supplier.create({
    data: { name: hint, code, active: true },
    select: { id: true },
  });
  return created.id;
}

export async function createComparaStubContract(params: {
  nominativo: string;
  supplierHint: string;
  collaboratorId: string;
  createdById: string;
  podRaw: string;
  amount: number;
  competencePeriod: string;
  note: string;
}): Promise<{ contractId: string; contractNumber: string }> {
  const { firstName, lastName } = splitNominativo(params.nominativo);
  const supplierId = await resolveSupplierId(params.supplierHint);
  const collab = await prisma.user.findUnique({
    where: { id: params.collaboratorId },
    select: { id: true, active: true },
  });
  if (!collab || !collab.active) {
    throw new Error("Collaboratore non valido");
  }

  const client = await prisma.client.create({
    data: {
      type: "PRIVATO",
      firstName,
      lastName,
      createdById: params.createdById,
      notes: `Creato da import Compara · ${params.note}`.slice(0, 500),
    },
    select: { id: true },
  });

  const podRaw = params.podRaw.trim();
  const looksLikePod = /^IT/i.test(podRaw);
  const podKey = podRaw ? normalizePodKey(podRaw) : "";
  const contractNumber = await generateContractNumber();
  const [y, m] = params.competencePeriod.split("-").map(Number);
  const insertionDate = new Date(y ?? 2026, (m ?? 1) - 1, 1);

  // Neon HTTP: niente nested create (Prisma apre $transaction).
  const contract = await prisma.contract.create({
    data: {
      contractNumber,
      clientId: client.id,
      supplierId,
      collaboratorId: params.collaboratorId,
      createdById: params.createdById,
      status: "ATTIVATO",
      insertionDate,
      utilityType: looksLikePod ? "LUCE" : podRaw ? "GAS" : null,
      pod: looksLikePod ? podRaw : null,
      pdr: !looksLikePod && podRaw ? podRaw : null,
      podPdr: podRaw || null,
      productName: `Compara ${params.supplierHint}`.slice(0, 120),
      ...recurrenceWriteData("UT"),
    },
    select: { id: true, contractNumber: true },
  });

  await prisma.commission.create({
    data: {
      contractId: contract.id,
      expected: params.amount,
      accrued: 0,
      received: 0,
      paid: 0,
    },
  });

  void podKey;
  return { contractId: contract.id, contractNumber: contract.contractNumber };
}
