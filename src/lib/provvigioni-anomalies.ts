/**
 * P1.1 B5 — overview Anomalie unificata (sola lettura).
 *
 * Aggrega segnalazioni operative già usate in Provvigioni (rate mancanti,
 * assenti Helios, fuori storno) + anteprima duplicati POD nello stesso
 * `panelContractScopeWhere`. Nessuna scrittura: apply resta in Backup / P0.1.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  findPodDuplicateAnomalies,
  type PodDuplicateFinding,
} from "@/lib/provvigioni-integrity";
import { fuoriStornoWhere } from "@/lib/provvigioni-filters";
import { normalizePodKey } from "@/lib/storno-status";
import { clientDisplayName } from "@/lib/utils";

export const ANOMALIE_PREVIEW_LIMIT = 40;
/** Contratti attivi in scope da cui estrarre le chiavi POD per il check duplicati. */
export const ANOMALIE_POD_SCOPE_SAMPLE = 800;
/** Contratti (tutti i POD correlati) caricati per valutare le repliche. */
export const ANOMALIE_POD_RELATED_LIMIT = 4000;

export type AnomalyPreviewRow = {
  id: string;
  label: string;
  detail?: string;
  href?: string;
};

export type AnomalyBucketId =
  | "rate_mancanti"
  | "assenti_helios"
  | "fuori_storno"
  | "duplicati_pod";

export type AnomalyBucket = {
  id: AnomalyBucketId;
  title: string;
  hint: string;
  count: number;
  truncated: boolean;
  rows: AnomalyPreviewRow[];
  /** Deep-link lista Provvigioni già filtrata (quando esiste). */
  listHref?: string;
};

export type ProvvigioniAnomaliesOverview = {
  buckets: AnomalyBucket[];
  totalCount: number;
  /** Apply / analisi integrity completa solo in Backup. */
  backupHref: string;
};

function contractClientLabel(client: {
  type: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
} | null): string {
  if (!client) return "—";
  return clientDisplayName(client);
}

/**
 * Anteprima duplicati POD: parte dai contratti attivi nello scope, carica i
 * correlati sullo stesso POD (serve per decidere latest/older), poi filtra i
 * finding alle sole repliche «unhandled» ancora nello scope.
 */
