import { createSupplierAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import {
  FornitoriListinoEditor,
  type FornitoreAnagraficaRow,
  type ListinoRegolaRow,
} from "@/components/suppliers/fornitori-listino-table";

function dec(v: { toString(): string } | null | undefined): string {
  if (v == null) return "";
  return String(Number(v));
}

export default async function FornitoriPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "suppliers.manage")) redirect("/");

  const suppliers = await prisma.supplier.findMany({
    include: {
      commissionRules: {
        where: { active: true },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      },
      _count: { select: { contracts: true } },
    },
    orderBy: { name: "asc" },
  });

  const anagrafica: FornitoreAnagraficaRow[] = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    email: s.email ?? "",
    active: s.active,
    contractsCount: s._count.contracts,
    stornoMonths: s.stornoMonths != null ? String(s.stornoMonths) : "",
  }));

  const regole: ListinoRegolaRow[] = suppliers.flatMap((s) =>
    s.commissionRules.map((r) => {
      // Retrocompatibilità: se solo fixedAmount, usalo come base
      const hasParts =
        r.gettoneBase != null ||
        r.gettoneRid != null ||
        r.gettoneBollettaWeb != null ||
        r.gettoneMail != null ||
        r.gettoneMensile != null ||
        r.gettoneUnaTantumIniziale != null;
      const baseFallback =
        !hasParts && r.fixedAmount != null ? dec(r.fixedAmount) : dec(r.gettoneBase);

      return {
        id: r.id,
        supplierId: s.id,
        supplierName: s.name,
        name: r.name,
        clientSegment: r.clientSegment || "TUTTI",
        stornoMonths: r.stornoMonths != null ? String(r.stornoMonths) : "",
        gettoneBase: baseFallback,
        gettoneRid: dec(r.gettoneRid),
        gettoneBollettaWeb: dec(r.gettoneBollettaWeb),
        gettoneMail: dec(r.gettoneMail),
        gettoneUnaTantumIniziale: dec(r.gettoneUnaTantumIniziale),
        gettoneMensile: dec(r.gettoneMensile),
        active: r.active,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fornitori</h1>
        <p className="text-slate-500">
          Più regole per fornitore (Privato / Business / Extra). Voci: base, RID, bolletta web,
          mail (fattura email), una tantum iniziale, mensile → totale automatico.
        </p>
      </div>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <h2 className="mb-2 text-base font-semibold">Come funziona</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Gettone mail</strong> = extra se il cliente riceve la fattura via email.
          </li>
          <li>
            <strong>Totale</strong> = Base + RID + Bolletta web + Mail + UT iniziale; il{" "}
            <strong>mensile</strong> resta indicato a parte (€/mese).
          </li>
          <li>
            Esempio: Dolomiti Privato, Dolomiti Business, Dolomiti Base Extra = tre regole sullo
            stesso fornitore.
          </li>
          <li>
            Regole con potenza/kWh particolari: per ora gestiscile a mano sul contratto.
          </li>
        </ul>
      </section>

      <FornitoriListinoEditor suppliers={anagrafica} rules={regole} />

      <form
        action={createSupplierAction}
        className="max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="font-semibold text-slate-900">Nuovo fornitore</h2>
        <Field label="Nome">
          <Input name="name" required placeholder="Es. Dolomiti" />
        </Field>
        <Field label="Codice (univoco)">
          <Input name="code" required placeholder="DOLOMITI" />
        </Field>
        <Field label="Email contatto">
          <Input name="email" type="email" />
        </Field>
        <Field label="Mesi storno (default)">
          <Input name="stornoMonths" type="number" min={0} placeholder="Es. 12" />
        </Field>
        <Field label="Gettone base iniziale € (opzionale, crea regola Listino base)">
          <Input name="gettone" type="number" step="0.01" min={0} placeholder="Es. 50" />
        </Field>
        <Button type="submit">Crea fornitore</Button>
      </form>
    </div>
  );
}
