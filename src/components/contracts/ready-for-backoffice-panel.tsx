"use client";

/**
 * Riquadro sotto «Invio al Back Office»: solo pratiche complete da far lavorare.
 * Mostra stato target, percorso Provvigioni e avviso se manca BO dedicato.
 */

type Props = {
  open: boolean;
  canSend: boolean;
  percent: number;
  label: string;
  blockers: string[];
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
          Contratti completi da far lavorare
        </h3>
        <span className="text-xs font-semibold text-emerald-800">
          Completezza {percent}% · {label}
        </span>
      </div>

      {!canSend ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Pratica non ancora completa per il Back Office</p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.length > 0 ? (
              blockers.map((b) => <li key={b}>{b}</li>)
            ) : (
              <li>Completa i blocchi evidenziati prima di inviare.</li>
            )}
          </ul>
        </div>
      ) : (
        <ul className="space-y-1.5 text-sm text-emerald-950">
          <li>
            All’invio lo stato diventa{" "}
            <strong>In lavorazione (IN_LAVORAZIONE)</strong> — enum già in uso,
            nessun nuovo stato.
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
