import Link from "next/link";

/**
 * Guida operativa P0.1: un solo percorso Anteprima → conferma → Applica.
 * Le scritture restano sempre dietro conferma di Michele in UI.
 */
export function P01ChecklistBanner() {
  return (
    <section
      id="p0-1"
      className="rounded-xl border border-amber-300 bg-amber-50/70 p-5 shadow-sm"
    >
      <h2 className="mb-1 text-lg font-semibold text-amber-950">
        Chiusura P0.1 — percorso in un colpo solo
      </h2>
      <p className="mb-3 text-sm text-amber-900/90">
        Helios M+2 e marcatura luglio sono già applicati. Qui restano le bonifiche
        dati: sempre <strong>Anteprima</strong>, poi checkbox di conferma, poi{" "}
        <strong>Applica</strong>. Nessuna scrittura automatica.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-amber-950">
        <li>
          <a href="#integrita" className="font-medium underline underline-offset-2">
            Controllo integrità
          </a>
          {" — "}
          Analizza tutto → per ogni categoria con conteggio &gt; 0: conferma → Applica
          (ordine: mancanti → anticipate → fuori intervallo senza incasso →{" "}
          <strong>fuori intervallo con incasso</strong> ≈ 308 → POD).
        </li>
        <li>
          <a href="#fuori-intervallo" className="font-medium underline underline-offset-2">
            §4 Fuori intervallo
          </a>
          {" — "}
          Solo rate <em>senza</em> valore economico (selezione riga per riga). Le rate
          con incasso si applicano dal punto 1, non da qui.
        </li>
        <li>
          <a href="#backfill" className="font-medium underline underline-offset-2">
            §5 Backfill
          </a>
          {" — "}
          Anteprima → Crea le rate mancanti → riescan.
        </li>
        <li>
          <Link href="/provvigioni" className="font-medium underline underline-offset-2">
            Provvigioni → Anomalie
          </Link>
          {" — "}
          Anteprima classificazione → conferma → Applica (solo sul tuo perimetro).
        </li>
        <li>
          <Link
            href="/catalogo-cte/nuovo"
            className="font-medium underline underline-offset-2"
          >
            Catalogo CTE → Duferco Flex Condomini
          </Link>
          {" — "}
          un click «Aggiungi» (18 offerte, senza scadenza). Idempotente.
        </li>
      </ol>
      <p className="mt-3 text-xs text-amber-800">
        Dopo i passi 1–3: riesegui Analizza. Obiettivo = nessuna anomalia correggibile,
        oppure residuali giustificati documentati.
      </p>
    </section>
  );
}
