import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { clientDisplayName, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { updateClientAction } from "@/lib/actions";
import { hasPermission } from "@/lib/permissions";

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      contracts: {
        include: { supplier: true, collaborator: { select: { name: true } } },
        orderBy: { insertionDate: "desc" },
      },
    },
  });

  if (!client) notFound();

  const canEdit =
    hasPermission(session.role, "clients.edit_all") ||
    client.createdById === session.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{clientDisplayName(client)}</h1>
          <p className="text-slate-500">
            {client.type === "AZIENDA" ? "Business" : "Privato"} · Creato da{" "}
            {client.createdBy.name}
          </p>
        </div>
        <Link href={`/contratti/nuovo?clientId=${client.id}`}>
          <Button>Nuovo contratto</Button>
        </Link>
      </div>

      {canEdit ? (
        <form
          action={updateClientAction}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <input type="hidden" name="clientId" value={client.id} />
          <h2 className="font-semibold text-slate-900">Modifica anagrafica</h2>

          <Field label="Tipo">
            <Select name="type" defaultValue={client.type}>
              <option value="PRIVATO">Privato / Domestico</option>
              <option value="AZIENDA">Business / Azienda</option>
            </Select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome">
              <Input name="firstName" defaultValue={client.firstName ?? ""} />
            </Field>
            <Field label="Cognome">
              <Input name="lastName" defaultValue={client.lastName ?? ""} />
            </Field>
          </div>

          <Field label="Ragione sociale">
            <Input name="companyName" defaultValue={client.companyName ?? ""} />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Codice fiscale">
              <Input name="fiscalCode" defaultValue={client.fiscalCode ?? ""} />
            </Field>
            <Field label="Partita IVA">
              <Input name="vatNumber" defaultValue={client.vatNumber ?? ""} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Email">
              <Input name="email" type="email" defaultValue={client.email ?? ""} />
            </Field>
            <Field label="PEC">
              <Input name="pec" defaultValue={client.pec ?? ""} />
            </Field>
            <Field label="Telefono">
              <Input name="phone" defaultValue={client.phone ?? ""} />
            </Field>
          </div>

          <Field label="IBAN">
            <Input name="iban" defaultValue={client.iban ?? ""} />
          </Field>

          <Field label="Classificazione (Residente / Non residente / Altri usi)">
            <Input name="classification" defaultValue={client.classification ?? ""} />
          </Field>

          <Field label="Indirizzo residenza / sede">
            <Input name="address" defaultValue={client.address ?? ""} />
          </Field>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="CAP">
              <Input name="zipCode" defaultValue={client.zipCode ?? ""} />
            </Field>
            <Field label="Città">
              <Input name="city" defaultValue={client.city ?? ""} />
            </Field>
            <Field label="Provincia">
              <Input name="province" defaultValue={client.province ?? ""} />
            </Field>
            <Field label="Regione">
              <Input name="region" defaultValue={client.region ?? ""} />
            </Field>
          </div>

          <Field label="Indirizzo fornitura">
            <Input name="supplyAddress" defaultValue={client.supplyAddress ?? ""} />
          </Field>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="CAP fornitura">
              <Input name="supplyZipCode" defaultValue={client.supplyZipCode ?? ""} />
            </Field>
            <Field label="Città fornitura">
              <Input name="supplyCity" defaultValue={client.supplyCity ?? ""} />
            </Field>
            <Field label="Prov. fornitura">
              <Input name="supplyProvince" defaultValue={client.supplyProvince ?? ""} />
            </Field>
            <Field label="Regione fornitura">
              <Input name="supplyRegion" defaultValue={client.supplyRegion ?? ""} />
            </Field>
          </div>

          <Field label="Note">
            <Textarea name="notes" rows={3} defaultValue={client.notes ?? ""} />
          </Field>

          <Button type="submit">Salva anagrafica</Button>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Non hai permesso di modificare questo cliente.</p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">
          Contratti ({client.contracts.length})
        </h2>
        <ul className="space-y-3">
          {client.contracts.map((contract) => (
            <li
              key={contract.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 last:border-0"
            >
              <div>
                <Link
                  href={`/contratti/${contract.id}`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  {contract.supplier.name}
                  {contract.utilityType ? ` · ${contract.utilityType}` : ""}
                </Link>
                <p className="text-xs text-slate-500">
                  {formatDate(contract.insertionDate)} · {contract.collaborator.name}
                </p>
              </div>
              <StatusBadge status={contract.status} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
