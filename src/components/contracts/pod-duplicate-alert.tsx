"use client";

import { StornoBadgeList } from "@/components/ui/storno-badge";
import type { StornoBadgeDef } from "@/lib/storno-badges";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import type { AppContractStatus } from "@/lib/constants";

export type PodDuplicateMatch = {
  id: string;
  contractNumber?: string;
  client: string;
  supplier: string;
  status: string;
  supplyStartDate: string | null;
  archived: boolean;
  badges?: StornoBadgeDef[];
  switchHint?: "switch_certo" | "switch_possibile";
  switchHintLabel?: string;
  riskStorno?: boolean;
};

/**
 * P1.4 — avviso duplicati POD/PDR in tempo reale con badge B1 e rischio switch/storno.
 */
export function PodDuplicateAlert({
  matches,
  existsOutsideScope,
}: {
  matches: PodDuplicateMatch[];
  existsOutsideScope: boolean;
}) {
  if (matches.length === 0 && !existsOutsideScope) return null;

  const riskStorno = matches.some((m) => m.riskStorno);
  const hasSwitchCerto = matches.some((m) => m.switchHint === "switch_certo");

  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
      role="status"
      data-testid="pod-duplicate-alert"
    >
      <p className="font-semibold">
        POD/PDR già presente — possibile switch / ricontrattualizzazione
      </p>
      <p className="mt-1 text-xs text-amber-900/90">
        Controlla i contratti sullo stesso POD (badge storno allineati a B1).
        Un nuovo inserimento può attivare archivio / rischio storno sul precedente
        (regole business invariate).
      </p>

      {(riskStorno || hasSwitchCerto) && (
        <ul className="mt-2 list-inside list-disc text-xs font-medium text-amber-950">
          {riskStorno ? (
            <li>
              Attenzione: almeno un contratto sullo stesso POD è ancora in storno
              o in doppia posizione.
            </li>
          ) : null}
          {hasSwitchCerto ? (
            <li>
              Tipo operazione «switch» già presente su un peer: verifica di non
              creare un duplicato involontario.
            </li>
          ) : matches.length > 0 ? (
            <li>Possibile switch sullo stesso POD (peer esistenti).</li>
          ) : null}
        </ul>
      )}

      {matches.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {matches.map((match) => {
            const statusLabel =
              CONTRACT_STATUS_LABELS[match.status as AppContractStatus] ??
              match.status;
            return (
              <li
                key={match.id}
                className="rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-slate-900">
                      {match.contractNumber ? (
                        <span className="mr-1 font-mono text-xs text-slate-600">
                          {match.contractNumber}
                        </span>
                      ) : null}
                      {match.client} · {match.supplier}
                    </p>
                    <p className="text-xs text-slate-600">
                      Stato: {statusLabel}
                      {match.archived ? " · archiviato" : ""}
                      {match.switchHintLabel
                        ? ` · ${match.switchHintLabel}`
                        : ""}
                    </p>
                    {match.badges && match.badges.length > 0 ? (
                      <StornoBadgeList badges={match.badges} />
                    ) : null}
                  </div>
                  <a
                    href={`/contratti/${match.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-semibold text-sky-800 hover:underline"
                  >
                    Apri
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {existsOutsideScope ? (
        <p className="mt-2 text-xs">
          Questo POD/PDR risulta già in archivio su un contratto fuori dal tuo
          perimetro: non puoi vederne i dettagli. Se stai inserendo una
          ricontrattualizzazione procedi, altrimenti chiedi conferma al back
          office prima di salvare.
        </p>
      ) : null}
    </div>
  );
}
