import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { sendReportEmailAction } from "@/lib/actions";
import { BackupButton } from "@/components/report/backup-button";
import { ReportPeriodFields } from "@/components/report/report-period-fields";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/commission";
import { formatRomeDateTime } from "@/lib/timezone";
import { getMasterEmail } from "@/lib/mail";
import { isRecurring } from "@/lib/recurring";
import {
  loadReportRecurringPaid,
  sumReportRecurring,
} from "@/lib/report-recurring";
import {
  REPORT_MONTH_LABELS,
  REPORT_STATO_OPTIONS,
  buildReportContractWhere,
  formatMonthLabel,
  recentMonthOptions,
  reportDateRange,
  reportPeriodUsesCollectionDate,
  reportStatoHint,
  resolveReportPeriod,
  resolveReportStato,
} from "@/lib/report-filters";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    month?: string;
    collaboratorId?: string;
    supplierId?: string;
    stato?: string;
  }>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "reports.export")) redirect("/");

  const {
    from: fromRaw,
    to: toRaw,
    month: monthRaw,
    collaboratorId,
    supplierId,
    stato: statoRaw,
  } = await searchParams;
  const stato = resolveReportStato(statoRaw);
  const period = resolveReportPeriod({
    from: fromRaw,
    to: toRaw,
    month: monthRaw,
  });
  const from = period.from;
  const to = period.to;
  const month = period.month;
  const canViewAll = hasPermission(session.role, "contracts.edit_all");

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const [collaborators, suppliers, recentBackups] = await Promise.all([
    canViewAll
      ? prisma.user.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : hasPermission(session.role, "contracts.work_scoped")
        ? prisma.user.findMany({
            where: {
              active: true,
              role: { in: ["COLLABORATORE", "COMMERCIALE", "AREA_MANAGER", "ADMIN", "SEGRETERIA"] },
            },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([{ id: session.id, name: session.name }]),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    hasPermission(session.role, "backup.manage")
      ? prisma.backupLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : Promise.resolve([]),
  ]);

  const backupEmail =
    process.env.BACKUP_EMAIL?.trim() ||
    process.env.MASTER_EMAIL?.trim() ||
    getMasterEmail();

  const { dateFrom, dateTo } = reportDateRange(from, to);
  const monthOptions = recentMonthOptions(24);

  const contractWhere = buildReportContractWhere(
    { from, to, month, collaboratorId, supplierId, stato },
    visibility,
  );

  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    include: { commission: true, supplier: true, collaborator: true },
  });

  const recurringRows = await loadReportRecurringPaid({
    from,
    to,
    month,
    collaboratorId,
    supplierId,
    visibility,
  });
  const recurringTotals = sumReportRecurring(recurringRows);

  // Una tantum: evita di contare due volte i contratti R (già in RecurringMonth)
  const oneShot = contracts.filter((c) => !isRecurring(c.recurrence));
  const totalContracts = contracts.length;
  const totalExpected = oneShot.reduce(
    (s, c) => s + Number(c.commission?.expected ?? 0),
    0,
  );
  const totalReceivedOneShot = oneShot.reduce(
    (s, c) => s + Number(c.commission?.received ?? 0),
    0,
  );
  const totalPaid = oneShot.reduce(
    (s, c) => s + Number(c.commission?.paid ?? 0),
    0,
  );
  const totalReceived =
    totalReceivedOneShot +
    (stato === "Incassato" || stato === "Pagato" || stato === "Tutti"
      ? recurringTotals.amount
      : 0);

  const monthMap = new Map<string, { count: number; received: number; expected: number }>();
  const groupByCollection = reportPeriodUsesCollectionDate(stato);
  for (const c of oneShot) {
    const baseDate = groupByCollection
      ? c.collectionDate ?? c.insertionDate
      : c.insertionDate;
    const d = new Date(baseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = monthMap.get(key) ?? { count: 0, received: 0, expected: 0 };
    cur.count += 1;
    cur.received += Number(c.commission?.received ?? 0);
    cur.expected += Number(c.commission?.expected ?? 0);
    monthMap.set(key, cur);
  }
  for (const r of recurringRows) {
    if (!(stato === "Incassato" || stato === "Pagato" || stato === "Tutti")) break;
    const key = r.settledPeriod || r.period;
    const cur = monthMap.get(key) ?? { count: 0, received: 0, expected: 0 };
    cur.count += 1;
    cur.received += r.amount;
    monthMap.set(key, cur);
  }
  const monthly = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, val]) => {
      const [y, m] = key.split("-");
      return {
        key,
        label: `${REPORT_MONTH_LABELS[Number(m) - 1]} ${y}`,
        ...val,
      };
    });

  const byCollab = new Map<
    string,
    { name: string; count: number; expected: number; received: number; paid: number; recurring: number }
  >();
  for (const c of oneShot) {
    const id = c.collaboratorId;
    const cur = byCollab.get(id) ?? {
      name: c.collaborator.name,
      count: 0,
      expected: 0,
      received: 0,
      paid: 0,
      recurring: 0,
    };
    cur.count += 1;
    cur.expected += Number(c.commission?.expected ?? 0);
    cur.received += Number(c.commission?.received ?? 0);
    cur.paid += Number(c.commission?.paid ?? 0);
    byCollab.set(id, cur);
  }
  if (stato === "Incassato" || stato === "Pagato" || stato === "Tutti") {
    for (const r of recurringRows) {
      const cur = byCollab.get(r.collaboratorId) ?? {
        name: r.collaboratorName,
        count: 0,
        expected: 0,
        received: 0,
        paid: 0,
        recurring: 0,
      };
      cur.recurring += r.amount;
      cur.received += r.amount;
      byCollab.set(r.collaboratorId, cur);
    }
  }
  const collaboratorTotals = [...byCollab.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "it"),
  );

  const qs = new URLSearchParams();
  if (month) qs.set("month", month);
  qs.set("from", from);
  qs.set("to", to);
  if (collaboratorId) qs.set("collaboratorId", collaboratorId);
  if (supplierId) qs.set("supplierId", supplierId);
  qs.set("stato", stato);
  const exportQs = `?${qs.toString()}`;

  const periodLabelText = month
    ? formatMonthLabel(month)
    : `${dateFrom.toLocaleDateString("it-IT")} – ${dateTo.toLocaleDateString("it-IT")}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Report</h1>
        <p className="text-slate-500">
          Il mese segue la colonna <strong>Incasso</strong> di Provvigioni (es. 06/2026 →
          Giugno), per tutti i fornitori. Rate ricorrenti incluse.
        </p>
      </div>

      <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <ReportPeriodFields
          monthOptions={monthOptions}
          initialMonth={month ?? ""}
          initialFrom={from}
          initialTo={to}
        />
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
        <Field label="Stato provvigione">
          <Select name="stato" defaultValue={stato}>
            {REPORT_STATO_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
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

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        <p className="font-semibold">
          Periodo: {periodLabelText}
          {month ? " (mese di incasso)" : " (date personalizzate)"}
        </p>
        <p className="mt-1 text-xs text-emerald-900/80">
          Coincide con le righe Provvigioni che in colonna Incasso hanno{" "}
          {month
            ? `${month.slice(5)}/${month.slice(0, 4)}`
            : "una data in questo intervallo"}
          .
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-semibold">Filtro attivo: {stato}</p>
        <p className="mt-1">{reportStatoHint(stato)}</p>
        <ul className="mt-2 list-inside list-disc text-xs text-amber-900/90">
          <li>
            <strong>Da incassare</strong> = contratto inserito, non ancora pagato a te dal
            fornitore
          </li>
          <li>
            <strong>Incassato</strong> = fornitore ha pagato a te → da pagare ai collaboratori
          </li>
          <li>
            <strong>Pagato</strong> = tu hai già liquidato i collaboratori
          </li>
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Contratti ({stato})</p>
          <p className="mt-2 text-3xl font-bold">{totalContracts}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Gettone previsto (una tantum)</p>
          <p className="mt-2 text-3xl font-bold">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
          <p className="text-sm text-violet-700">Rate ricorrenti pagate</p>
          <p className="mt-2 text-3xl font-bold text-violet-900">
            {recurringTotals.count}
          </p>
          <p className="mt-1 text-sm font-semibold text-violet-800">
            {formatCurrency(recurringTotals.amount)}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm text-emerald-700">Totale ricevuto</p>
          <p className="mt-2 text-3xl font-bold text-emerald-900">
            {formatCurrency(totalReceived)}
          </p>
          <p className="mt-1 text-[11px] text-emerald-800">
            una tantum {formatCurrency(totalReceivedOneShot)} + ricorrenti{" "}
            {formatCurrency(
              stato === "Incassato" || stato === "Pagato" || stato === "Tutti"
                ? recurringTotals.amount
                : 0,
            )}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <p className="text-sm text-sky-700">Già liquidato ai collab.</p>
          <p className="mt-2 text-3xl font-bold text-sky-900">
            {formatCurrency(totalPaid)}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-slate-900">
          Per collaboratore ({stato})
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Con stato <strong>Incassato</strong> vedi quanto resta da liquidare a ciascuno. Con{" "}
          <strong>Pagato</strong> vedi quanto hai già versato.
        </p>
        {collaboratorTotals.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun dato con i filtri selezionati.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Collaboratore</th>
                  <th className="px-3 py-2">N° contratti</th>
                  <th className="px-3 py-2">Previsto</th>
                  <th className="px-3 py-2">Ricorrenti</th>
                  <th className="px-3 py-2">Ricevuto tot.</th>
                  <th className="px-3 py-2">Liquidato</th>
                </tr>
              </thead>
              <tbody>
                {collaboratorTotals.map((row) => (
                  <tr key={row.name} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">{row.count}</td>
                    <td className="px-3 py-2">{formatCurrency(row.expected)}</td>
                    <td className="px-3 py-2 text-violet-700">
                      {formatCurrency(row.recurring)}
                    </td>
                    <td className="px-3 py-2 text-emerald-700">
                      {formatCurrency(row.received)}
                    </td>
                    <td className="px-3 py-2 text-sky-700">
                      {formatCurrency(row.paid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
          <h2 className="mb-2 font-semibold text-slate-900">Esporta (filtri attuali)</h2>
          <p className="mb-4 text-sm text-slate-500">
            Excel e PDF usano gli stessi filtri sopra (mese/periodo, collaboratore, fornitore,
            stato).
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/api/report/excel${exportQs}`}>
              <Button variant="secondary">Scarica Excel</Button>
            </Link>
            <Link href={`/api/report/pdf${exportQs}`}>
              <Button variant="secondary">Scarica PDF</Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            L&apos;Excel include anche il foglio <strong>Rate ricorrenti</strong>{" "}
            (competenza / bonifico nel periodo, es. giugno €4/€6).
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Invio email report</h2>
          <form action={sendReportEmailAction} className="space-y-3">
            <Field label="Destinatario">
              <Input name="to" type="email" required />
            </Field>
            <Field label="Oggetto">
              <Input
                name="subject"
                defaultValue={`Report ${periodLabelText} — CRM Energia`}
              />
            </Field>
            <Field label="Messaggio">
              <Textarea
                name="body"
                rows={3}
                defaultValue={`Report ${stato} — ${periodLabelText}: ${totalContracts} contratti, previsto ${formatCurrency(totalExpected)}, ricevuto ${formatCurrency(totalReceived)}.`}
              />
            </Field>
            <Button type="submit">Invia email</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Richiede SMTP in .env / Vercel</p>
        </section>
      </div>

      {hasPermission(session.role, "backup.manage") ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold text-slate-900">Backup database (Excel)</h2>
          <p className="mb-4 text-sm text-slate-500">
            Automatico ogni sera alle ~22:00 (ora italiana),{" "}
            <strong>sempre</strong> (anche senza nuovi contratti). Destinatario:{" "}
            {backupEmail}. Per snapshot «versione funzionante» e ripristino vai a{" "}
            <Link href="/backup" className="text-emerald-700 underline">
              Backup
            </Link>
            .
          </p>
          <BackupButton />
          {recentBackups.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-medium text-slate-800">Ultimi backup</h3>
              <ul className="space-y-1 text-sm text-slate-600">
                {recentBackups.map((b) => (
                  <li key={b.id} className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="font-mono text-xs text-slate-500">
                      {formatRomeDateTime(b.createdAt)}
                    </span>
                    <span>{b.status}</span>
                    <span className="truncate text-slate-500">{b.filename}</span>
                    {b.size != null && b.size > 0 ? (
                      <span className="text-slate-400">
                        {(b.size / 1024).toFixed(0)} KB
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
