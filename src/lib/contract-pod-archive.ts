import { prisma } from "@/lib/prisma";
import {
  computeStornoEndDate,
  normalizePodKey,
} from "@/lib/storno-status";

/**
 * Archivia contratti «precedenti» sullo stesso POD quando esiste uno più recente
 * e il vecchio è fuori storno (o cessato/scaduto).
 * Così in Clienti/Contratti/Provvigioni restano solo gli attivi (isHistorical=false).
 */
export async function archiveSupersededPodContracts(): Promise<{
  archived: number;
}> {
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      OR: [{ podPdr: { not: null } }, { pod: { not: null } }, { pdr: { not: null } }],
    },
    select: {
      id: true,
      status: true,
      podPdr: true,
      pod: true,
      pdr: true,
      supplyStartDate: true,
      insertionDate: true,
      createdAt: true,
      collectionDate: true,
      stornoEndDate: true,
      expiryDate: true,
      durationMonths: true,
      supplier: { select: { stornoMonths: true } },
    },
    take: 8000,
  });

  type Row = (typeof contracts)[number] & { podKey: string; score: number };
  const scored: Row[] = [];
  for (const c of contracts) {
    const podKey = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!podKey || podKey.length < 6) continue;
    const supply = c.supplyStartDate?.getTime() ?? 0;
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt?.getTime() ?? 0;
    scored.push({
      ...c,
      podKey,
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
  const now = new Date();

  for (const [, list] of byPod) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.score - a.score);
    const latest = list[0]!;
    for (const older of list.slice(1)) {
      if (older.id === latest.id) continue;
      if (["KO", "ANNULLATO", "CHIUSO"].includes(older.status)) {
        toArchive.push(older.id);
        continue;
      }
      // Fuori storno: fine storno passata, oppure mai pagato ma superato da nuovo attivo
      const stornoEnd = computeStornoEndDate(
        older.supplyStartDate,
        older.supplier.stornoMonths,
        older.stornoEndDate,
      );
      const fuoriStorno =
        !stornoEnd || stornoEnd.getTime() < now.getTime();
      const unpaid = !older.collectionDate;
      // Se ancora in storno e pagato → NON archiviare (rischio)
      if (older.collectionDate && stornoEnd && stornoEnd.getTime() >= now.getTime()) {
        continue;
      }
      // Ricontrattualizzato + fuori storno (o non pagato ma sostituito)
      if (fuoriStorno || unpaid) {
        toArchive.push(older.id);
      }
    }
  }

  if (toArchive.length === 0) return { archived: 0 };

  // Lotti per evitare payload enormi
  let archived = 0;
  for (let i = 0; i < toArchive.length; i += 100) {
    const chunk = toArchive.slice(i, i + 100);
    const res = await prisma.contract.updateMany({
      where: { id: { in: chunk }, isHistorical: false },
      data: {
        isHistorical: true,
        archiveLabel: "POD ricontrattualizzato (fuori storno)",
      },
    });
    archived += res.count;
  }
  return { archived };
}