export async function loadScopedPodDuplicatePreview(
  panelScope: Prisma.ContractWhereInput,
  opts?: { scopeSample?: number; relatedLimit?: number; previewLimit?: number },
): Promise<{
  count: number;
  truncated: boolean;
  findings: PodDuplicateFinding[];
  rows: AnomalyPreviewRow[];
}> {
  const scopeSample = opts?.scopeSample ?? ANOMALIE_POD_SCOPE_SAMPLE;
  const relatedLimit = opts?.relatedLimit ?? ANOMALIE_POD_RELATED_LIMIT;
  const previewLimit = opts?.previewLimit ?? ANOMALIE_PREVIEW_LIMIT;

  const scoped = await prisma.contract.findMany({
    where: {
      AND: [
        panelScope,
        {
          deletedAt: null,
          isHistorical: false,
          OR: [
            { podPdr: { not: null } },
            { pod: { not: null } },
            { pdr: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true,
      podPdr: true,
      pod: true,
      pdr: true,
    },
    take: scopeSample,
  });

  const scopedIds = new Set(scoped.map((c) => c.id));
  /** Valori grezzi POD (come in DB) per il join; la normalizzazione avviene in findPodDuplicateAnomalies. */
  const rawPods = [
    ...new Set(
      scoped
        .flatMap((c) => [c.podPdr, c.pod, c.pdr])
        .filter((p): p is string => Boolean(p && p.trim().length >= 6)),
    ),
  ];
  const normalizedInScope = new Set(
    rawPods.map((p) => normalizePodKey(p)).filter((k) => k.length >= 6),
  );

  if (rawPods.length === 0 || normalizedInScope.size === 0) {
    return { count: 0, truncated: scoped.length >= scopeSample, findings: [], rows: [] };
  }

  const related = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { podPdr: { in: rawPods } },
        { pod: { in: rawPods } },
        { pdr: { in: rawPods } },
      ],
    },
    select: {
      id: true,
      contractNumber: true,
      clientId: true,
      supplierId: true,
      podPdr: true,
      pod: true,
      pdr: true,
      supplyStartDate: true,
      insertionDate: true,
      createdAt: true,
      operationType: true,
      recurrence: true,
      status: true,
      isHistorical: true,
      deletedAt: true,
      archiveLabel: true,
      stornoEndDate: true,
      supplier: { select: { stornoMonths: true } },
      collaborator: { select: { name: true } },
      client: {
        select: {
          type: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    take: relatedLimit,
  });

  const allFindings = findPodDuplicateAnomalies(related, new Date());
  const findings = allFindings
    .map((f) => ({
      ...f,
      unhandled: f.unhandled.filter((u) => scopedIds.has(u.contractId)),
    }))
    .filter((f) => f.unhandled.length > 0);

  const rows: AnomalyPreviewRow[] = [];
  for (const f of findings) {
    for (const u of f.unhandled) {
      if (rows.length >= previewLimit) break;
      rows.push({
        id: u.contractId,
        label: u.label,
        detail:
          u.reason === "mensile_da_chiudere"
            ? `POD ${f.podKey} · mensile da chiudere (nuovo ingresso)`
            : `POD ${f.podKey} · fuori storno non archiviato`,
        href: `/contratti/${u.contractId}`,
      });
    }
    if (rows.length >= previewLimit) break;
  }

  const unhandledTotal = findings.reduce((s, f) => s + f.unhandled.length, 0);
  return {
    count: unhandledTotal,
    truncated:
      scoped.length >= scopeSample ||
      related.length >= relatedLimit ||
      rows.length < unhandledTotal,
    findings,
    rows,
  };
}

export async function loadFuoriStornoPreview(
  panelScope: Prisma.ContractWhereInput,
  previewLimit = ANOMALIE_PREVIEW_LIMIT,
): Promise<{ count: number; truncated: boolean; rows: AnomalyPreviewRow[] }> {
  const where: Prisma.ContractWhereInput = {
    AND: [
      panelScope,
      { isHistorical: false, deletedAt: null },
      fuoriStornoWhere(),
    ],
  };
  const [count, contracts] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      select: {
        id: true,
        contractNumber: true,
        podPdr: true,
        pod: true,
        pdr: true,
        stornoEndDate: true,
        collaborator: { select: { name: true } },
        supplier: { select: { name: true } },
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { stornoEndDate: "asc" },
      take: previewLimit,
    }),
  ]);

  return {
    count,
    truncated: count > contracts.length,
    rows: contracts.map((c) => ({
      id: c.id,
      label: `${contractClientLabel(c.client)} · ${c.supplier.name} · #${c.contractNumber}`,
      detail: [
        c.collaborator.name,
        c.podPdr || c.pod || c.pdr || null,
        c.stornoEndDate
          ? `storno fino al ${c.stornoEndDate.toLocaleDateString("it-IT")}`
          : "storno 0 mesi",
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/contratti/${c.id}`,
    })),
  };
}

/** Deep-link focus Provvigioni preservando filtri base (senza stato/vista). */
export function anomalieFocusListHref(
  focus: string,
  queryBase?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (queryBase) {
    for (const [k, v] of Object.entries(queryBase)) {
      if (!v || k === "focus" || k === "stato" || k === "vista") continue;
      params.set(k, v);
    }
  }
  params.set("focus", focus);
  return `/provvigioni?${params.toString()}`;
}

/**
 * Compone i 4 bucket della vista (pura: nessun DB).
 * Usata da `buildProvvigioniAnomaliesOverview` e dal check B5.
 */
export function composeAnomalyBuckets(input: {
  missingCount: number;
  heliosAbsentCount: number;
  missingPreview: AnomalyPreviewRow[];
  heliosPreview: AnomalyPreviewRow[];
  fuoriCount: number;
  fuoriTruncated: boolean;
  fuoriRows: AnomalyPreviewRow[];
  podCount: number;
  podTruncated: boolean;
  podRows: AnomalyPreviewRow[];
  queryBase?: Record<string, string | undefined>;
}): ProvvigioniAnomaliesOverview {
  const buckets: AnomalyBucket[] = [
    {
      id: "rate_mancanti",
      title: "Rate mancanti / pending",
      hint: "Competenza già dovuta senza incasso (finestra + lag Helios rispettati).",
      count: input.missingCount,
      truncated: input.missingPreview.length < input.missingCount,
      rows: input.missingPreview,
      listHref: anomalieFocusListHref("ricorrenze-mancanti", input.queryBase),
    },
    {
      id: "assenti_helios",
      title: "Assenti da rendiconto Helios",
      hint: "Rate ERROR_UNPAID con nota ASSENTE_RENDICONTO.",
      count: input.heliosAbsentCount,
      truncated: input.heliosPreview.length < input.heliosAbsentCount,
      rows: input.heliosPreview,
    },
    {
      id: "fuori_storno",
      title: "Storni critici (fuori storno)",
      hint: "Contratti attivi con periodo storno scaduto (o storno 0 mesi).",
      count: input.fuoriCount,
      truncated: input.fuoriTruncated,
      rows: input.fuoriRows,
      listHref: anomalieFocusListHref("fuori-storno", input.queryBase),
    },
    {
      id: "duplicati_pod",
      title: "Duplicati POD non gestiti",
      hint: "Repliche sullo stesso POD fuori storno / da chiudere. Apply solo in Backup.",
      count: input.podCount,
      truncated: input.podTruncated,
      rows: input.podRows,
    },
  ];

  return {
    buckets,
    totalCount: buckets.reduce((s, b) => s + b.count, 0),
    backupHref: "/backup#integrita",
  };
}

/**
 * Overview unificata per `focus=anomalie` (e hub in pagina).
 * `missing` / `heliosAbsent` arrivano già dalla page (stesso scope).
 */
export async function buildProvvigioniAnomaliesOverview(input: {
  panelScope: Prisma.ContractWhereInput;
  missingCount: number;
  heliosAbsentCount: number;
  missingPreview: AnomalyPreviewRow[];
  heliosPreview: AnomalyPreviewRow[];
  queryBase?: Record<string, string | undefined>;
}): Promise<ProvvigioniAnomaliesOverview> {
  const [fuori, pod] = await Promise.all([
    loadFuoriStornoPreview(input.panelScope),
    loadScopedPodDuplicatePreview(input.panelScope),
  ]);

  return composeAnomalyBuckets({
    missingCount: input.missingCount,
    heliosAbsentCount: input.heliosAbsentCount,
    missingPreview: input.missingPreview,
    heliosPreview: input.heliosPreview,
    fuoriCount: fuori.count,
    fuoriTruncated: fuori.truncated,
    fuoriRows: fuori.rows,
    podCount: pod.count,
    podTruncated: pod.truncated,
    podRows: pod.rows,
    queryBase: input.queryBase,
  });
}
