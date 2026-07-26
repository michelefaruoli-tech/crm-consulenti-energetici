import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { ClientsFilterTable } from "@/components/clients/clients-filter-table";
import { StornoLegend } from "@/components/ui/storno-legend";
import {
  isRecurring,
  markEarlyReswitchContracts,
  markLatestContractsByPod,
  resolveClientRowStyle,
  resolveStornoInfo,
} from "@/lib/storno-status";

export const dynamic = "force-dynamic";

/** Contratti con R/G = R (ricorrente mensile). */
const recurringContractFilter = {
  deletedAt: null as null,
  OR: [
    { recurrence: { equals: "R", mode: "insensitive" as const } },
    { recurrence: { contains: "Ricor", mode: "insensitive" as const } },
    { recurrence: { contains: "mensil", mode: "insensitive" as const } },
  ],
};

export default async function ClientiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ricorrenza?: string }>;
}) {
  const session = await requireSession();
  const { q, ricorrenza } = await searchParams;
  const onlyRecurring =
    ricorrenza === "1" ||
    ricorrenza === "si" ||
    ricorrenza === "sì" ||
    ricorrenza === "yes";
  const canViewAll = hasPermission(session.role, "clients.edit_all");

  try {
    const clients = await prisma.client.findMany({
      where: {
        deletedAt: null,
        ...(canViewAll ? {} : { createdById: session.id }),
        ...(onlyRecurring
          ? {
              contracts: {
                some: recurringContractFilter,
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { companyName: { contains: q, mode: "insensitive" } },
                { fiscalCode: { contains: q, mode: "insensitive" } },
                { vatNumber: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        type: true,
        firstName: true,
        lastName: true,
        companyName: true,
        fiscalCode: true,
        vatNumber: true,
        phone: true,
        email: true,
        city: true,
        _count: {
          select: {
            contracts: {
              where: { deletedAt: null },
            },
          },
        },
        contracts: {
          where: { deletedAt: null },
          select: {
            id: true,
            clientId: true,
            status: true,
            recurrence: true,
            podPdr: true,
            supplyStartDate: true,
            insertionDate: true,
            createdAt: true,
            collectionDate: true,
            stornoEndDate: true,
            expiryDate: true,
            durationMonths: true,
            supplierId: true,
            supplier: { select: { stornoMonths: true } },
          },
        },
        createdBy: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Tutti i contratti della pagina (serve per ricambio / POD più recente)
    const allContracts = clients.flatMap((c) =>
      c.contracts.map((ct) => ({
        id: ct.id,
        clientId: ct.clientId,
        supplierId: ct.supplierId,
        podPdr: ct.podPdr,
        supplyStartDate: ct.supplyStartDate,
        insertionDate: ct.insertionDate,
        createdAt: ct.createdAt,
        collectionDate: ct.collectionDate,
        stornoMonths: ct.supplier.stornoMonths,
        stornoEndDate: ct.stornoEndDate,
      })),
    );
    const latestByPod = markLatestContractsByPod(allContracts);
    const earlyReswitch = markEarlyReswitchContracts(allContracts);

    const rows = clients.map((c) => {
      const infos = c.contracts.map((ct) =>
        resolveStornoInfo({
          status: ct.status,
          recurrence: ct.recurrence,
          supplyStartDate: ct.supplyStartDate,
          stornoMonths: ct.supplier.stornoMonths,
          stornoEndDate: ct.stornoEndDate,
          expiryDate: ct.expiryDate,
          durationMonths: ct.durationMonths,
          collectionDate: ct.collectionDate,
          isLatestForPod: latestByPod.get(ct.id) ?? true,
          isEarlyReswitch: earlyReswitch.get(ct.id) ?? false,
        }),
      );
      const style = resolveClientRowStyle(infos);
      const hasRecurring = c.contracts.some((ct) => isRecurring(ct.recurrence));

      return {
        id: c.id,
        name: clientDisplayName(c),
        type: c.type === "AZIENDA" ? "Business" : "Privato",
        fiscalCode: c.fiscalCode || c.vatNumber || "—",
        phone: c.phone || "—",
        email: c.email || "—",
        city: c.city || "—",
        contracts: String(c._count.contracts),
        ricorrenza: hasRecurring ? "R" : "—",
        createdBy: c.createdBy.name,
        rowClassName: style.rowClassName,
        stornoLabel: style.label,
        stornoKind: style.kind,
        nameAlert: style.kind === "in_scadenza",
      };
    });

    const qParam = q ? `&q=${encodeURIComponent(q)}` : "";

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {onlyRecurring ? "Clienti a ricorrenza" : "Clienti"}
            </h1>
            <p className="text-slate-500">
              {onlyRecurring
                ? "Clienti con almeno un contratto R (ricorrente) in Provvigioni"
                : "Clicca sul nome (verde) o sulla riga per aprire anagrafica e contratti"}
            </p>
          </div>
          {hasPermission(session.role, "clients.create") ? (
            <Link href="/clienti/nuovo">
              <Button>Nuovo cliente</Button>
            </Link>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/clienti${q ? `?q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              !onlyRecurring
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Tutti
          </Link>
          <Link
            href={`/clienti?ricorrenza=1${qParam}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              onlyRecurring
                ? "bg-teal-700 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            A ricorrenza
          </Link>
        </div>

        <StornoLegend />

        <form className="flex gap-3">
          {onlyRecurring ? (
            <input type="hidden" name="ricorrenza" value="1" />
          ) : null}
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Cerca nome, CF, P.IVA, email, telefono..."
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <Button type="submit" variant="secondary">
            Cerca
          </Button>
        </form>

        <ClientsFilterTable rows={rows} canDelete showRicorrenza />
      </div>
    );
  } catch (error) {
    console.error("Clienti error", error);
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-lg font-semibold">Errore clienti</h1>
        <p className="mt-2 text-sm">
          {error instanceof Error ? error.message : "Errore sconosciuto"}
        </p>
      </div>
    );
  }
}
