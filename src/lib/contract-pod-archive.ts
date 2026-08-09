import { prisma } from "@/lib/prisma";
import { normalizePodKey } from "@/lib/storno-status";

const POD_ARCHIVE_LABEL = "POD ricontrattualizzato";

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
 * Archivia contratti «precedenti» sullo stesso POD quando ne esiste uno più recente.
 * In Contratti attivi / Provvigioni resta solo il nuovo; i vecchi vanno in Archivio.
 */
export async function archiveSupersededPodContracts(options?: {
  /** Se valorizzato, archivia solo questo POD (dopo nuovo contratto). */
  onlyPodKey?: string;
}): Promise<{ archived: number }> {
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
    },
    take: 12000,
  });

  type Row = (typeof contracts)[number] & { podKey: string; score: number };
  const scored: Row[] = [];
  for (const c of contracts) {
    const podKey = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!podKey || podKey.length < 6) continue;
    if (options?.onlyPodKey && podKey !== options.onlyPodKey) continue;
    const supply = c.supplyStartDate?.getTime() ?? 0;
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt.getTime();
    scored.push({
      ...c,
      podKey,
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

  const toArchive: string[] = [];
  for (const [, list] of byPod) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.score - a.score);
    const latest = list[0]!;
    for (const older of list.slice(1)) {
      if (older.id === latest.id) continue;
      toArchive.push(older.id);
    }
  }

  if (toArchive.length === 0) return { archived: 0 };

  // update uno-a-uno: updateMany usa transazioni non supportate da PrismaNeonHttp
  let archived = 0;
  for (const id of toArchive) {
    try {
      await prisma.contract.update({
        where: { id },
        data: {
          isHistorical: true,
          archiveLabel: POD_ARCHIVE_LABEL,
        },
      });
      archived += 1;
    } catch (e) {
      console.error("[archiveSupersededPodContracts] update", id, e);
    }
  }
  return { archived };
}

/** Dopo creazione contratto: archivia eventuali precedenti sullo stesso POD. */
export async function archiveOlderForContractPods(
  contractIds: string[],
): Promise<number> {
  if (contractIds.length === 0) return 0;
  const rows = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
    select: { podPdr: true, pod: true, pdr: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const k = normalizePodKey(r.podPdr || r.pod || r.pdr);
    if (k && k.length >= 6) keys.add(k);
  }
  if (keys.size === 0) return 0;

  // In una ricontrattualizzazione prevale sempre il contratto appena creato,
  // anche se l'utente ha indicato una decorrenza anteriore a quella precedente.
  const candidates = await prisma.contract.findMany({
    where: {
      id: { notIn: contractIds },
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: { id: true, podPdr: true, pod: true, pdr: true },
    take: 12000,
  });
  let archived = 0;
  for (const candidate of candidates) {
    const key = normalizePodKey(candidate.podPdr || candidate.pod || candidate.pdr);
    if (!keys.has(key)) continue;
    try {
      await prisma.contract.update({
        where: { id: candidate.id },
        data: { isHistorical: true, archiveLabel: POD_ARCHIVE_LABEL },
      });
      archived += 1;
    } catch (e) {
      console.error("[archiveOlderForContractPods]", candidate.id, e);
    }
  }
  return archived;
}
