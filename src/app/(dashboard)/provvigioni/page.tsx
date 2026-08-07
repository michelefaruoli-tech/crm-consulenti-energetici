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
import { RecurringToLiquidatePanel } from "@/components/provvigioni/recurring-to-liquidate-panel";
import { HeliosAbsentPanel } from "@/components/provvigioni/helios-absent-panel";
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
  getPaidToLiquidateAlerts,
  syncAllRecurringMonths,
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
  sumProvvigioniTotals,
} from "@/lib/provvigioni-filters";
import { toPeriod, isRecurring } from "@/lib/recurring";
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
  /** Incassato | Da incassare | KO / Cessato */
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
  // Default = tutti. Tab: mensile (M) | annuale (R). Legacy «ricorrente» → mensile.
  const vista =
    vistaRaw === "annuale"
      ? "annuale"
      : vistaRaw === "mensile" || vistaRaw === "ricorrente"
        ? "mensile"
        : "tutti";
  const recurrenceMode =
    vista === "mensile" ? "monthly" : vista === "annuale" ? "annual" : "all";
  const recurringKind = vista === "annuale" ? "annual" : "monthly";

  const contractWhere = buildProvvigioniContractWhere({
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
  });
  const collabFilter =
    (canViewAll || isScoped) && collab && collab !== "tutti" ? collab : undefined;
  const sessionCollabFilter = isScoped
    ? undefined
    : canViewAll
      ? collabFilter
      : session.id;
  const settledPeriod =
    settledRaw && /^\d{4}-\d{2}$/.test(settledRaw) ? settledRaw : toPeriod(new Date());

  const sortByClient = sortRaw === "client";
  const sortDir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";

  const defaultOrderBy: Prisma.ContractOrderByWithRelationInput[] = [
    { insertionDate: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ];

  // Sync ricorrenze in background: non bloccare il caricamento della pagina
  void syncAllRecurringMonths(sessionCollabFilter).catch((e) =>
    console.error("sync recurring", e),
  );

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
      select: { period: true, status: true },
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
    toLiquidate,
    heliosAbsent,
    collabGroups,
    settledRowsRaw,
    deletedRecent,
    countGettoni,
    countMensili,
    countAnnuali,
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
            role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true, active: true },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { active: true },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    getMissingRecurringAlerts(sessionCollabFilter, recurringKind),
    getPaidToLiquidateAlerts(sessionCollabFilter, recurringKind),
    getHeliosAbsentAlerts(sessionCollabFilter),
    canViewAll
      ? prisma.contract.groupBy({
          by: ["collaboratorId"],
          where: buildProvvigioniContractWhere({
            canViewAll: canViewAll || isScoped,
            sessionUserId: session.id,
            supplier,
            stato,
            tipologia,
            q,
            recurrenceMode,
            visibility,
          }),
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
    prisma.contract.count({
      where: buildProvvigioniContractWhere({
        canViewAll: canViewAll || isScoped,
        sessionUserId: session.id,
        collab,
        supplier,
        stato,
        tipologia,
        q,
        recurrenceMode: "exclude",
        visibility,
      }),
    }),
    prisma.contract.count({
      where: buildProvvigioniContractWhere({
        canViewAll: canViewAll || isScoped,
        sessionUserId: session.id,
        collab,
        supplier,
        stato,
        tipologia,
        q,
        recurrenceMode: "monthly",
        visibility,
      }),
    }),
    prisma.contract.count({
      where: buildProvvigioniContractWhere({
        canViewAll: canViewAll || isScoped,
        sessionUserId: session.id,
        collab,
        supplier,
        stato,
        tipologia,
        q,
        recurrenceMode: "annual",
        visibility,
      }),
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
      !["KO", "ANNULLATO", "CHIUSO", "DA_CONTROLLARE"].includes(c.status)
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
    const hasDate = Boolean(effectiveCollection);
    const paidLabel = hasDate ? "Incassato" : "Da incassare";
    // Colonna Incasso: solo pagamento reale. Se non in fornitura, mostra
    // la data ingresso come nota (attivazione prevista), non come incasso.
    const collectionMonth = hasDate
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
      inFornitura,
    });

    const lastPaidNote = isRecurring(contract.recurrence)
      ? lastRecurringIncassoNote(contract.recurringMonths, stato)
      : "";
    const recurringIncassoNote = [activationNote, lastPaidNote]
      .filter(Boolean)
      .join(" · ") || undefined;

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
        effectiveGettone({
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
          : storno.label,
      stornoRowClass:
        stato === "Da controllare"
          ? "bg-fuchsia-100 hover:bg-fuchsia-200/80"
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

  const selectedCollabName = collabFilter
    ? nameById[collabFilter] ?? collabCounts.find((c) => c.id === collabFilter)?.name
    : null;

  const alertRows = missing.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    clientName: clientDisplayName(m.contract.client),
    collaboratorName: m.contract.collaborator?.name,
  }));
  const toLiquidateRows = toLiquidate.map((m) => ({
    id: m.id,
    period: m.period,
    settledPeriod: m.settledPeriod,
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
  const roleLabel = ROLE_LABELS[session.role as AppRole] ?? session.role;
  const queryBase = {
    collab: collabFilter,
    settled: settledPeriod,
    supplier,
    stato,
    tipologia,
    q,
    vista: vista === "tutti" ? undefined : vista,
    sort: sortByClient ? "client" : undefined,
    dir: sortByClient ? sortDir : undefined,
  };
  const filterHints = [
    selectedCollabName ? `collab. ${selectedCollabName}` : null,
    supplier ? `fornitore ${supplier}` : null,
    stato ? `stato ${stato}` : null,
    tipologia ? `tipologia ${tipologia}` : null,
    q ? `cerca «${q}»` : null,
    vista === "mensile"
      ? "scheda Mensile (M)"
      : vista === "annuale"
        ? "scheda Annuale (R)"
        : "tutti (gettoni+M+R)",
  ].filter(Boolean);
  const collabQs = [
    collabFilter ? `collab=${encodeURIComponent(collabFilter)}` : null,
    supplier ? `supplier=${encodeURIComponent(supplier)}` : null,
    stato ? `stato=${encodeURIComponent(stato)}` : null,
    tipologia ? `tipologia=${encodeURIComponent(tipologia)}` : null,
    q ? `q=${encodeURIComponent(q)}` : null,
    vista !== "tutti" ? `vista=${vista}` : null,
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
  const exportHref = `/api/provvigioni/export?${exportParams.toString()}`;

  function vistaHref(nextVista: "mensile" | "annuale" | "tutti") {
    return `/provvigioni?${new URLSearchParams({
      settled: settledPeriod,
      ...(collabFilter ? { collab: collabFilter } : {}),
      ...(supplier ? { supplier } : {}),
      ...(stato ? { stato } : {}),
      ...(tipologia ? { tipologia } : {}),
      ...(q ? { q } : {}),
      ...(nextVista !== "tutti" ? { vista: nextVista } : {}),
    }).toString()}`;
  }

  const sortHint = sortByClient
    ? ` Ordinati per cliente A→Z unico (${sortDir === "asc" ? "A→Z" : "Z→A"}), Domestico e Business insieme.`
    : " Ordinati per data inserimento.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
            {vista === "mensile"
              ? "Provvigioni · Ricorrenti mensili"
              : vista === "annuale"
                ? "Provvigioni · Ricorrenti annuali"
                : "Provvigioni"}
          </h1>
          <p className="text-sm text-slate-500 sm:text-base">
            {total} contratti
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

      <div className="flex flex-wrap gap-2">
        <Link
          href={vistaHref("tutti")}
          className={
            vista === "tutti"
              ? "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          }
        >
          Tutti ({vista === "tutti" ? total : countGettoni + countMensili + countAnnuali})
        </Link>
        <Link
          href={vistaHref("mensile")}
          className={
            vista === "mensile"
              ? "rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-950 hover:bg-teal-100"
          }
        >
          Ricorrenti mensili ({countMensili})
        </Link>
        <Link
          href={vistaHref("annuale")}
          className={
            vista === "annuale"
              ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-950 hover:bg-indigo-100"
          }
        >
          Ricorrenti annuali ({countAnnuali})
        </Link>
      </div>

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
                ...(vista !== "tutti" ? { vista } : {}),
              }).toString()}`}
              className={
                collabFilter === c.id
                  ? "rounded-lg bg-slate-800 px-3 py-1.5 text-white"
                  : "rounded-lg bg-slate-100 px-3 py-1.5 text-slate-800"
              }
            >
              {c.name} ({c.n})
            </Link>
          ))}
        </div>
      ) : null}

      {vista === "mensile" || vista === "annuale" ? (
        <>
          <RecurringMissingPanel
            alerts={alertRows}
            otherRecurringCount={otherRecurringCount}
            kind={recurringKind}
          />
          <RecurringToLiquidatePanel alerts={toLiquidateRows} kind={recurringKind} />
        </>
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Complessivo</p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.complessivo)}</p>
          <p className="mt-1 text-xs text-slate-400">
            Incassato + da incassare (tutto il filtro)
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-sm text-amber-800">Da incassare</p>
          <p className="mt-2 text-2xl font-bold text-amber-950">
            {formatCurrency(totals.daIncassare)}
          </p>
          <p className="mt-1 text-xs text-amber-800/70">
            Senza data incasso e non KO/cessato · somma gettoni
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <p className="text-sm text-sky-800">
            {vista === "annuale" ? "Ricorrenti annuali" : "Ricorrenti mensili"}
          </p>
          <p className="mt-2 text-2xl font-bold text-sky-950">
            {formatCurrency(totals.ricorrenti)}
          </p>
          <p className="mt-1 text-xs text-sky-800/70">
            Solo contratti ricorrenti del filtro · somma gettoni
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
