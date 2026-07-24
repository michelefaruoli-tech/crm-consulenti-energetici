import { createSupplierAction, createCommissionRuleAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { paymentTypeLabel } from "@/lib/commission";
import { PAYMENT_TYPE_LABELS } from "@/lib/constants";
import {
  FornitoriListinoTable,
  type FornitoreListinoRow,
} from "@/components/suppliers/fornitori-listino-table";

function pickBaseRule<T extends { serviceId: string | null; name: string; fixedAmount: unknown; paymentType: string }>(
  rules: T[],
): T | null {
  return (
    rules.find((r) => !r.serviceId && /listino|base/i.test(r.name)) ??
    rules.find((r) => !r.serviceId) ??
    rules[0] ??
    null
  );
}

export default async function FornitoriPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) redirect("/");

  const suppliers = await prisma.supplier.findMany({
    include: {
      services: true,
      commissionRules: { where: { active: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { contracts: true } },
    },
    orderBy: { name: "asc" },
  });

  const listinoRows: FornitoreListinoRow[] = suppliers.map((s) => {
    const base = pickBaseRule(s.commissionRules);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      email: s.email ?? "",
      active: s.active,
      contractsCount: s._count.contracts,
      stornoMonths: s.stornoMonths != null ? String(s.stornoMonths) : "",
      gettone: base?.fixedAmount != null ? String(Number(base.fixedAmount)) : "",
      paymentType: base?.paymentType ?? "UNA_TANTUM",
      paymentTypeLabel: paymentTypeLabel(base?.paymentType ?? "UNA_TANTUM"),
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fornitori</h1>
        <p className="text-slate-500">
          Listino base: storno e gettone semplice. Le regole complesse (potenza, kWh…) le
          gestisci dopo, caso per caso.
        </p>
      </div>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <h2 className="mb-2 text-base font-semibold">Come usare questa pagina</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Nella tabella sotto modifica <strong>Mesi storno</strong> e{" "}
            <strong>Gettone € (base)</strong>, poi <strong>Salva cambiamenti</strong>.
          </li>
          <li>
            Il gettone base crea/aggiorna la regola «Listino base» di quel fornitore (regola
            semplice).
          </li>
          <li>
            Se un fornitore ha regole particolari (fasce kW, consumi…), per ora lasciale fuori
            dal listino base e gestiscile a mano sul contratto.
          </li>
        </ol>
      </section>

      <FornitoriListinoTable rows={listinoRows} />

      <div className="grid gap-6 xl:grid-cols-2">
        <form
          action={createSupplierAction}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">Nuovo fornitore</h2>
          <Field label="Nome">
            <Input name="name" required placeholder="Es. Enel" />
          </Field>
          <Field label="Codice (univoco)">
            <Input name="code" required placeholder="ENEL" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" />
          </Field>
          <Field label="Mesi di storno">
            <Input name="stornoMonths" type="number" min={0} placeholder="Es. 12" />
          </Field>
          <Field label="Gettone base € (opzionale)">
            <Input name="gettone" type="number" step="0.01" min={0} placeholder="Es. 50" />
          </Field>
          <Button type="submit">Crea fornitore</Button>
        </form>

        <form
          action={createCommissionRuleAction}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">Aggiungi regola gettone extra</h2>
          <p className="text-xs text-slate-500">
            Per regole oltre al listino base (es. Bonus, Domestico RID). Non serve per il
            gettone semplice: quello lo editi nella tabella sopra.
          </p>
          <Field label="Fornitore">
            <Select name="supplierId" required>
              <option value="">Seleziona</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Servizio (opzionale)">
            <Select name="serviceId">
              <option value="">Generico / tutti i prodotti</option>
              {suppliers.flatMap((supplier) =>
                supplier.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {supplier.name} · {service.name}
                  </option>
                )),
              )}
            </Select>
          </Field>
          <Field label="Nome regola">
            <Input name="name" required placeholder="Es. Domestico RID" />
          </Field>
          <Field label="Tipo pagamento">
            <Select name="paymentType" defaultValue="UNA_TANTUM">
              {Object.entries(PAYMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Importo fisso €">
              <Input name="fixedAmount" type="number" step="0.01" required />
            </Field>
            <Field label="Rate (se rateizzato)">
              <Input name="installments" type="number" />
            </Field>
          </div>
          <Button type="submit">Salva regola extra</Button>
        </form>
      </div>
    </div>
  );
}
