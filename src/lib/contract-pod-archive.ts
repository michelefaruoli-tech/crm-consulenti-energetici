import { prisma } from "@/lib/prisma";
import { recurringMonthlyWhereOr } from "@/lib/provvigioni-filters";
import { isRecurringMonthly } from "@/lib/recurring";
import { syncRecurringMonthsForContract } from "@/lib/recurring-sync";
import { normalizePodKey } from "@/lib/storno-status";
import {
  computeSupplyStartDate,
  formatItDate,
  isInFornitura,
} from "@/lib/supply-dates";
import { isManuallyRestoredArchiveLabel } from "@/lib/contract-reactivate";

const POD_ARCHIVE_LABEL = "POD ricontrattualizzato";

/** Ultimo giorno utile del contratto precedente (es. nuovo 1/10 → 30/09). */
function dayBeforeSupplyStart(supplyStart: Date): Date {
  const d = new Date(
    supplyStart.getFullYear(),
    supplyStart.getMonth(),
    supplyStart.getDate(),
  );
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * Ricorrenti mensili Helios archiviati per errore come storici:
 * devono restare in Provvigioni/Report finché pagano (clone switch).
 */
export async function repairMonthlySwitchArchives(): Promise<{ repaired: number }> {
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: true,
      archiveLabel: { startsWith: POD_ARCHIVE_LABEL },
      OR: [...recurringMonthlyWhereOr],
    },
    select: { id: true },
    take: 5000,
  });

  let repaired = 0;
  for (const row of rows) {
    try {
      await prisma.contract.update({
        where: { id: row.id },
        data: { isHistorical: false },
      });
      await syncRecurringMonthsForContract(row.id).catch(() => undefined);
      repaired += 1;
    } catch (e) {
      console.error("[repairMonthlySwitchArchives]", row.id, e);
    }
  }
  return { repaired };
}

/** Chiusura ricorrente mensile sostituito: resta visibile, stato KO (non Archivio). */
function monthlySwitchCloseData(latestSupply: Date) {
  const expiryDate = dayBeforeSupplyStart(latestSupply);
  return {
    isHistorical: false as const,
    archiveLabel: null as string | null,
    status: "KO" as const,
    expiryDate,
    koNotes: supersedeNote(latestSupply),
  };
}

/**
 * Gli import Excel «Archivio» avevano messo TUTTO come isHistorical=true,
 * quindi Provvigioni non li vedeva (badge 187, tabella 1 riga).
 * Riattiva i contratti importati; restano storici solo i POD ricontrattualizzati.
 */
export async function reactivateImportedHistoricalContracts(): Promise<{
  reactivated: number;
}> {
  // update uno-a-uno: updateMany non supportato in HTTP mode Neon
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: true,
      OR: [
        { archiveLabel: null },
        { NOT: { archiveLabel: { startsWith: POD_ARCHIVE_LABEL } } },
      ],
    },
    select: { id: true },
    take: 5000,
  });
  let reactivated = 0;
  for (const r of rows) {
    try {
      await prisma.contract.update({
        where: { id: r.id },
        data: { isHistorical: false },
      });
      reactivated += 1;
    } catch (e) {
      console.error("[reactivateImportedHistoricalContracts]", r.id, e);
    }
  }
  return { reactivated };
}

/**
 * Helios & co. (ricorrente mensile): se il NUOVO contratto sullo stesso POD
 * non è ancora in fornitura, il vecchio resta attivo (niente archivio/KO).
 * Esempio: inserimento oggi → fornitura 1 ottobre → Helios resta fino al 30/09.
 */
export function keepMonthlyRecurringUntilNewSupply(opts: {
  olderRecurrence: string | null | undefined;
  newerSupplyStart: Date | null | undefined;
  now?: Date;
}): boolean {
  if (!isRecurringMonthly(opts.olderRecurrence)) return false;
  if (!opts.newerSupplyStart) return true;
  return !isInFornitura(opts.newerSupplyStart, opts.now ?? new Date());
}

function supersedeNote(supply: Date): string {
  return `KO: nuovo contratto stesso POD in fornitura dal ${formatItDate(supply)}`;
}

