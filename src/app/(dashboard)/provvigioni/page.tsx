import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
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

export const dynamic = "force-dynamic";

export default async function ProvvigioniPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "commissions.view_all");
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
            clientId: true,
            paymentStatus: true,
            recurrence: true,
            podPdr: true,
            collectionDate: true,
            commissionConfirmed: true,
            client: {
              select: {
                type: true,
                companyName: true,
                firstName: true,
                lastName: true,
              },
            },
            collaborator: { select: { name: true } },
            supplier: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 150,
    }),
    getMissingRecurringAlerts(collabFilter),
  ]);

  const totals = commissions.reduce(
    (acc, item) => {
      const expected = Number(item.expected);
      const received = Number(item.received);
      const paidAmt = Number(item.paid);
      acc.complessivo += expected;
      acc.ricevuto += received;
      acc.liquidato += paidAmt;
      acc.daAvere += Math.max(received - paidAmt, 0);
      return acc;
    },
    { complessivo: 0, ricevuto: 0, liquidato: 0, daAvere: 0 },
  );

  const rows: ProvvigioneRow[] = commissions.map((item) => {
    // Senza data = non pagato (No). Con data = pagato (Sì).
    const hasDate = Boolean(item.contract.collectionDate);
    const paidLabel = hasDate ? "Incassato" : "Da incassare";
    const collectionMonth = hasDate
      ? formatMonthYear(item.contract.collectionDate)
      : "";

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
          Clicca sul nome colonna per ordinare (A→Z / date). Senza data = No. Gettoni storici:
          50 domestico / 80 business.
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

      <ProvvigioniFilterTable rows={rows} canDelete />
    </div>
  );
}
