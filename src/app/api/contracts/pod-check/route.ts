import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { contractVisibilityWhere } from "@/lib/user-scope";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  normalizePodKey,
  resolveStornoInfo,
} from "@/lib/storno-status";
import {
  resolveStornoBadges,
  type StornoBadgeDef,
} from "@/lib/storno-badges";
import {
  podPeerSwitchHintLabel,
  resolvePodPeerSwitchHint,
} from "@/lib/contract-pod-peers";
import { computeSupplyStartDate } from "@/lib/supply-dates";

/**
 * Limite per utente sulle sonde POD: la risposta anonima
 * («esiste ma non è tuo») non deve diventare uno strumento di enumerazione.
 * In memoria, per istanza serverless: best effort, non un blocco assoluto.
 */
const PROBE_WINDOW_MS = 5 * 60 * 1000;
const PROBE_MAX = 40;
const probes = new Map<string, number[]>();

function isProbeRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (probes.get(userId) ?? []).filter(
    (t) => now - t < PROBE_WINDOW_MS,
  );
  recent.push(now);
  probes.set(userId, recent);
  if (probes.size > 500) {
    for (const [id, times] of probes) {
      if (times.every((t) => now - t >= PROBE_WINDOW_MS)) probes.delete(id);
    }
  }
  return recent.length > PROBE_MAX;
}

export type PodCheckMatch = {
  id: string;
  contractNumber: string;
  client: string;
  supplier: string;
  status: string;
  supplyStartDate: string | null;
  archived: boolean;
  badges: StornoBadgeDef[];
  switchHint: "switch_certo" | "switch_possibile";
  switchHintLabel: string;
  riskSwitch: boolean;
  riskStorno: boolean;
};

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const value = new URL(request.url).searchParams.get("value")?.trim() ?? "";
  const key = normalizePodKey(value);
  if (key.length < 6) return NextResponse.json({ matches: [] });

  if (isProbeRateLimited(session.id)) {
    return NextResponse.json(
      { error: "Troppe verifiche POD/PDR ravvicinate. Riprova tra qualche minuto." },
      { status: 429 },
    );
  }

  const visibility = await contractVisibilityWhere(session);
  const podWhere = {
    deletedAt: null,
    OR: [
      { pod: { in: [value, key], mode: "insensitive" as const } },
      { pdr: { in: [value, key], mode: "insensitive" as const } },
      { podPdr: { in: [value, key], mode: "insensitive" as const } },
    ],
  };

  const rows = await prisma.contract.findMany({
    where: { AND: [visibility], ...podWhere },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      pod: true,
      pdr: true,
      podPdr: true,
      supplyStartDate: true,
      insertionDate: true,
      createdAt: true,
      collectionDate: true,
      stornoEndDate: true,
      expiryDate: true,
      durationMonths: true,
      isHistorical: true,
      recurrence: true,
      operationType: true,
      clientId: true,
      supplierId: true,
      client: {
        select: {
          type: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      },
      supplier: { select: { name: true, stornoMonths: true } },
      commission: { select: { stornoDate: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const filtered = rows.filter(
    (row) => normalizePodKey(row.pod || row.pdr || row.podPdr) === key,
  );

  const forMark = filtered.map((c) => {
    const supply =
      c.supplyStartDate ??
      (c.operationType
        ? computeSupplyStartDate(c.insertionDate, c.operationType)
        : null);
    return {
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: supply,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
      collectionDate: c.collectionDate,
      stornoMonths: c.supplier.stornoMonths ?? null,
      stornoEndDate: c.stornoEndDate,
    };
  });
  const latestMap = markLatestContractsByPod(forMark);
  const earlyMap = markEarlyReswitchContracts(forMark);
  const hasActivePeer = filtered.some((c) => !c.isHistorical);

  const matches: PodCheckMatch[] = filtered.map((row) => {
    const supply =
      row.supplyStartDate ??
      (row.operationType
        ? computeSupplyStartDate(row.insertionDate, row.operationType)
        : null);
    const stornoInfo = resolveStornoInfo({
      status: row.status,
      recurrence: row.recurrence,
      supplyStartDate: supply,
      stornoMonths: row.supplier.stornoMonths,
      stornoEndDate: row.stornoEndDate,
      expiryDate: row.expiryDate,
      durationMonths: row.durationMonths,
      isLatestForPod: latestMap.get(row.id) ?? true,
      collectionDate: row.collectionDate,
      isEarlyReswitch: earlyMap.get(row.id) ?? false,
    });
    const badges = resolveStornoBadges({
      stornoKind: stornoInfo.kind,
      isHistorical: row.isHistorical === true,
      isEarlyReswitch: earlyMap.get(row.id) === true,
      isStornato:
        row.status === "STORNATO" || Boolean(row.commission?.stornoDate),
      hasActivePodPeer: hasActivePeer || filtered.length > 1,
    });
    const switchHint = resolvePodPeerSwitchHint(row.operationType);
    const riskStorno = badges.some(
      (b) =>
        b.id === "in_storno" ||
        b.id === "storno_in_scadenza" ||
        b.id === "doppia_posizione",
    );

    return {
      id: row.id,
      contractNumber: row.contractNumber,
      client: clientDisplayName(row.client),
      supplier: row.supplier.name,
      status: row.status,
      supplyStartDate: supply?.toISOString() ?? null,
      archived: row.isHistorical,
      badges,
      switchHint,
      switchHintLabel: podPeerSwitchHintLabel(switchHint),
      riskSwitch: true,
      riskStorno,
    };
  });

  const seesEverything = Object.keys(visibility).length === 0;
  const visibleIds = new Set(matches.map((m) => m.id));
  const others = seesEverything
    ? []
    : await prisma.contract.findMany({
        where: podWhere,
        select: { id: true, pod: true, pdr: true, podPdr: true },
        take: 20,
      });
  const existsOutsideScope = others.some(
    (row) =>
      !visibleIds.has(row.id) &&
      normalizePodKey(row.pod || row.pdr || row.podPdr) === key,
  );

  const riskSummary = {
    hasDuplicates: matches.length > 0 || existsOutsideScope,
    riskStorno: matches.some((m) => m.riskStorno),
    riskSwitch: matches.length > 0 || existsOutsideScope,
  };

  return NextResponse.json({ matches, existsOutsideScope, riskSummary });
}
