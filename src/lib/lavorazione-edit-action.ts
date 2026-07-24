"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { canViewContract, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeUtilityRaw } from "@/lib/utility-display";

function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Salva modifiche complete dalla scheda lavorazione. */
export async function updateLavorazioneContractAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const session = await requireSession();
    const contractId = String(formData.get("contractId") ?? "");
    if (!contractId) return { ok: false, error: "Contratto mancante" };

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { client: true },
    });
    if (!contract || contract.deletedAt) {
      return { ok: false, error: "Contratto non trovato" };
    }
    if (!canViewContract(session.role, session.id, contract.collaboratorId)) {
      return { ok: false, error: "Permesso negato" };
    }

    const canEditAll = hasPermission(session.role, "contracts.edit_all");
    const canEditOwn =
      hasPermission(session.role, "contracts.edit_own") &&
      session.id === contract.collaboratorId;
    if (!canEditAll && !canEditOwn) {
      return { ok: false, error: "Non puoi modificare questa pratica" };
    }

    const utilityRaw = str(formData.get("utilityType"));
    const utilityType = normalizeUtilityRaw(utilityRaw) ?? utilityRaw;
    const serviceOther = str(formData.get("serviceOther"));
    if (utilityType === "ALTRO" && !serviceOther) {
      return { ok: false, error: "Con servizio Altro è obbligatoria la specifica." };
    }

    const pod = utilityType === "LUCE" ? str(formData.get("pod")) : null;
    const pdr = utilityType === "GAS" ? str(formData.get("pdr")) : null;
    const podPdr = pod || pdr || str(formData.get("podPdr"));

    const before = {
      utilityType: contract.utilityType,
      pod: contract.pod,
      pdr: contract.pdr,
      productName: contract.productName,
      notes: contract.notes,
    };

    await prisma.contract.update({
      where: { id: contractId },
      data: {
        utilityType,
        serviceOther: utilityType === "ALTRO" ? serviceOther : null,
        operationType: str(formData.get("operationType")),
        operationOther: str(formData.get("operationOther")),
        pod,
        pdr,
        podPdr,
        productName: str(formData.get("productName")),
        offerCode: str(formData.get("offerCode")),
        contractKind: str(formData.get("contractKind")),
        priceType: str(formData.get("priceType")),
        pricePerKwh: num(formData.get("pricePerKwh")),
        pricePerSmc: num(formData.get("pricePerSmc")),
        pcv: num(formData.get("pcv")),
        spread: num(formData.get("spread")),
        monthlyFee: num(formData.get("monthlyFee")),
        powerKw: num(formData.get("powerKw")),
        annualKwh: num(formData.get("annualKwh")),
        annualSmc: num(formData.get("annualSmc")),
        paymentMethod: str(formData.get("paymentMethod")),
        contractIban: str(formData.get("contractIban")),
        ibanHolder: str(formData.get("ibanHolder")),
        supplyStreet: str(formData.get("supplyStreet")),
        supplyStreetNumber: str(formData.get("supplyStreetNumber")),
        supplyZipCode: str(formData.get("supplyZipCode")),
        supplyCity: str(formData.get("supplyCity")),
        supplyProvince: str(formData.get("supplyProvince")),
        supplyRegion: str(formData.get("supplyRegion")),
        notes: str(formData.get("notes")),
        masterNotes: str(formData.get("masterNotes")),
        workNotes: str(formData.get("workNotes")),
        durationMonths: num(formData.get("durationMonths")) ?? contract.durationMonths,
      },
    });

    // Aggiorna anagrafica cliente (campi base) se admin o collaboratore proprietario
    await prisma.client.update({
      where: { id: contract.clientId },
      data: {
        firstName: str(formData.get("clientFirstName")),
        lastName: str(formData.get("clientLastName")),
        companyName: str(formData.get("clientCompanyName")),
        fiscalCode: str(formData.get("clientFiscalCode")),
        vatNumber: str(formData.get("clientVatNumber")),
        phone: str(formData.get("clientPhone")),
        email: str(formData.get("clientEmail")),
        pec: str(formData.get("clientPec")),
        iban: str(formData.get("clientIban")),
        street: str(formData.get("clientStreet")),
        streetNumber: str(formData.get("clientStreetNumber")),
        zipCode: str(formData.get("clientZipCode")),
        city: str(formData.get("clientCity")),
        province: str(formData.get("clientProvince")),
        region: str(formData.get("clientRegion")),
      },
    });

    await prisma.contractStatusHistory.create({
      data: {
        contractId,
        fromStatus: contract.status,
        toStatus: contract.status,
        changedById: session.id,
        note: "Salva cambiamenti scheda lavorazione",
        changeReason: "EDIT_LAVORAZIONE",
      },
    });

    await writeAuditLog({
      userId: session.id,
      action: "UPDATE",
      entity: "Contract",
      entityId: contractId,
      details: { before, source: "lavorazione_sheet" },
    });

    revalidatePath(`/lavorazione/${contractId}`);
    revalidatePath("/lavorazione");
    revalidatePath("/attesa-pagamento");
    revalidatePath(`/contratti/${contractId}`);
    revalidatePath(`/clienti/${contract.clientId}`);
    revalidatePath("/");

    return { ok: true, message: "Modifiche salvate." };
  } catch (e) {
    console.error("[updateLavorazioneContractAction]", e);
    const msg = e instanceof Error ? e.message : "Salvataggio non riuscito";
    return {
      ok: false,
      error: msg.includes("HTTP mode")
        ? "Errore database. Riprova tra qualche secondo."
        : msg.slice(0, 200),
    };
  }
}
