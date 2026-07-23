import { createContractAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PAYMENT_TYPE_LABELS } from "@/lib/constants";

export default async function NuovoContrattoPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "contracts.create")) redirect("/contratti");
  const { clientId } = await searchParams;

  const [clients, suppliers, collaborators] = await Promise.all([
    prisma.client.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.supplier.findMany({
      where: { active: true },
      include: { services: true, commissionRules: { where: { active: true } } },
    }),
    hasPermission(session.role, "contracts.edit_all")
      ? prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Nuovo contratto</h1>
        <p className="text-slate-500">Inserimento pratica e calcolo provvigione prevista</p>
      </div>

      <form action={createContractAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="Cliente">
          <Select name="clientId" required defaultValue={clientId ?? ""}>
            <option value="">Seleziona cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {clientDisplayName(client)}
              </option>
            ))}
          </Select>
        </Field>

        {collaborators.length > 0 ? (
          <Field label="Collaboratore">
            <Select name="collaboratorId" defaultValue={session.id}>
              {collaborators.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Fornitore">
          <Select name="supplierId" required>
            <option value="">Seleziona fornitore</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Servizio">
          <Select name="serviceId">
            <option value="">Opzionale</option>
            {suppliers.flatMap((supplier) =>
              supplier.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {supplier.name} · {service.name}
                </option>
              )),
            )}
          </Select>
        </Field>

        <Field label="Regola provvigionale">
          <Select name="commissionRuleId">
            <option value="">Seleziona regola</option>
            {suppliers.flatMap((supplier) =>
              supplier.commissionRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {supplier.name} · {rule.name} · €{Number(rule.fixedAmount ?? 0)} · {PAYMENT_TYPE_LABELS[rule.paymentType]}
                </option>
              )),
            )}
          </Select>
        </Field>

        <Field label="Data scadenza">
          <Input name="expiryDate" type="date" />
        </Field>

        <Field label="Note">
          <Textarea name="notes" rows={4} />
        </Field>

        <Button type="submit">Crea contratto</Button>
      </form>
    </div>
  );
}
