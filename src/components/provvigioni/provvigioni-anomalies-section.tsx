"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AnomaliesBulkPanel } from "@/components/provvigioni/anomalies-bulk-panel";
import type { ProvvigioniAnomaliesOverview } from "@/lib/provvigioni-anomalies";

/**
 * P1.1 B5 — sezione Anomalie.
 *
 * - `inline` (default): comportamento storico quando ci sono segnalazioni
 *   operative (mancanti / Helios) + eventuale bonifica one-shot.
 * - `unified`: vista first-class `focus=anomalie` — lista read-only di tutte
 *   le categorie in scope; apply / integrity completa solo via Backup.
 */
export function ProvvigioniAnomaliesSection({
  alertCount,
  monthIds,
  children,
  mode = "inline",
  overview,
  anomalieHref,
}: {
  alertCount: number;
  /** Id RecurringMonth delle segnalazioni aperte (mancanti + assenti Helios). */
  monthIds?: string[];
  children?: ReactNode;
  mode?: "inline" | "unified";
  overview?: ProvvigioniAnomaliesOverview | null;
  /** Link alla vista unificata (solo in modalità inline). */
  anomalieHref?: string;
}) {
  if (mode === "unified" && overview) {
    return <UnifiedAnomaliesView overview={overview} />;
  }

  if (alertCount <= 0) {
    if (anomalieHref) {
      return (
        <p className="text-sm text-slate-600">
          Nessuna segnalazione operativa aperta.{" "}
          <Link
            href={anomalieHref}
            className="font-medium text-rose-800 underline-offset-2 hover:underline"
          >
            Apri vista Anomalie
          </Link>{" "}
          per duplicati POD e storni critici.
        </p>
      );
    }
    return null;
  }

  return (
    <details
      open
      className="rounded-2xl border border-red-200 bg-red-50/40 p-4 open:shadow-sm"
    >
      <summary className="cursor-pointer text-sm font-semibold text-red-950">
        Anomalie — {alertCount} segnalazioni (rate mancanti, assenti da rendiconto…)
      </summary>
      <p className="mt-2 text-xs text-red-900/80">
        Percorso one-shot: <strong>1. Anteprima classificazione</strong> → spunta
        conferma → <strong>Applica</strong>. Solo sul tuo perimetro di visibilità.
        {anomalieHref ? (
          <>
            {" "}
            Vista completa:{" "}
            <Link
              href={anomalieHref}
              className="font-medium underline-offset-2 hover:underline"
            >
              Anomalie unificate
            </Link>
            .
          </>
        ) : null}
      </p>
      <div className="mt-4 space-y-4">
        {monthIds && monthIds.length > 0 ? (
          <AnomaliesBulkPanel monthIds={monthIds} />
        ) : null}
        {children}
      </div>
    </details>
  );
}

function UnifiedAnomaliesView({
  overview,
}: {
  overview: ProvvigioniAnomaliesOverview;
}) {
  return (
    <section
      aria-label="Vista Anomalie unificata"
      className="space-y-4 rounded-2xl border border-rose-200 bg-gradient-to-b from-rose-50/80 to-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-800">
            P1.1 · Vista 6
          </p>
          <h2 className="mt-1 text-lg font-bold text-rose-950 sm:text-xl">
            Anomalie · {overview.totalCount} segnalazioni in perimetro
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-rose-900/80">
            Rate mancanti, assenti Helios, storni critici e duplicati POD — stesso
            scope di elenco e Cestino. Solo lettura qui; bonifiche integrity in
            Backup.
          </p>
        </div>
        <Link
          href={overview.backupHref}
          className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-950 shadow-sm transition hover:bg-rose-50"
        >
          Apri Backup (apply)
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overview.buckets.map((b) => (
          <div
            key={b.id}
            className="rounded-xl border border-rose-100 bg-white/90 px-3 py-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
              {b.title}
            </p>
            <p className="mt-2 text-3xl font-bold text-rose-950">{b.count}</p>
            {b.listHref ? (
              <Link
                href={b.listHref}
                className="mt-2 inline-block text-xs font-medium text-rose-800 underline-offset-2 hover:underline"
              >
                Filtra elenco →
              </Link>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Solo in questa vista</p>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {overview.buckets.map((bucket) => (
          <div
            key={`list-${bucket.id}`}
            className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {bucket.title}
                <span className="ml-2 font-normal text-slate-500">
                  ({bucket.count}
                  {bucket.truncated ? "+" : ""})
                </span>
              </h3>
              {bucket.listHref ? (
                <Link
                  href={bucket.listHref}
                  className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                >
                  Vedi in elenco
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">{bucket.hint}</p>
            {bucket.rows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Nessuna in perimetro.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {bucket.rows.map((row) => (
                  <li
                    key={`${bucket.id}-${row.id}`}
                    className="flex flex-wrap items-start justify-between gap-2 py-2"
                  >
                    <div>
                      {row.href ? (
                        <Link
                          href={row.href}
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {row.label}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">
                          {row.label}
                        </span>
                      )}
                      {row.detail ? (
                        <p className="text-xs text-slate-500">{row.detail}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {bucket.truncated ? (
              <p className="mt-2 text-xs text-amber-800">
                Anteprima parziale — elenco completo / apply in Backup o tramite
                i filtri dedicati.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Incongruenze integrity (rate in anticipo, fuori intervallo, duplicati
        periodo, totali): analisi a lotti e Applica solo in{" "}
        <Link
          href={overview.backupHref}
          className="font-semibold text-slate-800 underline-offset-2 hover:underline"
        >
          Backup → Integrità
        </Link>
        . Helios M+2 e bonifica annuali invariati.
      </p>
    </section>
  );
}
