import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canConfirmCommission, hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { formatMonthYear } from "@/lib/date-parse";
import { clientDisplayName } from "@/lib/utils";
import {
  ProvvigioniFilterTable,
  type ProvvigioneRow,
} from "@/components/provvigioni/provvigioni-filter-table";
import { RecurringMissingPanel } from "@/components/provvigioni/recurring-missing-panel";
import {
  getMissingRecurringAlerts,
  syncAllRecurringMonths,
} from "@/lib/recurring-sync";
import {
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveStornoInfo,
} from "@/lib/storno-status";
import { computeSupplyStartDate } from "@/lib/supply-dates";

export const dynamic = "force-dynamic";

export default async function ProvvigioniPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const canConfirm = canConfirmCommission(session.role);
  const collabFilter = canViewAll ? undefined : session.id;

  // Sync ricorrenze in background non bloccante (evita attese di molti secondi)
  void syncAllRecurringMonths(collabFilter).catch((e) =>
    console.error("sync recurring", e),
  );

  const [commissions, missing] = await Promise.all([
    prisma.commission.findMany({
    where: canViewAll
      ? { contract: { isHistorical: false, deletedAt: null } }
      : { contract: { collaboratorId: session.id, isHistorical: false, deletedAt: null } },
      select: {
        id: true,
        expected: true,
        received: true,
        paid: true,
        contractId: true,
        contract: {
          select: {
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
            client: {
              select: {
                type: true,
                companyName: true,
                firstName: true,
                lastName: true,
              },
            },
            collaborator: { select: { name: true } },
            supplier: { select: { id: true, name: true, stornoMonths: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 150,
    }),
    getMissingRecurringAlerts(collabFilter),
  ]);

  const latestMap = markLatestContractsByPod(
    commissions.map((c) => ({
      id: c.contract.id,
      clientId: c.contract.clientId,
      supplierId: c.contract.supplierId,
      podPdr: c.contract.podPdr || c.contract.pod || c.contract.pdr,
      supplyStartDate: c.contract.supplyStartDate,
      insertionDate: c.contract.insertionDate,
      createdAt: c.contract.createdAt,
    })),
  );
  const earlyMap = markEarlyReswitchContracts(
    commissions.map((c) => ({
      id: c.contract.id,
      clientId: c.contract.clientId,
      supplierId: c.contract.supplierId,
      podPdr: c.contract.podPdr || c.contract.pod || c.contract.pdr,
      supplyStartDate: c.contract.supplyStartDate,
      insertionDate: c.contract.insertionDate,
      createdAt: c.contract.createdAt,
      collectionDate: c.contract.collectionDate,
      stornoMonths: c.contract.supplier.stornoMonths,
      stornoEndDate: c.contract.stornoEndDate,
    })),
  );

  const totals = commissions.reduce(
    (acc, item) => {
      const expected = Number(item.expected);
      const received = Number(item.received);
      const paidAmt = Number(item.paid);
      acc.complessivo += expected;
      acc.ricevuto += received;
      acc.liquidato += paidAmt;
      acc.daAvere += Math.max(received - paidAmt, 0);
      if (!item.contract.commissionConfirmed) acc.daConfermare += 1;
      return acc;
    },
    { complessivo: 0, ricevuto: 0, liquidato: 0, daAvere: 0, daConfermare: 0 },
  );

  const rows: ProvvigioneRow[] = commissions.map((item) => {
    // Senza data = non pagato (No). Con data = pagato (Sì).
    const hasDate = Boolean(item.contract.collectionDate);
    const paidLabel = hasDate ? "Incassato" : "Da incassare";
    const collectionMonth = hasDate
      ? formatMonthYear(item.contract.collectionDate)
      : "";

    const supply =
      item.contract.supplyStartDate ??
      computeSupplyStartDate(item.contract.insertionDate, item.contract.operationType);
    const storno = resolveStornoInfo({
      status: item.contract.status,
      recurrence: item.contract.recurrence,
      supplyStartDate: supply,
      stornoMonths: item.contract.supplier.stornoMonths,
      stornoEndDate: item.contract.stornoEndDate,
      expiryDate: item.contract.expiryDate,
      durationMonths: item.contract.durationMonths,
      isLatestForPod: latestMap.get(item.contract.id) ?? true,
      collectionDate: item.contract.collectionDate,
      isEarlyReswitch: earlyMap.get(item.contract.id) ?? false,
    });

    return {
      id: item.contractId,
      clientId: item.contract.clientId,
      commissionId: item.id,
      clientName: clientDisplayName(item.contract.client),
      podPdr: item.contract.podPdr || "",
      collaboratorName: item.contract.collaborator.name,
      supplierName: item.contract.supplier.name,
      clientType: item.contract.client.type === "AZIENDA" ? "Business" : "Domestico",
      amount: String(Number(item.expected)),
      recurrence: item.contract.recurrence || "Una tantum",
      paymentStatus: paidLabel,
      confirmed: item.contract.commissionConfirmed ? "Confermata" : "Da confermare",
      collectionMonth,
      stornoLabel: storno.label,
      stornoRowClass: storno.rowClassName,
      warnOnEdit: storno.warnOnEdit,
      gettoneBorderClass: item.contract.commissionConfirmed
        ? "border-l-4 border-l-emerald-600"
        : "border-l-4 border-l-amber-500",
    };
  });

  const alertRows = missing.map((m) => ({
    id: m.id,
    period: m.period,
    contractId: m.contractId,
    podPdr: m.contract.podPdr || "",
    supplierName: m.contract.supplier.name,
    clientName: clientDisplayName(m.contract.client),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Provvigioni</h1>
        <p className="text-slate-500">
          Colori riga = storno. Bordo sinistro = gettone (ambra da confermare / verde confermato).
          {totals.daConfermare > 0
            ? ` · ${totals.daConfermare} gettoni da confermare.`
            : ""}
        </p>
      </div>

      <RecurringMissingPanel alerts={alertRows} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Totale complessivo (previsto)</p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.complessivo)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Totale ricevuto</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">
            {formatCurrency(totals.ricevuto)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Totale liquidato</p>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totals.liquidato)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-sm text-amber-800">Totale da avere</p>
          <p className="mt-2 text-2xl font-bold text-amber-950">
            {formatCurrency(totals.daAvere)}
          </p>
        </div>
      </div>

      <ProvvigioniFilterTable
        rows={rows}
        canDelete
        canConfirm={canConfirm}
      />
    </div>
  );
}
