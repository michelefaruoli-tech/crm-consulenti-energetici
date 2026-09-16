/** Codice errore Prisma (es. P2002) senza dati sensibili. */
export function prismaErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** True solo per il rifiuto esplicito delle transazioni su Neon HTTP. */
export function isNeonHttpTransactionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("Transactions are not supported") ||
    /transaction.*HTTP mode/i.test(msg) ||
    /HTTP mode.*transaction/i.test(msg)
  );
}

function isTimeoutError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /timeout/i.test(msg) ||
    msg.includes("504") ||
    msg.includes("FUNCTION_INVOCATION_TIMEOUT") ||
    msg.includes("Task timed out")
  );
}

/** Messaggi di validazione/permessi da mostrare così come sono. */
function isPassThroughUserMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("permesso") ||
    lower.includes("non valido") ||
    lower.includes("seleziona") ||
    lower.includes("già stato importato") ||
    lower.includes("mappatura") ||
    lower.includes("chiusa") ||
    lower.includes("non trovata") ||
    lower.includes("non indicat") ||
    lower.includes("obbligatori")
  );
}

/** Log server: codice Prisma e tipo, senza payload o dati cliente. */
export function logPrismaError(context: string, e: unknown): void {
  const code = prismaErrorCode(e);
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${context}]`, {
    prismaCode: code ?? null,
    errorName: name,
    message: message.slice(0, 400),
  });
}

/** Messaggio utente: non mascherare validazione; distinguere transazione vs timeout. */
export function friendlyNeonHttpError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : fallback;

  if (isPassThroughUserMessage(msg)) {
    return msg.slice(0, 220);
  }

  if (isNeonHttpTransactionError(e)) {
    return "Salvataggio liquidazione non riuscito (limite del database). Riprova tra qualche secondo; se persiste, segnala al supporto.";
  }

  if (isTimeoutError(e)) {
    return "Operazione troppo lunga: riprova; l'import salva i dati a lotti.";
  }

  const code = prismaErrorCode(e);
  if (code === "P2002") {
    return "Record già presente. Aggiorna la pagina e riprova.";
  }
  if (code === "P2025") {
    return "Elemento non trovato. Aggiorna la pagina e riprova.";
  }

  return msg.slice(0, 220);
}
