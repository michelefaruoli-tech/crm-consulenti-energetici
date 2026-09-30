/**
 * P1.4 — checklist documenti configurabile per fornitore/servizio/tipo cliente.
 * Solo UI/validazione flusso: nessuna migrazione schema.
 */

export type DocumentChecklistItem = {
  /** Chiave allineata a DOC_TYPE_OPTIONS / Document.docType */
  docType: string;
  label: string;
  /** In checklist (consigliato per integrazione; non hard-block se c’è almeno un allegato) */
  required: boolean;
  /** Suggerito ma non bloccante */
  recommended?: boolean;
};

export type DocumentChecklistInput = {
  clientType: "PRIVATO" | "AZIENDA";
  /** LUCE | GAS | DUAL | TELEFONIA | … */
  service?: string | null;
  supplierName?: string | null;
  paymentMethod?: string | null;
};

function fileHint(
  filename: string | null | undefined,
  patterns: RegExp,
): boolean {
  return patterns.test(String(filename ?? "").toLowerCase());
}

function hasDocType(
  attached: ReadonlyArray<{ docType?: string | null; filename?: string | null }>,
  docType: string,
): boolean {
  const want = docType.toUpperCase();
  return attached.some((a) => {
    const t = String(a.docType ?? "").toUpperCase();
    if (t === want) return true;
    // CI unico vale anche come fronte/retro singolo
    if ((want === "CI_FRONTE" || want === "CI_RETRO") && t === "CI_UNICO") {
      return true;
    }
    // Heuristica nome file se docType generico/assente
    if (!t || t === "ALTRO") {
      if (want === "BOLLETTA" && fileHint(a.filename, /fattur|bollett|bill/)) {
        return true;
      }
      if (want === "VISURA" && fileHint(a.filename, /visura/)) return true;
      if (want === "CI_FRONTE" && fileHint(a.filename, /fronte|front/)) return true;
      if (want === "CI_RETRO" && fileHint(a.filename, /retro|back/)) return true;
      if (
        want === "CI_UNICO" &&
        fileHint(a.filename, /(ci|carta.?ident|identit|patente|passaporto)/)
      ) {
        return true;
      }
      if (want === "SEPA" && fileHint(a.filename, /sepa|mandato|rid/)) return true;
    }
    return false;
  });
}

/** Copertura identità: unico documento o fronte+retro. */
function identityCovered(
  attached: ReadonlyArray<{ docType?: string | null; filename?: string | null }>,
): boolean {
  if (hasDocType(attached, "CI_UNICO")) return true;
  return hasDocType(attached, "CI_FRONTE") && hasDocType(attached, "CI_RETRO");
}

/**
 * Checklist documentale in base a contesto pratica.
 * Estendibile per fornitore senza toccare lo schema DB.
 */
export function getDocumentChecklist(
  input: DocumentChecklistInput,
): DocumentChecklistItem[] {
  const items: DocumentChecklistItem[] = [];
  const supplier = String(input.supplierName ?? "").toLowerCase();
  const service = String(input.service ?? "").toUpperCase();
  const isEnergy = service === "LUCE" || service === "GAS" || service === "DUAL";

  if (input.clientType === "PRIVATO") {
    items.push({
      docType: "CI_UNICO",
      label: "Documento di identità",
      required: true,
    });
  } else {
    items.push({
      docType: "VISURA",
      label: "Visura camerale",
      required: true,
    });
    items.push({
      docType: "DOC_AMM",
      label: "Documento amministratore / legale rappresentante",
      required: false,
      recommended: true,
    });
  }

  if (isEnergy || !service) {
    items.push({
      docType: "BOLLETTA",
      label: service === "GAS" ? "Bolletta gas" : "Bolletta / fattura luce",
      required: true,
    });
  } else {
    items.push({
      docType: "BOLLETTA",
      label: "Documento utenza / fattura",
      required: true,
    });
  }

  if (String(input.paymentMethod ?? "").toUpperCase() === "RID") {
    items.push({
      docType: "SEPA",
      label: "Mandato SEPA",
      required: false,
      recommended: true,
    });
  }

  items.push({
    docType: "MODULO",
    label: "Modulo firmato / proposta",
    required: false,
    recommended: true,
  });

  // Override leggeri per fornitori noti (solo UI checklist)
  if (supplier.includes("helios")) {
    const bolletta = items.find((i) => i.docType === "BOLLETTA");
    if (bolletta) bolletta.label = "Bolletta recente (Helios)";
  }

  return items;
}

export type ChecklistCoverage = {
  items: Array<
    DocumentChecklistItem & {
      present: boolean;
    }
  >;
  requiredTotal: number;
  requiredPresent: number;
  recommendedTotal: number;
  recommendedPresent: number;
  /** true se tutti i required sono presenti */
  requiredComplete: boolean;
  /** 0–100 sulla sola checklist documenti */
  percent: number;
  missingRequiredLabels: string[];
};

/**
 * Testo per email / note: documenti checklist mancanti (non bloccanti se ci sono allegati).
 * Null se la checklist required è completa.
 */
export function formatMissingDocsIntegrationNote(
  input: DocumentChecklistInput,
  attached: ReadonlyArray<{ docType?: string | null; filename?: string | null }>,
): string | null {
  const coverage = evaluateDocumentChecklist(input, attached);
  if (coverage.requiredComplete) return null;
  if (coverage.missingRequiredLabels.length === 0) return null;
  return (
    `⚠ Documenti checklist da integrare: ${coverage.missingRequiredLabels.join(", ")}. ` +
    "Invio consentito con allegati presenti; il Back Office può richiedere i file mancanti."
  );
}

export function evaluateDocumentChecklist(
  input: DocumentChecklistInput,
  attached: ReadonlyArray<{ docType?: string | null; filename?: string | null }>,
): ChecklistCoverage {
  const base = getDocumentChecklist(input);
  const items = base.map((item) => {
    let present = hasDocType(attached, item.docType);
    if (item.docType === "CI_UNICO") {
      present = identityCovered(attached);
    }
    return { ...item, present };
  });

  const required = items.filter((i) => i.required);
  const recommended = items.filter((i) => i.recommended && !i.required);
  const requiredPresent = required.filter((i) => i.present).length;
  const recommendedPresent = recommended.filter((i) => i.present).length;
  const weightRequired = required.length * 2;
  const weightRec = recommended.length;
  const weightTotal = weightRequired + weightRec || 1;
  const score =
    requiredPresent * 2 + recommendedPresent;
  const percent = Math.round((score / weightTotal) * 100);

  return {
    items,
    requiredTotal: required.length,
    requiredPresent,
    recommendedTotal: recommended.length,
    recommendedPresent,
    requiredComplete: required.every((i) => i.present),
    percent,
    missingRequiredLabels: required.filter((i) => !i.present).map((i) => i.label),
  };
}
