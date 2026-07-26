import Link from "next/link";

export const metadata = {
  title: "Privacy | CRM Energia",
  description: "Informativa privacy del gestionale CRM Consulenti Energetici",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div>
          <p className="text-sm text-emerald-700">
            <Link href="/login" className="underline">
              ← Torna al login
            </Link>
          </p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">
            Informativa privacy
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Ultimo aggiornamento: luglio 2026 · Testo semplificato per utenti del
            CRM
          </p>
        </div>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            1. Chi gestisce i dati
          </h2>
          <p>
            Il gestionale CRM Energia è utilizzato da FM Consulenza (o dalla
            società titolare del dominio) per gestire clienti, contratti e
            provvigioni energetiche. Per richieste privacy: usa l’email del
            titolare / Master del CRM.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            2. Quali dati trattiamo
          </h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Dati anagrafici clienti (nome, CF/P.IVA, contatti, indirizzi)</li>
            <li>Dati di contratto (POD/PDR, fornitore, date, stati)</li>
            <li>Provvigioni e pagamenti collegati alle pratiche</li>
            <li>
              Dati degli utenti del CRM (nome, email, ruolo, log di accesso)
            </li>
            <li>Eventuali allegati (documenti) caricati sulle pratiche</li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            3. Perché li trattiamo
          </h2>
          <p>
            Solo per finalità operative del CRM: inserimento e lavorazione
            contratti, calcolo/incasso provvigioni, comunicazione interna tra
            collaboratori e backoffice, backup di sicurezza, sicurezza degli
            accessi.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            4. Dove stanno i dati
          </h2>
          <p>
            I dati sono salvati su database cloud (Neon/PostgreSQL, regione UE
            quando configurata) e l’applicazione è ospitata su Vercel. Le email
            di backup/notifica possono transitare tramite il provider SMTP
            configurato. L’accesso è riservato agli utenti autenticati con
            password, secondo i ruoli assegnati (Admin, Backoffice,
            Collaboratore, ecc.).
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            5. Conservazione
          </h2>
          <p>
            I dati restano finché necessari all’attività commerciale e agli
            obblighi di legge. Gli allegati possono essere ripuliti
            automaticamente dopo un periodo di retention. I backup periodici
            (Excel) sono inviati all’amministratore: vanno conservati in modo
            sicuro e non condivisi.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            6. Sicurezza
          </h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Password degli utenti salvate in forma non reversibile (hash)</li>
            <li>Connessione HTTPS</li>
            <li>Ruoli e scope (es. Backoffice vede solo certi fornitori)</li>
            <li>Log di accessi e tentativi sospetti per l’Admin</li>
            <li>Protezione anti-abuso sul login (limite tentativi)</li>
          </ul>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            7. Diritti
          </h2>
          <p>
            Gli interessati possono chiedere accesso, rettifica o cancellazione
            dei propri dati contattando il titolare del trattamento. Le
            richieste che riguardano i dati nel CRM saranno gestite
            dall’amministratore (esportazione/aggiornamento/eliminazione
            secondo necessità e obblighi di legge).
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-slate-700">
          <h2 className="text-base font-semibold text-slate-900">
            8. Nota
          </h2>
          <p>
            Questo testo è un’informativa operativa semplificata per il
            gestionale interno. Non sostituisce una consulenza legale completa:
            se servi clienti finali con moduli privacy dedicati, integra o fai
            revisionare il testo da un professionista.
          </p>
        </section>
      </article>
    </div>
  );
}
