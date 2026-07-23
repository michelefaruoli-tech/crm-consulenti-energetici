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

  const collaborators = canPickCollaborator
    ? await prisma.user.findMany({
        where: {
          active: true,
          role: { in: ["COLLABORATORE", "COMMERCIALE", "ADMIN", "SEGRETERIA"] },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [{ id: session.id, name: session.name }];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Nuovo contratto</h1>
        <p className="text-slate-500">
          Autocomplete clienti/fornitori · durata 12 mesi automatica · invio al Master opzionale
        </p>
      </div>
      <NuovoContrattoForm
        session={{ id: session.id, name: session.name, role: session.role }}
        collaborators={collaborators}
        canPickCollaborator={canPickCollaborator}
        initialClientId={clientId}
      />
    </div>
  );
}
