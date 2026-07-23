import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import {
  ProvvigioniFilterTable,
  type ProvvigioneRow,
} from "@/components/provvigioni/provvigioni-filter-table";

export default async function ProvvigioniPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "commissions.view_all");

  const commissions = await prisma.commission.findMany({
    where: canViewAll ? {} : { contract: { collaboratorId: session.id } },
    include: {
      contract: {
        include: {
          client: true,
          collaborator: { select: { name: true } },
          supplier: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const totals = commissions.reduce(
    (acc, item) => {
      const expected = Number(item.expected);
      const received = Number(item.received);
      const paid = Number(item.paid);
      acc.complessivo += expected;
      acc.ricevuto += received;
      acc.liquidato += paid;
      acc.daAvere += Math.max(received - paid, 0);
      return acc;
    },
    { complessivo: 0, ricevuto: 0, liquidato: 0, daAvere: 0 },
  );

  const rows: ProvvigioneRow[] = commissions.map((item) => {
    const pay = item.contract.paymentStatus || "";
    const paidLabel = pay
      ? pay
      : Number(item.received) > 0
        ? "incassato"
        : "da_incassare";

    return {
      id: item.contractId,
      commissionId: item.id,
      collaboratorName: item.contract.collaborator.name,
      supplierName: item.contract.supplier.name,
      clientType: item.contract.client.type === "AZIENDA" ? "Business" : "Domestico",
      amount: String(Number(item.expected)),
      recurrence: item.contract.recurrence || "Una tantum",
      paymentStatus: paidLabel,
      confirmed: item.contract.commissionConfirmed ? "Confermata" : "Da confermare",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Provvigioni</h1>
        <p className="text-slate-500">
          Filtra stile Excel · clicca una cella editabile e modifica (blur per salvare)
        </p>
      </div>

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

      <ProvvigioniFilterTable rows={rows} />
    </div>
  );
}
