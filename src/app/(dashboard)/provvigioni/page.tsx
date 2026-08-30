import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canConfirmCommission, hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { formatMonthYear } from "@/lib/date-parse";
import { clientDisplayName, clientSortKey } from "@/lib/utils";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import {
  ProvvigioniFilterTable,
} from "@/components/provvigioni/provvigioni-filter-table";
import { ProvvigioniTrashPanel } from "@/components/provvigioni/provvigioni-trash-panel";
import { RecurringMissingPanel } from "@/components/provvigioni/recurring-missing-panel";
import { HeliosAbsentPanel } from "@/components/provvigioni/helios-absent-panel";
import { RecurringReconciliationPanel } from "@/components/provvigioni/recurring-reconciliation-panel";
import { ProvvigioniVistaTabs } from "@/components/provvigioni/provvigioni-vista-tabs";
import { CompetenceMonthPanel } from "@/components/provvigioni/competence-month-panel";
import {
  RecurringRendicontoPanel,
  toSettledRow,
} from "@/components/provvigioni/recurring-rendiconto-panel";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { ListSearchForm } from "@/components/ui/list-search-form";
import { Button } from "@/components/ui/button";
import {
  getMissingRecurringAlerts,
  getHeliosAbsentAlerts,
  getSettledRecurringForPeriod,
  syncAllRecurringMonths,
  syncRecurringMonthsForContract,
  reconcileAllRecurringBounds,
} from "@/lib/recurring-sync";
import {
  effectiveCollectionDate,
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveStornoInfo,
} from "@/lib/storno-status";
import {
  computeSupplyStartDate,
  formatItDate,
  isInFornitura,
} from "@/lib/supply-dates";
import { PAGE_SIZE, pageCount, pageSkip, parsePage } from "@/lib/pagination";
import {
  buildProvvigioniContractWhere,
  provvigioniCompetenceWhere,
  recurringMonthlyWhereOr,
  sumProvvigioniTotals,
} from "@/lib/provvigioni-filters";
import {
  competenceMonthOptions,
  competenceSummaryForStato,
  incassatoCompetenceTotals,
  loadCompetenceMonthStats,
  parseProvvigioniVista,
  vistaToRecurrenceMode,
  type ProvvigioniVista,
} from "@/lib/provvigioni-competence";
import { addMonths, periodLabel, toPeriod, isRecurring } from "@/lib/recurring";
import type { Prisma } from "@/generated/prisma/client";
import {
  defaultGettonePrivato,
  effectiveGettone,
  lastRecurringIncassoNote,
  operationTypeLabel,
  simplifiedProvvigioneStato,
  type ProvvigioneRow,
} from "@/lib/provvigioni-stato";

export const dynamic = "force-dynamic";

type SearchParams = {
  page?: string;
  collab?: string;
  settled?: string;
  /** Nome fornitore (es. Enel) — filtro su tutto il DB */
  supplier?: string;
  /** Uno o più stati separati da | (es. Da incassare|Incassato) */
  stato?: string;
  /** Business | Domestico */
  tipologia?: string;
  /** client = cognome+nome su tutto il filtro */
  sort?: string;
  dir?: string;
  /** Cerca cliente / POD */
  q?: string;
  /** tutti | mensile | annuale (ricorrente → mensile per link vecchi) */
  vista?: string;
  /** Accesso rapido dalla Dashboard */
  focus?: string;
  /** Mese di competenza YYYY-MM delle ricorrenze */
  competence?: string;
};

