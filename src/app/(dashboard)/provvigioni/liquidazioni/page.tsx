import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { periodLabel } from "@/lib/recurring";
import { formatRomeDateTime } from "@/lib/timezone";
import { listBuiltinTemplates } from "@/lib/payout/templates";
import { PayoutImportPanel } from "@/components/provvigioni/payout-import-panel";
import { Card, CardTitle } from "@/components/ui/card";

const RUN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Aperta",
  APPLIED: "Applicata",
  REVERTED: "Annullata",
  CLOSED: "Chiusa",
};

const RUN_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  APPLIED: "bg-emerald-50 text-emerald-700",
  REVERTED: "bg-amber-50 text-amber-700",
  CLOSED: "bg-slate-200 text-slate-600",
};

export default async function LiquidazioniPage() {
  const session = await requireSession();
  // Un rendiconto contiene i dati di tutti i collaboratori: import riservato al Master
  if (!hasPermission(session.role, "commissions.edit_gettone")) {
    redirect("/provvigioni");
  }

  const runs = await prisma.payoutRun.findMany({
    orderBy: [{ period: "desc" }, { createdAt: "desc" }],
    take: 30,
    select: {
      id: true,
      period: true,
      label: true,
      status: true,
      appliedAt: true,
      liquidatedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { batches: true, adjustments: true, reportRuns: true } },
    },
  });

  const templates = listBuiltinTemplates().map((t) => ({
    key: t.key,
    label: t.label,
    hint: t.hint,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Liquidazioni provvigioni
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Importa il rendiconto di una fonte, controlla l&apos;anteprima e applica.
          Ogni liquidazione resta aperta: puoi aggiungere altri file, inserire
          rettifiche manuali e rigenerare i report.
        </p>
      </div>

      <Card>
        <CardTitle>Nuovo import</CardTitle>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          L&apos;anteprima non scrive nulla. L&apos;applicazione segna i contratti come
          incassati dal fornitore e resta annullabile.
        </p>
        <PayoutImportPanel templates={templates} />
      </Card>

      <Card>
        <CardTitle>Liquidazioni registrate</CardTitle>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessuna liquidazione: importa il primo rendiconto qui sopra.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Periodo</th>
                  <th className="px-3 py-2">Liquidazione</th>
                  <th className="px-3 py-2">Stato</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Rettifiche</th>
                  <th className="px-3 py-2">Report</th>
                  <th className="px-3 py-2">Creata</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">
                      {periodLabel(run.period)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/provvigioni/liquidazioni/${run.id}`}
                        className="text-emerald-700 hover:underline"
                      >
                        {run.label}
                      </Link>
                      {run.liquidatedAt ? (
                        <span className="block text-xs text-slate-500">
                          Liquidata ai collaboratori
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${
                          RUN_STATUS_STYLE[run.status] ??
                          "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {RUN_STATUS_LABEL[run.status] ?? run.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{run._count.batches}</td>
                    <td className="px-3 py-2">{run._count.adjustments}</td>
                    <td className="px-3 py-2">{run._count.reportRuns}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatRomeDateTime(run.createdAt)} ·{" "}
                      {run.createdBy.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Fonti non automatizzate</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Due documenti restano da inserire a mano, con le rettifiche della
          liquidazione: il <strong>PDF del broker telefonia</strong> (il testo si
          estrae ma la struttura a tabella no, e il POD spesso non c&apos;è) e il{" "}
          <strong>foglio interno «Inviti a fatturare»</strong> (la posizione delle
          colonne cambia da un mese all&apos;altro). Se le fonti forniscono un
          tracciato stabile in Excel o CSV, rientrano nell&apos;import automatico.
        </p>
      </Card>
    </div>
  );
}
