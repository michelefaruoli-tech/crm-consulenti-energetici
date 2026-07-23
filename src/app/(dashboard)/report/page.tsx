import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { sendReportEmailAction } from "@/lib/actions";
import { BackupButton } from "@/components/report/backup-button";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";

const MONTH_LABELS = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    collaboratorId?: string;
    supplierId?: string;
  }>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "reports.export")) redirect("/");

  const { from, to, collaboratorId, supplierId } = await searchParams;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const [collaborators, suppliers] = await Promise.all([
    canViewAll
      ? prisma.user.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([{ id: session.id, name: session.name }]),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const dateFrom = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
  const dateTo = to ? new Date(to) : new Date();

  const contractWhere = {
    ...(canViewAll
      ? collaboratorId
        ? { collaboratorId }
        : {}
      : { collaboratorId: session.id }),
    ...(supplierId ? { supplierId } : {}),
    insertionDate: { gte: dateFrom, lte: dateTo },
  };

  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    include: { commission: true, supplier: true, collaborator: true },
  });

  const totalContracts = contracts.length;
  const totalExpected = contracts.reduce(
    (s, c) => s + Number(c.commission?.expected ?? 0),
    0,
  );
  const totalReceived = contracts.reduce(
    (s, c) => s + Number(c.commission?.received ?? 0),
    0,
  );

  // Stats per mese (ultimi 12 mesi o nel periodo)
  const monthMap = new Map<string, { count: number; received: number; expected: number }>();
  for (const c of contracts) {
    const d = new Date(c.insertionDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = monthMap.get(key) ?? { count: 0, received: 0, expected: 0 };
    cur.count += 1;
    cur.received += Number(c.commission?.received ?? 0);
    cur.expected += Number(c.commission?.expected ?? 0);
    monthMap.set(key, cur);
  }
  const monthly = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, val]) => {
      const [y, m] = key.split("-");
      return {
        key,
        label: `${MONTH_LABELS[Number(m) - 1]} ${y}`,
        ...val,
      };
    });

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (collaboratorId) qs.set("collaboratorId", collaboratorId);
  if (supplierId) qs.set("supplierId", supplierId);
  const exportQs = qs.toString() ? `?${qs.toString()}` : "";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Report</h1>
        <p className="text-slate-500">
          Filtra per periodo, collaboratore e fornitore · statistiche mensili in tempo reale
        </p>
      </div>

      <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-5">
        <Field label="Dal">
          <Input type="date" name="from" defaultValue={from ?? dateFrom.toISOString().slice(0, 10)} />
        </Field>
        <Field label="Al">
          <Input type="date" name="to" defaultValue={to ?? dateTo.toISOString().slice(0, 10)} />
        </Field>
        <Field label="Collaboratore">
          <Select name="collaboratorId" defaultValue={collaboratorId ?? ""}>
            <option value="">Tutti</option>
            {collaborators.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fornitore">
          <Select name="supplierId" defaultValue={supplierId ?? ""}>
            <option value="">Tutti</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" className="w-full">
            Applica filtri
          </Button>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Contratti nel periodo</p>
          <p className="mt-2 text-3xl font-bold">{totalContracts}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Gettone previsto</p>
          <p className="mt-2 text-3xl font-bold">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Importo incassato</p>
          <p className="mt-2 text-3xl font-bold text-emerald-900">
            {formatCurrency(totalReceived)}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Produzione per mese</h2>
        {monthly.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun dato nel periodo selezionato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mese</th>
                  <th className="px-3 py-2">N° contratti</th>
                  <th className="px-3 py-2">Previsto</th>
                  <th className="px-3 py-2">Incassato</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.key} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{m.label}</td>
                    <td className="px-3 py-2">{m.count}</td>
                    <td className="px-3 py-2">{formatCurrency(m.expected)}</td>
                    <td className="px-3 py-2 text-emerald-700">
                      {formatCurrency(m.received)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Esporta (filtri attuali)</h2>
          <div className="flex flex-wrap gap-3">
            <Link href={`/api/report/excel${exportQs}`}>
              <Button variant="secondary">Scarica Excel</Button>
            </Link>
            <Link href={`/api/report/pdf${exportQs}`}>
              <Button variant="secondary">Scarica PDF</Button>
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Invio email report</h2>
          <form action={sendReportEmailAction} className="space-y-3">
            <Field label="Destinatario">
              <Input name="to" type="email" required />
            </Field>
            <Field label="Oggetto">
              <Input name="subject" defaultValue="Report produzione CRM Energia" />
            </Field>
            <Field label="Messaggio">
              <Textarea
                name="body"
                rows={3}
                defaultValue={`Report periodo ${dateFrom.toLocaleDateString("it-IT")} - ${dateTo.toLocaleDateString("it-IT")}: ${totalContracts} contratti, incassato ${formatCurrency(totalReceived)}.`}
              />
            </Field>
            <Button type="submit">Invia email</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Richiede SMTP in .env / Vercel</p>
        </section>
      </div>

      {hasPermission(session.role, "backup.manage") ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Backup</h2>
          <BackupButton />
        </section>
      ) : null}
    </div>
  );
}
