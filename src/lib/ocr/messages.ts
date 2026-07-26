/**
 * Messaggi OCR in italiano semplice (niente gergo tecnico).
 */

export function humanizeOcrError(raw: string): string {
  const m = raw.toLowerCase();

  if (/non autenticat|non autorizz|permesso negato/.test(m)) {
    return "Sessione scaduta o permesso mancante. Ricarica la pagina e rifai il login.";
  }
  if (/nessun documento|nessun file/.test(m)) {
    return "Carica almeno un documento (meglio una foto JPG/PNG nitida).";
  }
  if (/troppo grande|max \d+ mb/.test(m)) {
    return "File troppo grande. Riduci le foto sotto i 10 MB oppure usa meno pagine.";
  }
  if (/formato non supportato/.test(m)) {
    return "Formato non valido. Usa JPG, PNG o PDF.";
  }
  if (/access denied|groq/.test(m) && /denied|block|italy|region|forbidden|403/.test(m)) {
    return "Il servizio foto gratis (Groq) non è disponibile dalla tua rete. Prova Gemini/OpenRouter, oppure carica JPG e riprova più tardi.";
  }
  if (/rate limit|429|limite|quota|resource_exhausted/.test(m)) {
    return "Limite gratuito raggiunto per oggi. Aspetta qualche minuto, oppure riprova con foto JPG più piccole.";
  }
  if (/credito|402|insufficient|billing/.test(m)) {
    return "Credito OCR esaurito sul provider a pagamento. Usa foto JPG/PNG (percorso gratis) oppure ricarica il credito.";
  }
  if (/chiave|api.?key|401|invalid.*key|non valid|non configurat/.test(m)) {
    return "OCR non configurato correttamente sul server. Contatta l’admin (manca una chiave API).";
  }
  if (/mistral|pdf/.test(m) && /invalid input|cloudflare|plugin/.test(m)) {
    return "Questo PDF non è stato letto in automatico. Scatta una foto JPG delle pagine e riprova (più affidabile e gratis).";
  }
  if (/tutti i provider|non disponibili/.test(m)) {
    if (/jpg|png|foto/.test(m)) {
      return raw; // già contiene suggerimento
    }
    return `${raw} Consigliato: foto JPG/PNG delle bollette invece del PDF.`;
  }
  if (/timeout|timed out|aborted|network|fetch failed/.test(m)) {
    return "Connessione lenta o interrotta. Riprova con meno file o foto più leggere.";
  }

  // Truncate very long technical dumps
  if (raw.length > 280) {
    return `${raw.slice(0, 260)}… Se continua, usa foto JPG invece del PDF.`;
  }
  return raw;
}

export function ocrFileKindHint(files: Array<{ name: string; type: string }>): {
  onlyPdf: boolean;
  hasImage: boolean;
  tip: string | null;
} {
  const hasImage = files.some(
    (f) =>
      /^image\//i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name),
  );
  const hasPdf = files.some(
    (f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name),
  );
  const onlyPdf = hasPdf && !hasImage;

  if (onlyPdf) {
    return {
      onlyPdf: true,
      hasImage: false,
      tip: "Hai caricato solo PDF. Per il percorso gratis e più affidabile: scatta una foto JPG/PNG di ogni pagina. I PDF nudi spesso falliscono; Mistral OCR è l’alternativa a pagamento.",
    };
  }
  if (hasPdf && hasImage) {
    return {
      onlyPdf: false,
      hasImage: true,
      tip: "Misto PDF + foto: l’analisi userà soprattutto le immagini. Se qualcosa manca, ripeti solo con le foto.",
    };
  }
  return { onlyPdf: false, hasImage, tip: null };
}
