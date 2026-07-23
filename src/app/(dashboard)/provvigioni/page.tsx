import { format } from "date-fns";
import { it } from "date-fns/locale";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatCurrency } from "@/lib/commission";
import { clientDisplayName } from "@/lib/utils";
import {
  ProvvigioniFilterTable,
  type ProvvigioneRow,
} from "@/components/provvigioni/provvigioni-filter-table";

/** Solo "Incassato" scritto esplicitamente. Default: Da incassare (mai inferire da importi). */
function normalizePaymentStatus(pay: string | null | undefined): string {
  const raw = (pay ?? "").trim();
  if (/^incassato$/i.test(raw)) return "Incassato";
  return "Da incassare";
}

export default async function ProvvigioniPage() {
  const session = await requireSession();
  const canViewAll = hasPermission(session.role, "commissions.view_all");

  const commissions = await prisma.commission.findMany({
    where: canViewAll ? {} : { contract: { collaboratorId: session.id } },
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
    const paidLabel = normalizePaymentStatus(item.contract.paymentStatus);
    // Mese/anno solo se Incassato + data reale. Niente date inventate / gialle.
    const collectionMonth =
      paidLabel === "Incassato" && item.contract.collectionDate
        ? format(new Date(item.contract.collectionDate), "MMM yyyy", { locale: it })
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Provvigioni</h1>
        <p className="text-slate-500">
          Celle editabili: salva con Invio o clic fuori. Scrivi &quot;Incassato&quot; o &quot;Da
          incassare&quot; nella colonna pagato.
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
