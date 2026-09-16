import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { contractVisibilityWhere } from "@/lib/user-scope";
import { normalizePodKey } from "@/lib/storno-status";

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
  // Evita crescita illimitata della mappa sull'istanza
  if (probes.size > 500) {
    for (const [id, times] of probes) {
      if (times.every((t) => now - t >= PROBE_WINDOW_MS)) probes.delete(id);
    }
  }
  return recent.length > PROBE_MAX;
}

export async function GET(request: Request) {
  const session = await getSession();
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

  // Solo contratti nel perimetro dell'utente: il POD di altri non è enumerabile
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
      status: true,
      pod: true,
      pdr: true,
      podPdr: true,
      supplyStartDate: true,
      isHistorical: true,
      client: { select: { type: true, firstName: true, lastName: true, companyName: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const matches = rows
    .filter((row) => normalizePodKey(row.pod || row.pdr || row.podPdr) === key)
    .map((row) => ({
      id: row.id,
      client: clientDisplayName(row.client),
      supplier: row.supplier.name,
      status: row.status,
      supplyStartDate: row.supplyStartDate?.toISOString() ?? null,
      archived: row.isHistorical,
    }));

  /**
   * Fuori perimetro si dice solo che il POD esiste: nessun id, cliente,
   * fornitore, stato o data, così l'avviso di ricontrattualizzazione resta
   * utile senza rendere leggibili i contratti di altri.
   */
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

  return NextResponse.json({ matches, existsOutsideScope });
}
