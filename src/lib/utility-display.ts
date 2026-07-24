import { SERVICE_OPTIONS } from "@/lib/constants";

export type UtilityKind = "LUCE" | "GAS" | "ALTRO";

export type UtilityDisplay = {
  kind: UtilityKind;
  /** Etichetta UI: Luce, Gas, Altro */
  serviceLabel: string;
  /** Riga tecnica (POD/PDR/identificativo) */
  techLines: string[];
  /** Testo unico per filtri/ordinamento */
  filterText: string;
};

const LABEL_BY_KIND: Record<UtilityKind, string> = {
  LUCE: "Luce",
  GAS: "Gas",
  ALTRO: "Altro",
};

/** Mappa valori legacy / errati → servizio canonico. */
export function normalizeUtilityRaw(raw: string | null | undefined): UtilityKind | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "_").replace(/\//g, "_");
  if (!v) return null;

  // Valori tecnici usati per errore come "servizio"
  if (v === "POD" || v === "PDR" || v === "POD_PDR" || v === "PODPDR") return null;

  if (v === "LUCE" || v === "EE" || v === "ENERGIA" || v === "POWER") return "LUCE";
  if (v === "GAS" || v === "METANO") return "GAS";

  // Legacy → Altro (con eventuale nota in serviceOther)
  if (
    v === "DUAL" ||
    v === "DUAL_LUCE_GAS" ||
    v === "DUAL_LUCE_E_GAS" ||
    v === "LUCE_GAS" ||
    v === "LUCE_E_GAS" ||
    v === "TELEFONIA" ||
    v === "TEL" ||
    v === "POS" ||
    v === "FOTOVOLTAICO" ||
    v === "FV" ||
    v === "SOLARE" ||
    v === "ALTRO" ||
    v === "OTHER"
  ) {
    return "ALTRO";
  }

  const known = SERVICE_OPTIONS.some((o) => o.value === v);
  if (known) return v as UtilityKind;
  return "ALTRO";
}

function looksLikePod(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^IT[A-Z0-9]{12,}$/i.test(v) || (v.startsWith("IT") && v.length >= 14);
}

function looksLikePdr(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14;
}

/**
 * Determina tipo servizio e testo tecnico.
 * Fonte primaria: utilityType; non usare POD/PDR come tipo servizio.
 */
export function resolveUtilityDisplay(input: {
  utilityType?: string | null;
  pod?: string | null;
  pdr?: string | null;
  podPdr?: string | null;
  serviceOther?: string | null;
}): UtilityDisplay {
  const pod = (input.pod ?? "").trim();
  const pdr = (input.pdr ?? "").trim();
  const legacy = (input.podPdr ?? "").trim();

  let kind = normalizeUtilityRaw(input.utilityType);

  // Se utilityType era un codice POD/PDR, ignoralo e inferisci dai campi tecnici
  if (!kind) {
    if (pod || looksLikePod(legacy)) kind = "LUCE";
    else if (pdr || looksLikePdr(legacy)) kind = "GAS";
    else kind = "ALTRO";
  }

  const techLines: string[] = [];
  if (kind === "LUCE") {
    const code = pod || (looksLikePod(legacy) ? legacy : "");
    if (code) techLines.push(`POD: ${code}`);
  } else if (kind === "GAS") {
    const code = pdr || (looksLikePdr(legacy) ? legacy : "");
    if (code) techLines.push(`PDR: ${code}`);
  } else {
    if (input.serviceOther?.trim()) techLines.push(input.serviceOther.trim());
    else if (legacy && !looksLikePod(legacy) && !looksLikePdr(legacy)) techLines.push(legacy);
  }

  const serviceLabel =
    kind === "ALTRO" && input.serviceOther?.trim()
      ? `Altro (${input.serviceOther.trim()})`
      : LABEL_BY_KIND[kind];

  return {
    kind,
    serviceLabel,
    techLines,
    filterText: [serviceLabel, ...techLines].join(" "),
  };
}

export function serviceOptionsForSelect(current?: string | null) {
  const base = [...SERVICE_OPTIONS];
  const cur = (current ?? "").trim().toUpperCase();
  if (cur && !base.some((o) => o.value === cur)) {
    // Mostra valore legacy in sola lettura come Altro già selezionato
    return base;
  }
  return base;
}