/**
 * Archivia contratti «precedenti» sullo stesso POD quando ne esiste uno più recente.
 *
 * Eccezione: ricorrente mensile (Helios, …) resta in Provvigioni fino all’ingresso
 * del nuovo contratto; solo allora passa in KO (mai CHIUSO automatico).
 */
export async function archiveSupersededPodContracts(options?: {
  /** Se valorizzato, archivia solo questo POD (dopo nuovo contratto). */
  onlyPodKey?: string;
  now?: Date;
}): Promise<{ archived: number; keptMonthly: number }> {
  const now = options?.now ?? new Date();
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      supplyStartDate: true,
      insertionDate: true,
      createdAt: true,
      operationType: true,
      recurrence: true,
      status: true,
      expiryDate: true,
      archiveLabel: true,
    },
    take: 12000,
  });

  type Row = (typeof contracts)[number] & {
    podKey: string;
    score: number;
    supplyResolved: Date;
  };
  const scored: Row[] = [];
  for (const c of contracts) {
    const podKey = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!podKey || podKey.length < 6) continue;
    if (options?.onlyPodKey && podKey !== options.onlyPodKey) continue;
    const supplyResolved =
      c.supplyStartDate ??
      computeSupplyStartDate(c.insertionDate, c.operationType);
    const supply = supplyResolved.getTime();
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt.getTime();
    scored.push({
      ...c,
      podKey,
      supplyResolved,
      // Priorità: ingresso fornitura, poi inserimento, poi creazione
      score: supply * 1e6 + insert * 1e3 + created,
    });
  }

  const byPod = new Map<string, Row[]>();
  for (const s of scored) {
    const list = byPod.get(s.podKey) ?? [];
    list.push(s);
    byPod.set(s.podKey, list);
  }

  const toArchive: Array<{ older: Row; latestSupply: Date }> = [];
  const toKeep: Array<{ older: Row; until: Date }> = [];
  for (const [, list] of byPod) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.score - a.score);
    const latest = list[0]!;
    for (const older of list.slice(1)) {
      if (older.id === latest.id) continue;
      if (isManuallyRestoredArchiveLabel(older.archiveLabel)) continue;
      if (
        keepMonthlyRecurringUntilNewSupply({
          olderRecurrence: older.recurrence,
          newerSupplyStart: latest.supplyResolved,
          now,
        })
      ) {
        toKeep.push({ older, until: latest.supplyResolved });
        continue;
      }
      toArchive.push({ older, latestSupply: latest.supplyResolved });
    }
  }

  let keptMonthly = 0;
  for (const { older, until } of toKeep) {
    try {
      const expiryDate = dayBeforeSupplyStart(until);
      const sameExpiry =
        older.expiryDate &&
        older.expiryDate.getFullYear() === expiryDate.getFullYear() &&
        older.expiryDate.getMonth() === expiryDate.getMonth() &&
        older.expiryDate.getDate() === expiryDate.getDate();
      if (!sameExpiry) {
        await prisma.contract.update({
          where: { id: older.id },
          data: { expiryDate },
        });
      }
      keptMonthly += 1;
    } catch (e) {
      console.error("[archiveSupersededPodContracts] keep expiry", older.id, e);
    }
  }

  if (toArchive.length === 0) return { archived: 0, keptMonthly };

  // update uno-a-uno: updateMany usa transazioni non supportate da PrismaNeonHttp
  let archived = 0;
  for (const { older, latestSupply } of toArchive) {
    try {
      const monthly = isRecurringMonthly(older.recurrence);
      const alreadyClosed = ["KO", "ANNULLATO", "CHIUSO"].includes(older.status);
      if (monthly && !alreadyClosed) {
        await prisma.contract.update({
          where: { id: older.id },
          data: monthlySwitchCloseData(latestSupply),
        });
        await syncRecurringMonthsForContract(older.id).catch(() => undefined);
        archived += 1;
        continue;
      }
      await prisma.contract.update({
        where: { id: older.id },
        data: {
          isHistorical: true,
          archiveLabel: POD_ARCHIVE_LABEL,
          status: "KO",
          koNotes: supersedeNote(latestSupply),
        },
      });
      archived += 1;
    } catch (e) {
      console.error("[archiveSupersededPodContracts] update", older.id, e);
    }
  }
  return { archived, keptMonthly };
}

