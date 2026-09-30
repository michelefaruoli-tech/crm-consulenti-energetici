/**
 * Destinazione «Invio al Back Office» per fornitore.
 * Separata da getLavorazioneNotifyEmails: espone se esiste un BO dedicato
 * (utenti BACKOFFICE in scope o email sul fornitore) oltre al Master admin.
 *
 * Caso Serviren: spesso nessun UserSupplierScope BACKOFFICE → solo MASTER_EMAIL.
 * La pratica deve comunque entrare in IN_LAVORAZIONE + Provvigioni; l’UI avvisa.
 *
 * Destinatari stakeholder (Master + inseritore): vedi
 * `resolveContractStakeholderEmails` — richiesti da Michele Faruoli per
 * invio BO e per esito lavorazione.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { getMasterEmail } from "@/lib/mail";

export type BackofficeDestination = {
  supplierId: string | null;
  supplierName: string | null;
  /** Tutti i destinatari email (admin + BO dedicati + email fornitore). */
  recipients: string[];
  adminEmail: string | null;
  /** Solo BO in scope + email fornitore (senza admin). */
  dedicatedEmails: string[];
  /** true se c’è almeno un destinatario oltre al solo Master admin. */
  hasDedicatedBo: boolean;
  /** Avviso UI quando manca assegnazione BO “classica”. */
  warning: string | null;
};

function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.startsWith("deleted_")) return null;
  return e;
}

function parseSupplierEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.includes("@") && !e.startsWith("deleted_")) out.push(e);
  }
  return out;
}

/**
 * Risolve destinatari e se il fornitore ha un Back Office assegnato.
 * Senza supplierId: solo admin (se configurato), con warning.
 */
export async function resolveBackofficeDestination(
  supplierId: string | null | undefined,
): Promise<BackofficeDestination> {
  const admin = getMasterEmail().trim().toLowerCase() || null;
  const recipients = new Set<string>();
  if (admin) recipients.add(admin);

  if (!supplierId) {
    return {
      supplierId: null,
      supplierName: null,
      recipients: [...recipients],
      adminEmail: admin,
      dedicatedEmails: [],
      hasDedicatedBo: false,
      warning:
        "Fornitore non indicato: la pratica resta In lavorazione e in Provvigioni, ma non c’è Back Office dedicato da notificare (solo Master admin, se configurato).",
    };
  }

  const [users, supplier] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        role: "BACKOFFICE",
        supplierScopes: { some: { supplierId } },
      },
      select: { email: true },
    }),
    prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const dedicated = new Set<string>();
  for (const u of users) {
    const e = u.email.trim().toLowerCase();
    if (e && !e.startsWith("deleted_")) {
      dedicated.add(e);
      recipients.add(e);
    }
  }
  for (const e of parseSupplierEmails(supplier?.email)) {
    dedicated.add(e);
    recipients.add(e);
  }

  const hasDedicatedBo = dedicated.size > 0;
  const name = supplier?.name?.trim() || "questo fornitore";
  const warning = hasDedicatedBo
    ? null
    : `Nessun Back Office assegnato a «${name}» (nessun utente BACKOFFICE in scope né email fornitore). La pratica resta comunque In lavorazione e visibile in coda/Provvigioni; notifica email a Master${admin ? ` (${admin})` : ""} e all’inseritore/collaboratore della pratica.`;

  return {
    supplierId,
    supplierName: supplier?.name ?? null,
    recipients: [...recipients],
    adminEmail: admin,
    dedicatedEmails: [...dedicated],
    hasDedicatedBo,
    warning,
  };
}

/** Messaggio breve per toast / alert post-invio. */
export function formatBackofficeDestinationMessage(
  dest: BackofficeDestination,
  opts?: { emailSent?: boolean; queued?: boolean },
): string {
  const parts: string[] = [];
  if (opts?.queued !== false) {
    parts.push(
      "Pratica in coda In lavorazione (IN_LAVORAZIONE) e inclusa nel percorso Provvigioni.",
    );
  }
  if (dest.warning) {
    parts.push(dest.warning);
  } else if (dest.recipients.length > 0) {
    parts.push(`Destinatari: ${dest.recipients.join(", ")}.`);
  }
  if (opts?.emailSent === false) {
    parts.push(
      "Email non inviata: usa «Reinvia» dalla scheda; lo stato In lavorazione resta attivo.",
    );
  }
  return parts.join(" ");
}

export type ContractStakeholderEmails = {
  /** Sempre MASTER_EMAIL / env se configurata. */
  masterEmail: string | null;
  /**
   * Chi ha inserito: preferisce `createdBy` (AM / altro inseritore),
   * altrimenti il collaboratore assegnato sulla pratica.
   */
  inserterEmail: string | null;
  /** Collaboratore commerciale sulla pratica (può coincidere con inserter). */
  collaboratorEmail: string | null;
  /** Unione deduplicata Master + inseritore (+ collaboratore se diverso). */
  recipients: string[];
};

/**
 * Master + email di chi ha inserito / collaboratore della pratica.
 * Usato all’invio BO e all’esito lavorazione (presa in carico / conclusa / risposta).
 */
export async function resolveContractStakeholderEmails(opts: {
  collaboratorId?: string | null;
  createdById?: string | null;
}): Promise<ContractStakeholderEmails> {
  const masterEmail = normalizeEmail(getMasterEmail());
  const ids = [
    ...new Set(
      [opts.createdById, opts.collaboratorId]
        .filter((id): id is string => Boolean(id?.trim()))
        .map((id) => id.trim()),
    ),
  ];

  const users =
    ids.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: ids }, active: true },
          select: { id: true, email: true },
        })
      : [];
  const byId = new Map(users.map((u) => [u.id, normalizeEmail(u.email)]));

  const createdByEmail = opts.createdById
    ? byId.get(opts.createdById) ?? null
    : null;
  const collaboratorEmail = opts.collaboratorId
    ? byId.get(opts.collaboratorId) ?? null
    : null;
  // Preferisci chi ha creato la pratica; fallback al collaboratore assegnato
  const inserterEmail = createdByEmail ?? collaboratorEmail;

  const recipients = new Set<string>();
  if (masterEmail) recipients.add(masterEmail);
  if (inserterEmail) recipients.add(inserterEmail);
  // Se AM ha inserito per un collaboratore, notifica anche il collaboratore
  if (collaboratorEmail) recipients.add(collaboratorEmail);

  return {
    masterEmail,
    inserterEmail,
    collaboratorEmail,
    recipients: [...recipients],
  };
}

/**
 * Unisce destinatari BO (Master + BO dedicato + email fornitore)
 * con Master + inseritore/collaboratore della pratica.
 */
export async function mergeBackofficeAndStakeholderRecipients(opts: {
  supplierId: string | null | undefined;
  collaboratorId?: string | null;
  createdById?: string | null;
}): Promise<{
  destination: BackofficeDestination;
  stakeholders: ContractStakeholderEmails;
  recipients: string[];
}> {
  const [destination, stakeholders] = await Promise.all([
    resolveBackofficeDestination(opts.supplierId),
    resolveContractStakeholderEmails({
      collaboratorId: opts.collaboratorId,
      createdById: opts.createdById,
    }),
  ]);
  const recipients = [
    ...new Set([...destination.recipients, ...stakeholders.recipients]),
  ];
  return { destination, stakeholders, recipients };
}
