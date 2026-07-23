import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { sendReportEmailAction } from "@/lib/actions";
import { BackupButton } from "@/components/report/backup-button";

export default async function ReportPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "reports.export")) redirect("/");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Report</h1>
        <p className="text-slate-500">Esportazione PDF/Excel, email e backup</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Esporta report</h2>
          <p className="mb-4 text-sm text-slate-500">
            Scarica report contratti e provvigioni in formato Excel o PDF.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/api/report/excel">
              <Button variant="secondary">Scarica Excel</Button>
            </Link>
            <Link href="/api/report/pdf">
              <Button variant="secondary">Scarica PDF</Button>
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Invio email report</h2>
          <form action={sendReportEmailAction} className="space-y-3">
            <Field label="Destinatario">
              <Input name="to" type="email" required placeholder="collaboratore@email.it" />
            </Field>
            <Field label="Oggetto">
              <Input name="subject" defaultValue="Report provvigioni CRM Energia" />
            </Field>
            <Field label="Messaggio">
              <Textarea name="body" rows={4} defaultValue="In allegato il report aggiornato." />
            </Field>
            <Button type="submit">Invia email</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Richiede configurazione SMTP in `.env`
          </p>
        </section>
      </div>

      {hasPermission(session.role, "backup.manage") ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Backup automatici</h2>
          <p className="mb-4 text-sm text-slate-500">
            Genera un backup JSON dei dati principali e registra l&apos;operazione nel log.
          </p>
          <BackupButton />
        </section>
      ) : null}
    </div>
  );
}
