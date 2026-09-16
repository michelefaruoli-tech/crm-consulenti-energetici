/** Messaggi utente quando Prisma Neon HTTP rifiuta transazioni implicite. */
export function friendlyNeonHttpError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : fallback;
  if (
    msg.includes("Transactions are not supported") ||
    msg.includes("HTTP mode")
  ) {
    return "Operazione sul database non riuscita. Riprova tra qualche secondo; se persiste, segnala al supporto.";
  }
  return msg.slice(0, 200);
}
