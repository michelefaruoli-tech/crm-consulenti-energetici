import { createClientAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export default async function NuovoClientePage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.create")) redirect("/clienti");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Nuovo cliente</h1>
        <p className="text-slate-500">Inserimento anagrafica cliente</p>
      </div>

      <form action={createClientAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Field label="Tipo cliente">
          <Select name="type" defaultValue="PRIVATO">
            <option value="PRIVATO">Privato</option>
            <option value="AZIENDA">Azienda</option>
          </Select>
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome">
            <Input name="firstName" />
          </Field>
          <Field label="Cognome">
            <Input name="lastName" />
          </Field>
        </div>

        <Field label="Ragione sociale">
          <Input name="companyName" />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Codice fiscale">
            <Input name="fiscalCode" />
          </Field>
          <Field label="Partita IVA">
            <Input name="vatNumber" />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Email">
            <Input name="email" type="email" />
          </Field>
          <Field label="Telefono">
            <Input name="phone" />
          </Field>
        </div>

        <Field label="Indirizzo">
          <Input name="address" />
        </Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Città">
            <Input name="city" />
          </Field>
          <Field label="Provincia">
            <Input name="province" />
          </Field>
          <Field label="CAP">
            <Input name="zipCode" />
          </Field>
        </div>

        <Field label="Note">
          <Textarea name="notes" rows={4} />
        </Field>

        <Button type="submit">Salva cliente</Button>
      </form>
    </div>
  );
}
