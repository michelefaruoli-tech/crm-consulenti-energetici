import { createSupplierAction, createCommissionRuleAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { formatCurrency, paymentTypeLabel } from "@/lib/commission";
import { PAYMENT_TYPE_LABELS } from "@/lib/constants";

export default async function FornitoriPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) redirect("/");

  const suppliers = await prisma.supplier.findMany({
    include: {
      services: true,
      commissionRules: true,
      _count: { select: { contracts: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fornitori</h1>
        <p className="text-slate-500">Anagrafica fornitori e regole gettone (listino)</p>
      </div>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <h2 className="mb-2 text-base font-semibold">Guida: come funziona questa pagina</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <strong>Fornitore</strong> = compagnia energia/telco (Enel, Edison, Dolomiti…). Ogni
            contratto importato o creato è collegato a un fornitore.
          </li>
          <li>
            <strong>Servizi</strong> (Luce, Gas…) sono prodotti legati al fornitore. Li usi quando
            crei un contratto nuovo.
          </li>
          <li>
            <strong>Regola provvigionale (gettone)</strong> = quanto guadagni su quel fornitore /
            prodotto:
            <ul className="mt-1 list-disc pl-5">
              <li>
                <em>Una tantum</em>: importo unico alla chiusura/attivazione
              </li>
              <li>
                <em>Mensile / Rateizzato</em>: importi ricorrenti
              </li>
              <li>
                <em>Bonus / Premio</em>: extra
              </li>
            </ul>
          </li>
          <li>
            In futuro, quando carichi i <strong>report dei fornitori</strong> (ognuno con formato
            diverso), il sistema userà queste regole + un template per fornitore per assegnare
            automaticamente i gettoni ai collaboratori. Ora puoi già impostare i listini base.
          </li>
          <li>
            Il foglio Excel <em>Listino</em> lo raffineremo insieme in un secondo momento: per ora
            inserisci qui le regole che conosci.
          </li>
        </ol>
      </section>

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
          <Button type="submit">Salva fornitore</Button>
        </form>

        <form
          action={createCommissionRuleAction}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">Nuova regola gettone</h2>
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
          <Button type="submit">Salva regola</Button>
        </form>
      </div>

      <div className="space-y-4">
        {suppliers.map((supplier) => (
          <section
            key={supplier.id}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">{supplier.name}</h2>
              <p className="text-sm text-slate-500">
                Codice {supplier.code} · {supplier._count.contracts} contratti collegati
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-700">Servizi</h3>
                <ul className="space-y-1 text-sm text-slate-600">
                  {supplier.services.length === 0 ? (
                    <li className="text-slate-400">Nessun servizio ancora</li>
                  ) : (
                    supplier.services.map((service) => (
                      <li key={service.id}>• {service.name}</li>
                    ))
                  )}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium text-slate-700">Regole gettone</h3>
                <ul className="space-y-1 text-sm text-slate-600">
                  {supplier.commissionRules.length === 0 ? (
                    <li className="text-slate-400">Nessuna regola ancora</li>
                  ) : (
                    supplier.commissionRules.map((rule) => (
                      <li key={rule.id}>
                        • {rule.name} · {formatCurrency(rule.fixedAmount)} ·{" "}
                        {paymentTypeLabel(rule.paymentType)}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