export default async function ProvvigioniPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const {
    page: pageRaw,
    collab,
    settled: settledRaw,
    supplier: supplierRaw,
    stato: statoRaw,
    tipologia: tipologiaRaw,
    sort: sortRaw,
    dir: dirRaw,
    q: qRaw,
    vista: vistaRaw,
    focus: focusRaw,
    competence: competenceRaw,
  } = await searchParams;
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const canConfirm = canConfirmCommission(session.role);
  const canExport = hasPermission(session.role, "reports.export");
  const isScoped = hasPermission(session.role, "contracts.work_scoped");

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const supplier = supplierRaw?.trim() || undefined;
  const stato = statoRaw?.trim() || undefined;
  const tipologia = tipologiaRaw?.trim() || undefined;
  const q = qRaw?.trim() || undefined;
  const competencePeriod =
    competenceRaw && /^\d{4}-\d{2}$/.test(competenceRaw) ? competenceRaw : undefined;
  const focus =
    focusRaw === "da-confermare" || focusRaw === "ricorrenze-mancanti"
      ? focusRaw
      : undefined;
  // Schede: tutti | ut (gettone) | mensile (M) | annuale (R)
  const vista: ProvvigioniVista = parseProvvigioniVista(vistaRaw);
  const recurrenceMode = vistaToRecurrenceMode(vista);
  const recurringKind =
    focus === "ricorrenze-mancanti"
      ? "all"
      : vista === "annuale"
        ? "annual"
        : "monthly";

  const settledPeriod =
    settledRaw && /^\d{4}-\d{2}$/.test(settledRaw) ? settledRaw : toPeriod(new Date());
  const reconciliationPeriod = addMonths(settledPeriod, -1);
  const showCompetencePanel = vista === "mensile" || vista === "annuale";
  const statoNeedsCompetence =
    Boolean(stato?.includes("Incassato")) ||
    Boolean(stato?.includes("Pagato")) ||
    Boolean(stato?.includes("Da incassare"));
  /** Mese competenza: su M/R sempre; con filtro stato Incassato/Pagato/Da incassare anche su Tutti/UT */
  const effectiveCompetence =
    competencePeriod ??
    (showCompetencePanel || statoNeedsCompetence ? reconciliationPeriod : undefined);
  const applyCompetenceToList = Boolean(effectiveCompetence);

  const baseContractWhere = buildProvvigioniContractWhere({
    // Backoffice: non forzare collaboratorId = sé (usa solo visibility)
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    collab,
    supplier,
    stato,
    tipologia,
    q,
    recurrenceMode,
    visibility,
    competencePeriod: effectiveCompetence,
  });
  function applyFocus(where: Prisma.ContractWhereInput): Prisma.ContractWhereInput {
    if (focus === "da-confermare") {
      return { AND: [where, { commissionConfirmed: false }] };
    }
    if (focus === "ricorrenze-mancanti") {
      return {
        AND: [
          where,
          {
            recurringMonths: {
              some: {
                status: { in: ["MISSING", "PENDING"] },
                period: { lt: toPeriod(new Date()) },
              },
            },
          },
        ],
      };
    }
    return where;
  }
  const contractWhere = applyFocus(
    applyCompetenceToList
      ? {
          AND: [
            baseContractWhere,
            provvigioniCompetenceWhere(effectiveCompetence!, stato),
          ],
        }
      : baseContractWhere,
  );
  const activeRecurringPeriod = addMonths(toPeriod(new Date()), -1);
  const [activeYear, activeMonth] = activeRecurringPeriod.split("-").map(Number);
  const activeRecurringEnd = new Date(activeYear, activeMonth, 0, 23, 59, 59, 999);
  const activeRecurringWhere: Prisma.ContractWhereInput = {
    status: { notIn: ["KO", "ANNULLATO", "CHIUSO"] },
    supplyStartDate: { not: null, lte: activeRecurringEnd },
  };
  const collaboratorBaseWhere = buildProvvigioniContractWhere({
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    supplier,
    stato,
    tipologia,
    q,
    recurrenceMode,
    visibility,
    competencePeriod: effectiveCompetence,
  });
  const collaboratorCountsWhere = applyFocus(
    vista === "mensile" || vista === "annuale"
      ? { AND: [collaboratorBaseWhere, activeRecurringWhere] }
      : collaboratorBaseWhere,
  );
  const collabFilter =
    (canViewAll || isScoped) && collab && collab !== "tutti" ? collab : undefined;
  const sessionCollabFilter = isScoped
    ? undefined
    : canViewAll
      ? collabFilter && !collabFilter.includes("|")
        ? collabFilter
        : undefined
      : session.id;
  const reconciliationContractWhere = buildProvvigioniContractWhere({
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    collab,
    supplier,
    recurrenceMode: "monthly",
    visibility,
  });

  const tabCountsBase = buildProvvigioniContractWhere({
    canViewAll: canViewAll || isScoped,
    sessionUserId: session.id,
    collab,
    supplier,
    tipologia,
    q,
    recurrenceMode: "all",
    visibility,
  });
  const recurringOperationalView =
    vista === "mensile" || vista === "annuale" || focus === "ricorrenze-mancanti";
  // Prima di conteggi e avvisi genera tutte le rate dovute e rimuove quelle fuori periodo.
  if (recurringOperationalView) {
    await syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
      console.error("sync all recurring", e),
    );
    await reconcileAllRecurringBounds().catch((e) =>
      console.error("reconcile recurring bounds", e),
    );
  }

  const sortByClient = sortRaw === "client";
  const sortDir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  const defaultOrderBy: Prisma.ContractOrderByWithRelationInput[] = [
    { insertionDate: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ];

  // Con una ricerca mirata riconcilia subito i contratti trovati; altrimenti usa il sync leggero.
  if (q) {
    const matchingRecurring = await prisma.contract.findMany({
      where: baseContractWhere,
      select: { id: true },
      take: 100,
    });
    await Promise.all(
      matchingRecurring.map((row) =>
        syncRecurringMonthsForContract(row.id).catch((e) =>
          console.error("sync recurring searched contract", e),
        ),
      ),
    );
  } else if (!recurringOperationalView) {
    void syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
      console.error("sync recurring", e),
    );
  }

  // Prima conta: serve per clampare la pagina (evita pagine oltre il totale → elenco vuoto)
  const total = await prisma.contract.count({ where: contractWhere });
  const pages = pageCount(total);
  const page = Math.min(parsePage(pageRaw), pages);

  // Commissoni mancanti: in background (non blocca il caricamento)
  void prisma.contract
    .findMany({
      where: { ...contractWhere, commission: { is: null } },
      select: { id: true },
      take: 20,
    })
    .then((missingCommission) =>
      Promise.all(
        missingCommission.map((c) =>
          prisma.commission
            .create({
              data: {
                contractId: c.id,
                expected: 0,
                accrued: 0,
                received: 0,
                paid: 0,
              },
            })
            .catch(() => null),
        ),
      ),
    )
    .catch(() => null);

  const contractSelect = {
    id: true,
    clientId: true,
    supplierId: true,
    status: true,
    paymentStatus: true,
    recurrence: true,
    podPdr: true,
    pod: true,
    pdr: true,
    collectionDate: true,
    commissionConfirmed: true,
    supplyStartDate: true,
    insertionDate: true,
    createdAt: true,
    expiryDate: true,
    durationMonths: true,
    stornoEndDate: true,
    operationType: true,
    collaboratorId: true,
    notes: true,
    client: {
      select: {
        type: true,
        companyName: true,
        firstName: true,
        lastName: true,
      },
    },
    collaborator: { select: { id: true, name: true } },
    supplier: { select: { id: true, name: true, stornoMonths: true } },
    commission: {
      select: {
        id: true,
        expected: true,
        received: true,
        paid: true,
        stornoDate: true,
        stornoAmount: true,
      },
    },
    recurringMonths: {
      select: { period: true, status: true, amount: true },
      orderBy: { period: "asc" as const },
    },
  } as const;

  // Ordinamento cliente: solo se il filtro non è enorme (altrimenti troppo lento)
  let pageContractIds: string[] | null = null;
  if (sortByClient && total <= 800) {
    const light = await prisma.contract.findMany({
      where: contractWhere,
      select: {
        id: true,
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    light.sort((a, b) => {
      const cmp = clientSortKey(a.client).localeCompare(
        clientSortKey(b.client),
        "it",
        { sensitivity: "base", numeric: true },
      );
      return sortDir === "asc" ? cmp : -cmp;
    });
    pageContractIds = light
      .slice(pageSkip(page), pageSkip(page) + PAGE_SIZE)
      .map((r) => r.id);
  }

  const [
    contractsRaw,
    moneyTotals,
    daConfermareCount,
    collaboratorOptions,
    supplierOptions,
    missing,
    heliosAbsent,
    collabGroups,
    settledRowsRaw,
    deletedRecent,
    countGettoni,
    countMensili,
    countAnnuali,
    countTutti,
    competenceStats,
    reconciliationRowsRaw,
  ] = await Promise.all([
    pageContractIds
      ? pageContractIds.length === 0
        ? Promise.resolve([])
        : prisma.contract.findMany({
            where: { id: { in: pageContractIds } },
            select: contractSelect,
          })
      : prisma.contract.findMany({
          where: contractWhere,
          select: contractSelect,
          orderBy: defaultOrderBy,
          skip: pageSkip(page),
          take: PAGE_SIZE,
        }),
    sumProvvigioniTotals(contractWhere),
    prisma.contract.count({
      where: { ...contractWhere, commissionConfirmed: false },
    }),
    canViewAll
      ? prisma.user.findMany({
          where: {
            active: true,
            role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { active: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    getMissingRecurringAlerts(sessionCollabFilter, recurringKind),
    getHeliosAbsentAlerts(sessionCollabFilter),
    canViewAll
      ? prisma.contract.groupBy({
          by: ["collaboratorId"],
          where: collaboratorCountsWhere,
          _count: { id: true },
        })
      : Promise.resolve([]),
    getSettledRecurringForPeriod(settledPeriod, sessionCollabFilter),
    prisma.contract.findMany({
      where: {
        deletedAt: { not: null },
        ...(canViewAll ? {} : { collaboratorId: session.id }),
      },
      select: {
        id: true,
        deletedAt: true,
        podPdr: true,
        client: {
          select: {
            type: true,
            companyName: true,
            firstName: true,
            lastName: true,
          },
        },
        supplier: { select: { name: true } },
        collaborator: { select: { name: true } },
      },
      orderBy: { deletedAt: "desc" },
      take: 12,
    }),
    prisma.contract.count({ where: tabCountsBase }),
    prisma.contract.count({
      where: buildProvvigioniContractWhere({
        canViewAll: canViewAll || isScoped,
        sessionUserId: session.id,
        collab,
        supplier,
        tipologia,
        q,
        recurrenceMode: "exclude",
        visibility,
      }),
    }),
    prisma.contract.count({
      where: {
        AND: [
          buildProvvigioniContractWhere({
            canViewAll: canViewAll || isScoped,
            sessionUserId: session.id,
            collab,
            supplier,
            tipologia,
            q,
            recurrenceMode: "monthly",
            visibility,
          }),
          activeRecurringWhere,
        ],
      },
    }),
    prisma.contract.count({
      where: {
        AND: [
          buildProvvigioniContractWhere({
            canViewAll: canViewAll || isScoped,
            sessionUserId: session.id,
            collab,
            supplier,
            tipologia,
            q,
            recurrenceMode: "annual",
            visibility,
          }),
          activeRecurringWhere,
        ],
      },
    }),
    effectiveCompetence && (showCompetencePanel || statoNeedsCompetence)
      ? loadCompetenceMonthStats(
          effectiveCompetence,
          buildProvvigioniContractWhere({
            canViewAll: canViewAll || isScoped,
            sessionUserId: session.id,
            collab,
            supplier,
            tipologia,
            q,
            recurrenceMode:
              vista === "annuale" ? "annual" : vista === "ut" ? "exclude" : "monthly",
            visibility,
          }),
        )
      : Promise.resolve(null),
    prisma.recurringMonth.findMany({
      where: {
        period: reconciliationPeriod,
        status: { not: "CLOSED" },
        contract: reconciliationContractWhere,
      },
      select: {
        id: true,
        contractId: true,
        status: true,
        amount: true,
        settledPeriod: true,
        contract: {
          select: {
            podPdr: true,
            pod: true,
            pdr: true,
            client: { select: { type: true, companyName: true, firstName: true, lastName: true } },
            supplier: { select: { name: true } },
            commission: { select: { expected: true } },
          },
        },
      },
      orderBy: { contract: { supplier: { name: "asc" } } },
      take: 3000,
    }),
  ]);

  const contracts =
    pageContractIds == null
      ? contractsRaw
      : pageContractIds
          .map((id) => contractsRaw.find((c) => c.id === id))
          .filter((c): c is (typeof contractsRaw)[number] => Boolean(c));

  // Allinea in memoria subito; scrittura DB in background (pagina più veloce)
  const alignJobs: Promise<unknown>[] = [];
  const now = new Date();
  for (const c of contracts) {
    const supply =
      c.supplyStartDate ??
      computeSupplyStartDate(c.insertionDate, c.operationType);
    const inFornitura = isInFornitura(supply, now);

    // Incasso/Pagato prematuro: data futura = attivazione prevista, non pagamento
    // Non toccare «Da controllare»: devono restare visibili così
    if (
      c.collectionDate &&
      !inFornitura &&
      !["KO", "ANNULLATO", "CHIUSO", "DA_CONTROLLARE", "STORNATO"].includes(c.status)
    ) {
      const prevStatus = c.status;
      (c as { collectionDate: Date | null }).collectionDate = null;
      (c as { paymentStatus: string | null }).paymentStatus = "Da incassare";
      const revertStatus =
        prevStatus === "PAGATO_DAL_FORNITORE" ||
        prevStatus === "PROVVIGIONE_LIQUIDATA";
      if (revertStatus) {
        (c as { status: string }).status = "IN_ATTESA_PAGAMENTO";
      }
      alignJobs.push(
        prisma.contract
          .update({
            where: { id: c.id },
            data: {
              collectionDate: null,
              paymentStatus: "Da incassare",
              ...(revertStatus ? { status: "IN_ATTESA_PAGAMENTO" } : {}),
            },
          })
          .catch(() => null),
      );
    }

    const hasDate = Boolean(c.collectionDate) && inFornitura;
    // NON riscrivere KO/CHIUSO → Incassato solo perché c’è collectionDate.
    // Solo se già in fornitura.
    if (hasDate && c.status === "IN_ATTESA_PAGAMENTO") {
      (c as { status: string }).status = "PAGATO_DAL_FORNITORE";
      (c as { paymentStatus: string | null }).paymentStatus = "Incassato";
      alignJobs.push(
        prisma.contract
          .update({
            where: { id: c.id },
            data: {
              status: "PAGATO_DAL_FORNITORE",
              paymentStatus: "Incassato",
            },
          })
          .catch(() => null),
      );
    }
    if (c.client.type === "PRIVATO" && c.commission) {
      const target = defaultGettonePrivato(c.supplier.name);
      const current = Number(c.commission.expected ?? 0);
      if (target != null && current === 0) {
        (c.commission as { expected: unknown }).expected = target;
        alignJobs.push(
          prisma.commission
            .update({
              where: { id: c.commission.id },
              data: { expected: target },
            })
            .catch(() => null),
        );
      }
    }
  }
  if (alignJobs.length > 0) {
    void Promise.all(alignJobs);
  }

  const latestMap = markLatestContractsByPod(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
    })),
  );
  const earlyMap = markEarlyReswitchContracts(
    contracts.map((c) => ({
      id: c.id,
      clientId: c.clientId,
      supplierId: c.supplierId,
      podPdr: c.podPdr || c.pod || c.pdr,
      supplyStartDate: c.supplyStartDate,
      insertionDate: c.insertionDate,
      createdAt: c.createdAt,
      collectionDate: c.collectionDate,
      stornoMonths: c.supplier.stornoMonths,
      stornoEndDate: c.stornoEndDate,
    })),
  );

  const totals = {
    complessivo: moneyTotals.complessivo,
    daIncassare: moneyTotals.daIncassare,
    ricorrenti: moneyTotals.ricorrenti,
    daConfermare: daConfermareCount,
  };

  const rows: ProvvigioneRow[] = contracts.map((contract) => {
    const item = contract.commission;
    const supply =
      contract.supplyStartDate ??
      computeSupplyStartDate(contract.insertionDate, contract.operationType);
    const inFornitura = isInFornitura(supply);
    const effectiveCollection = effectiveCollectionDate(
      contract.collectionDate,
      supply,
    );
    const paidRecurringForCompetence = effectiveCompetence
      ? contract.recurringMonths.some(
          (m) =>
            m.period === effectiveCompetence &&
            (m.status === "PAID" || m.status === "LIQUIDATED"),
        )
      : contract.recurringMonths.some((m) => m.status === "PAID");
    const hasDate = Boolean(effectiveCollection) || paidRecurringForCompetence;
    const paidLabel = hasDate ? "Incassato" : "Da incassare";
    const competencePaidMonth = effectiveCompetence
      ? contract.recurringMonths.find(
          (m) =>
            m.period === effectiveCompetence &&
            (m.status === "PAID" || m.status === "LIQUIDATED"),
        )
      : undefined;
    // Colonna Incasso: pagamento reale o rata PAID nel mese competenza
    const collectionMonth = competencePaidMonth
      ? formatMonthYear(new Date(competencePaidMonth.period + "-01"))
      : hasDate
        ? formatMonthYear(effectiveCollection)
        : "";
    const activationNote =
      !inFornitura && supply
        ? `attiv. ${formatMonthYear(supply)}`
        : undefined;
    const storno = resolveStornoInfo({
      status: contract.status,
      recurrence: contract.recurrence,
      supplyStartDate: supply,
      stornoMonths: contract.supplier.stornoMonths,
      stornoEndDate: contract.stornoEndDate,
      expiryDate: contract.expiryDate,
      durationMonths: contract.durationMonths,
      isLatestForPod: latestMap.get(contract.id) ?? true,
      collectionDate: effectiveCollection,
      isEarlyReswitch: earlyMap.get(contract.id) ?? false,
    });

    const stato = simplifiedProvvigioneStato(contract.status, hasDate, {
      inFornitura: inFornitura || paidRecurringForCompetence,
      hasStorno: Boolean(item?.stornoDate),
    });

    const lastPaidNote = isRecurring(contract.recurrence)
      ? lastRecurringIncassoNote(contract.recurringMonths, stato)
      : "";
    const recurringIncassoNote = [activationNote, lastPaidNote]
      .filter(Boolean)
      .join(" · ") || undefined;

    const competenceMonthRow = effectiveCompetence
      ? contract.recurringMonths.find((m) => m.period === effectiveCompetence)
      : undefined;
    const monthAmount =
      competenceMonthRow?.amount != null
        ? Number(competenceMonthRow.amount.toString())
        : null;

    return {
      id: contract.id,
      clientId: contract.clientId,
      commissionId: item?.id ?? "",
      clientName: clientDisplayName(contract.client),
      podPdr: contract.podPdr || contract.pod || contract.pdr || "",
      collaboratorName: contract.collaborator.name,
      supplierName: contract.supplier.name,
      clientType: contract.client.type === "AZIENDA" ? "Business" : "Domestico",
      amount: String(
        monthAmount != null && monthAmount > 0
          ? monthAmount
          : effectiveGettone({
              expected: Number(item?.expected ?? 0),
              clientType: contract.client.type,
              supplierName: contract.supplier.name,
            }),
      ),
      supplyStartDate: supply ? formatItDate(supply) : "",
      operationType: operationTypeLabel(contract.operationType),
      recurrence: contract.recurrence || "Una tantum",
      stato,
      paymentStatus: paidLabel,
      confirmed: contract.commissionConfirmed ? "Confermata" : "Da confermare",
      collectionMonth,
      recurringIncassoNote,
      stornoFlag: item?.stornoDate ? "Sì" : "No",
      stornoMonth: item?.stornoDate ? formatMonthYear(item.stornoDate) : "",
      stornoAmount: item?.stornoAmount != null ? String(Number(item.stornoAmount)) : "",
      notes: contract.notes || "",
      stornoLabel:
        stato === "Da controllare"
          ? "Da controllare (non ancora contrattualizzato)"
          : stato === "Stornato"
            ? "Stornato (clawback applicato)"
            : storno.label,
      stornoRowClass:
        stato === "Da controllare"
          ? "bg-fuchsia-100 hover:bg-fuchsia-200/80"
          : stato === "Stornato"
            ? "bg-rose-100 hover:bg-rose-200/80"
            : storno.rowClassName,
      warnOnEdit: storno.warnOnEdit,
      missingSupplyStart: storno.missingSupplyStart === true,
      gettoneBorderClass: contract.commissionConfirmed
        ? "border-l-4 border-l-emerald-600"
        : "border-l-4 border-l-amber-500",
    };
  });

  const nameById = Object.fromEntries(collaboratorOptions.map((u) => [u.id, u.name]));
  const collabCounts = collabGroups
    .map((g) => ({
      id: g.collaboratorId,
      name: nameById[g.collaboratorId] ?? g.collaboratorId,
      n: g._count.id,
    }))
    .sort((a, b) => b.n - a.n);

  const selectedCollabIds = (collabFilter ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const selectedCollabName =
    selectedCollabIds.length > 0
      ? selectedCollabIds
          .map(
            (id) =>
              nameById[id] ?? collabCounts.find((c) => c.id === id)?.name ?? id,
          )
          .join(" + ")
      : null;

  const alertRows = missing.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    clientName: clientDisplayName(m.contract.client),
    collaboratorName: m.contract.collaborator?.name,
    amount: m.amount != null ? Number(m.amount) : undefined,
  }));
  const tabRecurringCount = vista === "annuale" ? countAnnuali : countMensili;
  const missingContractCount = new Set(alertRows.map((a) => a.contractId)).size;
  const otherRecurringCount = Math.max(0, tabRecurringCount - missingContractCount);
  const monthlyStatusRows =
    vista === "mensile"
      ? await prisma.recurringMonth.findMany({
          where: {
            period: { lte: activeRecurringPeriod },
            status: { not: "CLOSED" },
            contract: {
              AND: [
                activeRecurringWhere,
                { OR: recurringMonthlyWhereOr },
                { isHistorical: false, deletedAt: null },
              ],
            },
          },
          select: { period: true, status: true },
        })
      : [];
  const monthlySummary =
    showCompetencePanel
      ? {
          periodLabel: periodLabel(activeRecurringPeriod),
          activeContracts: countMensili,
          matured: monthlyStatusRows.filter((row) => row.period === activeRecurringPeriod).length,
          paid: monthlyStatusRows.filter(
            (row) => row.period === activeRecurringPeriod && ["PAID", "LIQUIDATED"].includes(row.status),
          ).length,
          currentOpen: monthlyStatusRows.filter(
            (row) => row.period === activeRecurringPeriod && ["MISSING", "PENDING"].includes(row.status),
          ).length,
          arrears: monthlyStatusRows.filter(
            (row) => row.period < activeRecurringPeriod && ["MISSING", "PENDING"].includes(row.status),
          ).length,
        }
      : undefined;

  const heliosAbsentRows = heliosAbsent.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    clientName: clientDisplayName(m.contract.client),
    collaboratorName: m.contract.collaborator.name,
    note: m.note,
  }));

  const settledRows = settledRowsRaw.map(toSettledRow);
  const reconciliationRows = reconciliationRowsRaw.map((row) => ({
    id: row.id,
    contractId: row.contractId,
    clientName: clientDisplayName(row.contract.client),
    podPdr: row.contract.pod || row.contract.pdr || row.contract.podPdr || "",
    supplierName: row.contract.supplier.name,
    amount: Number(row.amount?.toString() ?? row.contract.commission?.expected?.toString() ?? 0),
    status: row.status,
    settledPeriod: row.settledPeriod,
  }));
  const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
  const competenceSummary = competenceStats
    ? competenceSummaryForStato(competenceStats, stato)
    : null;
  const incassatoTotals = competenceStats
    ? incassatoCompetenceTotals(competenceStats)
    : null;
  const queryBase = {
    collab: collabFilter,
    settled: settledPeriod,
    supplier,
    stato,
    tipologia,
    q,
    vista: vista === "tutti" ? undefined : vista,
    focus,
    competence: effectiveCompetence,
    sort: sortByClient ? "client" : undefined,
    dir: sortByClient ? sortDir : undefined,
  };
  const filterHints = [
    selectedCollabName ? `collab. ${selectedCollabName}` : null,
    supplier ? `fornitore ${supplier.split("|").join(" + ")}` : null,
    stato ? `stato ${stato.split("|").join(" + ")}` : null,
    effectiveCompetence ? `competenza ${periodLabel(effectiveCompetence)}` : null,
    tipologia ? `tipologia ${tipologia.split("|").join(" + ")}` : null,
    q ? `cerca «${q}»` : null,
    focus === "da-confermare" ? "solo provvigioni da confermare" : null,
    focus === "ricorrenze-mancanti" ? "solo ricorrenze mancanti" : null,
    vista === "ut"
      ? "scheda UT (gettoni)"
      : vista === "mensile"
        ? "scheda M (mensile)"
        : vista === "annuale"
          ? "scheda R (annuale)"
          : "tutti (UT+M+R)",
  ].filter(Boolean);
  const collabQs = [
    collabFilter ? `collab=${encodeURIComponent(collabFilter)}` : null,
    supplier ? `supplier=${encodeURIComponent(supplier)}` : null,
    stato ? `stato=${encodeURIComponent(stato)}` : null,
    tipologia ? `tipologia=${encodeURIComponent(tipologia)}` : null,
    q ? `q=${encodeURIComponent(q)}` : null,
    vista !== "tutti" ? `vista=${vista}` : null,
    focus ? `focus=${focus}` : null,
  ]
    .filter(Boolean)
    .map((p) => `&${p}`)
    .join("");
  const exportParams = new URLSearchParams();
  exportParams.set("settled", settledPeriod);
  if (collabFilter) exportParams.set("collab", collabFilter);
  if (supplier) exportParams.set("supplier", supplier);
  if (stato) exportParams.set("stato", stato);
  if (tipologia) exportParams.set("tipologia", tipologia);
  if (q) exportParams.set("q", q);
  if (vista !== "tutti") exportParams.set("vista", vista);
  if (focus) exportParams.set("focus", focus);
  if (effectiveCompetence) exportParams.set("competence", effectiveCompetence);
  const exportHref = `/api/provvigioni/export?${exportParams.toString()}`;

  function vistaHref(nextVista: ProvvigioniVista) {
    return `/provvigioni?${new URLSearchParams({
      settled: settledPeriod,
      ...(collabFilter ? { collab: collabFilter } : {}),
      ...(supplier ? { supplier } : {}),
      ...(stato ? { stato } : {}),
      ...(tipologia ? { tipologia } : {}),
      ...(q ? { q } : {}),
      ...(focus ? { focus } : {}),
      ...(effectiveCompetence && (nextVista === "mensile" || nextVista === "annuale")
        ? { competence: effectiveCompetence }
        : {}),
      ...(nextVista !== "tutti" ? { vista: nextVista } : {}),
    }).toString()}`;
  }

  const tabQueryBase: Record<string, string | undefined> = {
    settled: settledPeriod,
    collab: collabFilter,
    supplier,
    tipologia,
    q,
    focus,
    ...(effectiveCompetence && showCompetencePanel
      ? { competence: effectiveCompetence }
      : {}),
  };

  const sortHint = sortByClient
    ? ` Ordinati per cliente A→Z unico (${sortDir === "asc" ? "A→Z" : "Z→A"}), Domestico e Business insieme.`
    : " Ordinati per data inserimento.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {vista === "ut"
              ? "Provvigioni · Gettoni (UT)"
              : vista === "mensile"
                ? "Provvigioni · Ricorrenti mensili (M)"
                : vista === "annuale"
                  ? "Provvigioni · Ricorrenti annuali (R)"
                  : "Provvigioni"}
          </h1>
          <p className="text-sm text-slate-500 sm:text-base">
            {total} contratti in elenco
            {competenceSummary && filterHints.some((h) => h?.includes("competenza"))
              ? stato === "Pagato"
                ? ` · ${competenceSummary.primaryCount} pagate ${formatCurrency(competenceSummary.primaryAmount)}`
                : stato === "Da incassare"
                  ? ` · ${competenceSummary.primaryCount} da incassare ${formatCurrency(competenceSummary.primaryAmount)}`
                  : incassatoTotals
                    ? ` · ${incassatoTotals.count} incassate ${formatCurrency(incassatoTotals.amount)}`
                    : ""
              : ""}
            {filterHints.length
              ? ` · ${filterHints.join(" · ")}`
              : canViewAll
                ? ` · ${roleLabel}`
                : " · solo i tuoi"}
            .
            <span className="hidden sm:inline">
              {sortHint} Max {PAGE_SIZE} per pagina.
              {totals.daConfermare > 0
                ? ` · ${totals.daConfermare} da confermare.`
                : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/archivio#helios-import">
            <Button type="button" variant="secondary">
              Importa Helios
            </Button>
          </Link>
          {canExport ? (
            <a href={exportHref}>
              <Button variant="secondary">Scarica Excel</Button>
            </a>
          ) : null}
        </div>
      </div>

      <ProvvigioniVistaTabs
        active={vista}
        counts={{
          tutti: countTutti,
          ut: countGettoni,
          mensile: countMensili,
          annuale: countAnnuali,
        }}
        queryBase={tabQueryBase}
      />

      {applyCompetenceToList && competenceStats ? (
        <CompetenceMonthPanel
          stats={competenceStats}
          monthOptions={competenceMonthOptions()}
          queryBase={{
            ...tabQueryBase,
            vista: showCompetencePanel ? vista : "mensile",
            ...(stato ? { stato } : {}),
          }}
          activeStato={stato}
        />
      ) : null}

      {statoNeedsCompetence && vista === "tutti" ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          Filtro <strong>{stato}</strong> attivo: stai vedendo le rate del mese{" "}
          <strong>{periodLabel(effectiveCompetence!)}</strong>. Per l&apos;elenco completo
          Helios usa la scheda <strong>M</strong> oppure seleziona il mese nel pannello sopra.
        </p>
      ) : null}

      <ListSearchForm
        action="/provvigioni"
        q={q}
        placeholder="Cerca nome, cognome, CF, POD, telefono, note, fornitore…"
        hidden={{
          collab: collabFilter,
          settled: settledPeriod,
          supplier: supplier || undefined,
          stato: stato || undefined,
          tipologia: tipologia || undefined,
          vista: vista !== "tutti" ? vista : undefined,
          focus,
          competence: effectiveCompetence,
        }}
        clearHref={vistaHref(vista)}
      />

      {canViewAll ? (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/provvigioni?${new URLSearchParams({
              settled: settledPeriod,
              ...(supplier ? { supplier } : {}),
              ...(stato ? { stato } : {}),
              ...(tipologia ? { tipologia } : {}),
              ...(q ? { q } : {}),
              ...(focus ? { focus } : {}),
              ...(vista !== "tutti" ? { vista } : {}),
            }).toString()}`}
            className={
              !collabFilter
                ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-800"
            }
          >
            Tutti i collaboratori ({collabCounts.reduce((s, c) => s + c.n, 0)})
          </Link>
          {collabCounts.map((c) => (
            <Link
              key={c.id}
              href={`/provvigioni?${new URLSearchParams({
                collab: c.id,
                settled: settledPeriod,
                ...(supplier ? { supplier } : {}),
                ...(stato ? { stato } : {}),
                ...(tipologia ? { tipologia } : {}),
                ...(q ? { q } : {}),
                ...(focus ? { focus } : {}),
                ...(vista !== "tutti" ? { vista } : {}),
              }).toString()}`}
              className={
                selectedCollabIds.includes(c.id)
                  ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                  : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-800"
              }
            >
              {c.name} ({c.n})
            </Link>
          ))}
        </div>
      ) : null}

      {showCompetencePanel || focus === "ricorrenze-mancanti" ? (
        <RecurringMissingPanel
          alerts={alertRows}
          otherRecurringCount={otherRecurringCount}
          kind={recurringKind}
          summary={monthlySummary}
        />
      ) : null}

      {vista === "mensile" ? (
        <RecurringReconciliationPanel
          competencePeriod={reconciliationPeriod}
          settledPeriod={settledPeriod}
          rows={reconciliationRows}
          supplierLabel={supplier ? supplier.split("|").join(" + ") : "Tutti i fornitori"}
          filteredContractCount={total}
          filterQuery={{
            supplier,
            stato,
            collab: collabFilter,
            competence: effectiveCompetence,
          }}
        />
      ) : null}

      {vista === "mensile" ? <HeliosAbsentPanel alerts={heliosAbsentRows} /> : null}

      <ProvvigioniTrashPanel
        rows={deletedRecent.map((c) => ({
          id: c.id,
          clientName: clientDisplayName(c.client),
          supplierName: c.supplier.name,
          collaboratorName: c.collaborator.name,
          podPdr: c.podPdr || "",
          deletedAt: c.deletedAt?.toISOString() ?? "",
        }))}
      />

      <RecurringRendicontoPanel
        settledPeriod={settledPeriod}
        rows={settledRows}
        collabQuery={collabQs}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Contratti in elenco
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{total}</p>
          <p className="mt-1 text-xs text-slate-500">Con filtri attivi</p>
        </div>
        {competenceSummary ? (
          <>
            <div
              className={`rounded-xl border p-4 shadow-sm ${
                competenceSummary.primaryTone === "indigo"
                  ? "border-indigo-200 bg-indigo-50"
                  : competenceSummary.primaryTone === "amber"
                    ? "border-amber-200 bg-amber-50"
                    : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-wide ${
                  competenceSummary.primaryTone === "indigo"
                    ? "text-indigo-800"
                    : competenceSummary.primaryTone === "amber"
                      ? "text-amber-800"
                      : "text-emerald-800"
                }`}
              >
                {competenceSummary.primaryLabel} {periodLabel(competenceStats!.period)}
              </p>
              <p
                className={`mt-2 text-3xl font-bold ${
                  competenceSummary.primaryTone === "indigo"
                    ? "text-indigo-900"
                    : competenceSummary.primaryTone === "amber"
                      ? "text-amber-950"
                      : "text-emerald-900"
                }`}
              >
                {competenceSummary.primaryCount}
              </p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  competenceSummary.primaryTone === "indigo"
                    ? "text-indigo-800"
                    : competenceSummary.primaryTone === "amber"
                      ? "text-amber-800"
                      : "text-emerald-800"
                }`}
              >
                {formatCurrency(competenceSummary.primaryAmount)}
              </p>
            </div>
            {competenceSummary.secondaryLabel ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  {competenceSummary.secondaryLabel} {periodLabel(competenceStats!.period)}
                </p>
                <p className="mt-2 text-3xl font-bold text-amber-950">
                  {competenceSummary.secondaryCount}
                </p>
                <p className="mt-1 text-sm font-semibold text-amber-800">
                  {formatCurrency(competenceSummary.secondaryAmount)}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Totale gettoni
              </p>
              <p className="mt-2 text-3xl font-bold">{formatCurrency(totals.complessivo)}</p>
              <p className="mt-1 text-xs text-slate-500">Incassato + da incassare</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Da incassare
              </p>
              <p className="mt-2 text-3xl font-bold text-amber-950">
                {formatCurrency(totals.daIncassare)}
              </p>
              <p className="mt-1 text-xs text-amber-800/70">Senza incasso registrato</p>
            </div>
          </>
        )}
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
            {vista === "ut"
              ? "Gettoni UT"
              : vista === "annuale"
                ? "Ricorrenti R"
                : vista === "mensile"
                  ? "Ricorrenti M"
                  : "Complessivo"}
          </p>
          <p className="mt-2 text-3xl font-bold text-sky-950">
            {competenceSummary
              ? formatCurrency(competenceSummary.overallAmount)
              : competenceStats
                ? formatCurrency(
                    incassatoTotals!.amount + competenceStats.missingAmount,
                  )
                : formatCurrency(totals.ricorrenti || totals.complessivo)}
          </p>
          <p className="mt-1 text-xs text-sky-800/70">
            {vista === "ut"
              ? `${countGettoni} contratti UT`
              : competenceSummary || competenceStats
                ? `${total} contratti con filtri attivi`
                : vista === "mensile"
                  ? `${countMensili} contratti M attivi`
                  : vista === "annuale"
                    ? `${countAnnuali} contratti R attivi`
                    : `${countTutti} contratti totali`}
          </p>
        </div>
      </div>

      <PaginationNav
        path="/provvigioni"
        page={page}
        total={total}
        query={queryBase}
        loadedCount={rows.length}
      />

      <ProvvigioniFilterTable
        rows={rows}
        canDelete
        canConfirm={canConfirm}
        listQuery={{
          collab: collabFilter,
          settled: settledPeriod,
          supplier,
          stato,
          tipologia,
          q,
          vista: vista === "tutti" ? undefined : vista,
          focus,
          competence: effectiveCompetence,
        }}
        serverSortKey={sortByClient ? "client" : null}
        serverSortDir={sortDir}
        page={page}
        collaboratorByName={
          canViewAll
            ? Object.fromEntries(collaboratorOptions.map((u) => [u.name, u.id]))
            : undefined
        }
        supplierNames={supplierOptions.map((s) => s.name)}
      />

      <PaginationNav
        path="/provvigioni"
        page={page}
        total={total}
        query={queryBase}
        loadedCount={rows.length}
      />
    </div>
  );
}
