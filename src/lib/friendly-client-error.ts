/**
 * Messaggio leggibile in italiano per errori lato client quando una server
 * action lancia un'eccezione non gestita dal proprio try/catch interno (es.
 * un errore di valutazione del modulo, un timeout, un errore di rete): in
 * produzione Next.js nasconde il messaggio reale al browser per sicurezza
 * ("An error occurred in the Server Components render…", nessun dettaglio).
 *
 * Le azioni di questo CRM restituiscono già `{ ok: false, error: "…" }` con
 * un messaggio chiaro per gli errori previsti (permessi, validazione…): qui
 * si gestisce solo il caso residuo, quando la chiamata stessa va in eccezione
 * prima di poter tornare quel risultato.
 *
 * Nessuna chiamata al server: sicuro da importare in un componente client.
 */
const GENERIC_PATTERNS = [
  /server components render/i,
  /omitted in production/i,
  /^an error occurred$/i,
];

export function friendlyActionError(e: unknown): string {
  const raw = e instanceof Error ? e.message.trim() : String(e ?? "").trim();
  if (!raw || GENERIC_PATTERNS.some((p) => p.test(raw))) {
    return "Errore imprevisto lato server. Riprova; se il problema persiste, contatta lo sviluppatore (il messaggio reale è nei log del server, non qui per sicurezza).";
  }
  return raw;
}
