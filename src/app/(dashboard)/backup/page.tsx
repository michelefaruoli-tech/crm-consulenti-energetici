import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMasterEmail } from "@/lib/mail";
import { formatRomeDateTime } from "@/lib/timezone";
import { BackupPanel } from "@/components/backup/backup-panel";

export default async function BackupPage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "backup.manage")) {
    redirect("/");
  }

  const backupEmail =
    process.env.BACKUP_EMAIL?.trim() ||
    process.env.MASTER_EMAIL?.trim() ||
    getMasterEmail();

  const gitHash =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.GIT_HASH?.slice(0, 7) ||
    "locale";

  const [recentBackups, lastWorking, totalContracts, paidCount] =
    await Promise.all([
      prisma.backupLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.backupLog.findFirst({
        where: { status: { in: ["WORKING", "WORKING_LOCAL"] } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.contract.count(),
      prisma.contract.count({ where: { collectionDate: { not: null } } }),
    ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Backup e sicurezza</h1>
        <p className="mt-1 text-sm text-slate-600">
          Proteggi i contratti e torna a una versione che funziona. Destinatario
          email: <strong>{backupEmail}</strong>. Versione codice online:{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">{gitHash}</code>.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-slate-900">{totalContracts}</p>
          <p className="text-xs text-slate-500">Contratti in database</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-semibold text-emerald-700">{paidCount}</p>
          <p className="text-xs text-slate-500">Con data di incasso</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-800">
            {lastWorking
              ? formatRomeDateTime(lastWorking.createdAt)
              : "Mai salvata"}
          </p>
          <p className="text-xs text-slate-500">Ultima versione funzionante</p>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Nell’Excel di backup, per ogni contratto trovi se è pagato (data
        incasso) o ancora da pagare, più gettoni e cliente.
      </p>

      <BackupPanel backupEmail={backupEmail} gitHash={gitHash} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-semibold text-slate-900">Cosa succede in automatico</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
          <li>
            <strong>Ogni sera ~22:00</strong> (Italia): Excel completo del database
            via email (sempre, anche se non hai caricato contratti).
          </li>
          <li>
            <strong>A ogni nuovo contratto</strong> (form Nuovo contratto o fine
            import Archivio): email di avviso con i dettagli principali.
          </li>
          <li>
            Il <strong>codice</strong> del sito resta su GitHub: se il programma si
            rompe, si ripristina la versione col commit indicato nello snapshot
            «funzionante».
          </li>
        </ul>
        <p className="mt-3 text-sm text-slate-500">
          Anche da{" "}
          <Link href="/report" className="text-emerald-700 underline">
            Report
          </Link>{" "}
          puoi scaricare l’Excel (scorciatoia).
        </p>
      </section>

      {recentBackups.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Storico backup</h2>
          <ul className="space-y-2 text-sm text-slate-600">
            {recentBackups.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-slate-100 pb-2 last:border-0"
              >
                <span className="font-mono text-xs text-slate-500">
                  {formatRomeDateTime(b.createdAt)}
                </span>
                <span
                  className={
                    b.status === "WORKING" || b.status === "WORKING_LOCAL"
                      ? "font-medium text-emerald-700"
                      : b.status === "EMAILED"
                        ? "text-slate-800"
                        : "text-slate-500"
                  }
                >
                  {b.status}
                </span>
                <span className="max-w-full truncate text-slate-500">
                  {b.filename}
                </span>
                {b.size != null && b.size > 0 ? (
                  <span className="text-slate-400">
                    {(b.size / 1024).toFixed(0)} KB
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
