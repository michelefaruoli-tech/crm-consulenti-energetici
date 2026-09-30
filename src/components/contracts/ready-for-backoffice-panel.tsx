"use client";

/**
 * Riquadro sotto «Invio al Back Office»: pratiche pronte da far lavorare.
 * Documenti checklist mancanti → warning amber (integrazione), non hard-block
 * se c’è almeno un allegato e i dati minimi sono ok.
 */

type Props = {
  open: boolean;
  canSend: boolean;
  percent: number;
  label: string;
  blockers: string[];
  warnings?: string[];
  supplierName: string | null;
  /** null = ancora in caricamento */
  hasDedicatedBo: boolean | null;
  destinationWarning: string | null;
  destinationRecipients: string[];
};

export function ReadyForBackofficePanel({
  open,
  canSend,
  percent,
  label,
  blockers,
  warnings = [],
  supplierName,
  hasDedicatedBo,
  destinationWarning,
  destinationRecipients,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="space-y-3 rounded-2xl border-2 border-emerald-700/40 bg-emerald-50/90 p-4 shadow-sm"
      role="region"
      aria-label="Contratti completi da far lavorare"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-emerald-950">
          Contratti da far lavorare
        </h3>
        <span className="text-xs font-semibold text-emerald-800">
          Completezza {percent}% · {label}
        </span>
      </div>

      {!canSend ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Pratica non ancora inviabile al Back Office</p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.length > 0 ? (
              blockers.map((b) => <li key={b}>{b}</li>)
            ) : (
              <li>Completa i dati minimi e allega almeno un documento.</li>
            )}
          </ul>
        </div>
      ) : (
        <ul className="space-y-1.5 text-sm text-emerald-950">
          <li>
            Puoi inviare: all’invio lo stato diventa{" "}
            <strong>In lavorazione (IN_LAVORAZIONE)</strong>.
          </li>
          <li>
            La pratica entra / resta nel percorso <strong>Provvigioni</strong>{" "}
            (rate come al salvataggio; nessun ricalcolo regole).
          </li>
          <li>
            Fornitore: <strong>{supplierName || "—"}</strong>
          </li>
        </ul>
      )}

      {canSend && warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">
            Documenti da integrare — l’invio è comunque consentito
          </p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Il Back Office potrà richiedere i documenti mancanti; la pratica non
            resta bloccata.
          </p>
        </div>
      ) : null}

      {canSend && hasDedicatedBo === false ? (
        <div className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Nessun Back Office dedicato per questo fornitore</p>
          <p className="mt-1">
            {destinationWarning ||
              "La pratica non sparisce: resta In lavorazione e visibile in coda / Provvigioni. Verrà notificata solo al Master admin se configurato."}
          </p>
        </div>
      ) : null}

      {canSend && hasDedicatedBo === true && destinationRecipients.length > 0 ? (
        <p className="text-xs text-emerald-800">
          Destinatari previsti: {destinationRecipients.join(", ")}
        </p>
      ) : null}

      {canSend && hasDedicatedBo === null ? (
        <p className="text-xs text-slate-600">Verifica destinazione Back Office…</p>
      ) : null}
    </div>
  );
}
