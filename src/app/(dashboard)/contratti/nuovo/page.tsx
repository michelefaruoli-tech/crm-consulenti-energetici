import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { NuovoContrattoForm } from "@/components/contracts/nuovo-contratto-form";

export const dynamic = "force-dynamic";

export default async function NuovoContrattoPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.create")) redirect("/contratti");
  const { clientId } = await searchParams;
  const canPickCollaborator = hasPermission(session.role, "contracts.edit_all");

  const [collaborators, suppliers, listinoRulesRaw] = await Promise.all([
    canPickCollaborator
      ? prisma.user.findMany({
          where: {
            active: true,
            role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([{ id: session.id, name: session.name }]),
    prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.commissionRule.findMany({
      where: { active: true },
      select: {
        id: true,
        supplierId: true,
        name: true,
        clientSegment: true,
        fixedAmount: true,
        gettoneBase: true,
        gettoneRid: true,
        gettoneBollettaWeb: true,
        gettoneMail: true,
        gettoneUnaTantumIniziale: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const listinoRules = listinoRulesRaw.map((r) => {
    const n = (v: { toString(): string } | null | undefined) =>
      v == null ? 0 : Number(v.toString()) || 0;
    const hasParts =
      r.gettoneBase != null ||
      r.gettoneRid != null ||
      r.gettoneBollettaWeb != null ||
      r.gettoneMail != null ||
      r.gettoneUnaTantumIniziale != null;
    const base = hasParts ? n(r.gettoneBase) : n(r.fixedAmount) || n(r.gettoneBase);
    const totale =
      base +
      n(r.gettoneRid) +
      n(r.gettoneBollettaWeb) +
      n(r.gettoneMail) +
      n(r.gettoneUnaTantumIniziale);
    return {
      id: r.id,
      supplierId: r.supplierId,
      name: r.name,
      clientSegment: r.clientSegment || "TUTTI",
      gettoneTotale: totale > 0 ? totale.toFixed(2) : "",
      hasRid: n(r.gettoneRid) > 0,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Nuovo contratto</h1>
        <p className="text-sm text-slate-500 sm:text-base">
          Cerca o crea il cliente, compila i 3 blocchi servizio, poi salva dal pulsante in basso.
        </p>
      </div>
      <NuovoContrattoForm
        session={{ id: session.id, name: session.name, role: session.role }}
        collaborators={collaborators}
        canPickCollaborator={canPickCollaborator}
        suppliers={suppliers}
        listinoRules={listinoRules}
        initialClientId={clientId}
      />
    </div>
  );
}
