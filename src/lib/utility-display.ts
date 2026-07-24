import { SERVICE_OPTIONS } from "@/lib/constants";

export type UtilityKind =
  | "LUCE"
  | "GAS"
  | "DUAL"
  | "TELEFONIA"
  | "POS"
  | "FOTOVOLTAICO"
  | "ALTRO";

export type UtilityDisplay = {
  kind: UtilityKind;
  /** Etichetta UI: Luce, Gas, Dual Luce e Gas, ... */
  serviceLabel: string;
  /** Riga tecnica (POD/PDR/identificativo) senza etichetta vuota */
  techLines: string[];
  /** Testo unico per filtri/ordinamento */
  filterText: string;
};

const LABEL_BY_KIND: Record<UtilityKind, string> = {
  LUCE: "Luce",
  GAS: "Gas",
  DUAL: "Dual Luce e Gas",
  TELEFONIA: "Telefonia",
  POS: "POS",
  FOTOVOLTAICO: "Fotovoltaico",
  ALTRO: "Altro",
};

function normalizeUtilityRaw(raw: string | null | undefined): UtilityKind | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!v) return null;
  if (v === "LUCE" || v === "EE" || v === "ENERGIA" || v === "POWER") return "LUCE";
  if (v === "GAS" || v === "METANO") return "GAS";
  if (
    v === "DUAL" ||
    v === "DUAL_LUCE_GAS" ||
    v === "DUAL_LUCE_E_GAS" ||
    v === "LUCE_GAS" ||
    v === "LUCE_E_GAS"
  ) {
    return "DUAL";
  }
  if (v === "TELEFONIA" || v === "TEL" || v === "FISSA" || v === "MOBILE") return "TELEFONIA";
  if (v === "POS") return "POS";
  if (v === "FOTOVOLTAICO" || v === "FV" || v === "SOLARE") return "FOTOVOLTAICO";
  if (v === "ALTRO" || v === "OTHER") return "ALTRO";
  const known = SERVICE_OPTIONS.some((o) => o.value === v);
  if (known) return v as UtilityKind;
  return null;
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
 * Determina tipo servizio e testo tecnico da mostrare sotto POD/PDR.
 * Fonte primaria: utilityType; fallback su pod/pdr/podPdr.
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

  if (!kind) {
    const hasPod = Boolean(pod) || looksLikePod(legacy);
    const hasPdr = Boolean(pdr) || (!pod && looksLikePdr(legacy));
    if (pod && pdr) kind = "DUAL";
    else if (hasPod && hasPdr && pod !== pdr) kind = "DUAL";
    else if (hasPod) kind = "LUCE";
    else if (hasPdr) kind = "GAS";
    else if (legacy) {
      if (looksLikePod(legacy)) kind = "LUCE";
      else if (looksLikePdr(legacy)) kind = "GAS";
      else kind = "ALTRO";
    } else {
      kind = "ALTRO";
    }
  }

  const techLines: string[] = [];

  if (kind === "DUAL") {
    const podVal = pod || (looksLikePod(legacy) ? legacy : "");
    const pdrVal = pdr || (looksLikePdr(legacy) && !looksLikePod(legacy) ? legacy : "");
    if (podVal) techLines.push(`POD: ${podVal}`);
    if (pdrVal) techLines.push(`PDR: ${pdrVal}`);
    if (!techLines.length && legacy) techLines.push(legacy);
  } else if (kind === "LUCE") {
    const val = pod || legacy;
    if (val) techLines.push(val);
  } else if (kind === "GAS") {
    const val = pdr || legacy;
    if (val) techLines.push(val);
  } else {
    // Telefonia / POS / Fotovoltaico / Altro: identificativo tecnico senza etichetta POD/PDR vuota
    const val = legacy || pod || pdr || (input.serviceOther ?? "").trim();
    if (val) techLines.push(val);
  }

  const serviceLabel = LABEL_BY_KIND[kind];
  const filterText = [...techLines, serviceLabel].filter(Boolean).join(" ");

  return { kind, serviceLabel, techLines, filterText };
}

export function utilityServiceLabel(kind: UtilityKind): string {
  return LABEL_BY_KIND[kind];
}
