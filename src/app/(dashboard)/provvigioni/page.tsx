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

function normalizePaymentStatus(pay: string | null | undefined, received: number): string {
  const raw = (pay ?? "").trim();
  if (/incass/i.test(raw)) return "Incassato";
  if (/attesa|da.?incass/i.test(raw)) return "In attesa";
  if (raw) return raw;
  return received > 0 ? "Incassato" : "In attesa";
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
    const received = Number(item.received);
    const paidLabel = normalizePaymentStatus(item.contract.paymentStatus, received);
    const collectionMonth = item.contract.collectionDate
      ? format(new Date(item.contract.collectionDate), "MMM yyyy", { locale: it })
      : paidLabel === "Incassato"
        ? format(new Date(), "MMM yyyy", { locale: it })
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
          Le modifiche alle celle editabili (POD/PDR, gettone, ricorrenza, pagato) si salvano subito:
          premi Invio oppure clicca fuori dalla cella. Non serve un tasto Salva.
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