/** Dopo creazione contratto: archivia eventuali precedenti sullo stesso POD. */
export async function archiveOlderForContractPods(
  contractIds: string[],
): Promise<{ archived: number; keptMonthly: number }> {
  if (contractIds.length === 0) return { archived: 0, keptMonthly: 0 };
  const rows = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: { podPdr: true, pod: true, pdr: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const k = normalizePodKey(r.podPdr || r.pod || r.pdr);
    if (k && k.length >= 6) keys.add(k);
  }
  if (keys.size === 0) return { archived: 0, keptMonthly: 0 };

  // Prevale il contratto appena creato (anche con decorrenza anteriore),
  // ma i ricorrenti mensili restano attivi fino all’ingresso del nuovo.
  const created = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      supplyStartDate: true,
      insertionDate: true,
      operationType: true,
    },
  });
  const newSupplyByPod = new Map<string, Date>();
  for (const c of created) {
    const key = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!keys.has(key)) continue;
    const supply =
      c.supplyStartDate ??
      computeSupplyStartDate(c.insertionDate, c.operationType);
    const prev = newSupplyByPod.get(key);
    if (!prev || supply.getTime() > prev.getTime()) {
      newSupplyByPod.set(key, supply);
    }
  }

  const candidates = await prisma.contract.findMany({
    where: {
      id: { notIn: contractIds },
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
      recurrence: true,
      status: true,
      expiryDate: true,
      archiveLabel: true,
    },
    take: 12000,
  });

  let archived = 0;
  let keptMonthly = 0;
  const now = new Date();
  for (const candidate of candidates) {
    const key = normalizePodKey(candidate.podPdr || candidate.pod || candidate.pdr);
    if (!keys.has(key)) continue;
    if (isManuallyRestoredArchiveLabel(candidate.archiveLabel)) continue;
    const latestSupply = newSupplyByPod.get(key);
    try {
      if (
        keepMonthlyRecurringUntilNewSupply({
          olderRecurrence: candidate.recurrence,
          newerSupplyStart: latestSupply,
          now,
        })
      ) {
        const until = latestSupply ?? now;
        const expiryDate = dayBeforeSupplyStart(until);
        const sameExpiry =
          candidate.expiryDate &&
          candidate.expiryDate.getFullYear() === expiryDate.getFullYear() &&
          candidate.expiryDate.getMonth() === expiryDate.getMonth() &&
          candidate.expiryDate.getDate() === expiryDate.getDate();
        if (!sameExpiry) {
          await prisma.contract.update({
            where: { id: candidate.id },
            data: { expiryDate },
          });
        }
        keptMonthly += 1;
        continue;
      }

      const monthly = isRecurringMonthly(candidate.recurrence);
      const alreadyClosed = ["KO", "ANNULLATO", "CHIUSO"].includes(
        candidate.status,
      );
      if (monthly && !alreadyClosed && latestSupply) {
        await prisma.contract.update({
          where: { id: candidate.id },
          data: monthlySwitchCloseData(latestSupply),
        });
        await syncRecurringMonthsForContract(candidate.id).catch(
          () => undefined,
        );
        archived += 1;
        continue;
      }

      await prisma.contract.update({
        where: { id: candidate.id },
        data: {
          isHistorical: true,
          archiveLabel: POD_ARCHIVE_LABEL,
          status: "KO",
          koNotes: latestSupply
            ? supersedeNote(latestSupply)
            : "KO: POD ricontrattualizzato",
        },
      });
      if (monthly) {
        await syncRecurringMonthsForContract(candidate.id).catch(
          () => undefined,
        );
      }
      archived += 1;
    } catch (e) {
      console.error("[archiveOlderForContractPods]", candidate.id, e);
    }
  }
  return { archived, keptMonthly };
}
