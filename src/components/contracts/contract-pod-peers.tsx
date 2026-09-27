import Link from "next/link";
import { StornoBadgeList } from "@/components/ui/storno-badge";
import type { ContractPodPeerRow } from "@/lib/contract-pod-peers";

export function ContractPodPeersSection({
  podKey,
  rows,
}: {
  podKey: string;
  rows: ContractPodPeerRow[];
}) {
  if (!podKey || podKey.length < 6) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-900">
          Contratti sullo stesso POD
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Tutti i contratti con POD/PDR normalizzato{" "}
          <span className="font-mono text-slate-700">{podKey}</span>, anche
          cross-fornitore. Ordinati per inizio fornitura (più recente prima).
          Solo lettura: nessuna modifica a latest o provvigioni.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nessun altro contratto visibile sullo stesso POD nel tuo perimetro.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 font-medium">N. contratto</th>
                <th className="px-2 py-2 font-medium">Cliente</th>
                <th className="px-2 py-2 font-medium">Fornitore</th>
                <th className="px-2 py-2 font-medium">Servizio</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Inizio fornitura</th>
                <th className="px-2 py-2 font-medium">Storno</th>
                <th className="px-2 py-2 font-medium">Switch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    row.isCurrent
                      ? "border-b border-slate-100 bg-emerald-50/60 last:border-0"
                      : "border-b border-slate-100 last:border-0"
                  }
                >
                  <td className="px-2 py-2.5 align-top">
                    {row.isCurrent ? (
                      <span className="font-semibold text-slate-900">
                        {row.contractNumber}
                        <span className="ml-1 text-xs font-normal text-emerald-800">
                          (questa pratica)
                        </span>
                      </span>
                    ) : (
                      <Link
                        href={`/contratti/${row.id}`}
                        className="font-semibold text-emerald-800 underline-offset-2 hover:underline"
                      >
                        {row.contractNumber}
                      </Link>
                    )}
                  </td>
                  <td className="px-2 py-2.5 align-top text-slate-900">
                    {row.clientName}
                  </td>
                  <td className="px-2 py-2.5 align-top text-slate-900">
                    {row.supplierName}
                  </td>
                  <td className="px-2 py-2.5 align-top text-slate-700">
                    {row.serviceLabel}
                  </td>
                  <td className="px-2 py-2.5 align-top text-slate-700">
                    {row.operationLabel ?? "—"}
                  </td>
                  <td className="px-2 py-2.5 align-top font-medium tabular-nums text-slate-900">
                    {row.supplyStartLabel}
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <StornoBadgeList badges={row.badges} />
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <span
                      className={
                        row.switchHint === "switch_certo"
                          ? "text-xs font-semibold text-amber-900"
                          : "text-xs font-medium text-slate-600"
                      }
                      data-switch-hint={row.switchHint}
                    >
                      {row.switchHintLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
