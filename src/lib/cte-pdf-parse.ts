import type {
  CteCategory,
  CteNetworkLosses,
  CtePriceKind,
  CteUtility,
} from "@/generated/prisma/client";

export type CtePdfTimeBand = "MONO" | "F1" | "F2" | "F3";

export type CtePdfHit = {
  field: string;
  label: string;
  value: string;
  snippet: string;
};

export type CtePdfParseResult = {
  layout: "enel-wow" | "enel-business" | "soluzione-energia" | "generic";
  supplierName: string | null;
  offerName: string | null;
  utility: CteUtility | null;
  category: CteCategory | null;
  commercialSegment: string | null;
  priceKind: CtePriceKind | null;
  powerKwMin: number | null;
  powerKwMax: number | null;
  annualConsumptionMin: number | null;
  annualConsumptionMax: number | null;
  networkLosses: CteNetworkLosses | null;
  ccvAnnual: number | null;
  ccvMonthly: number | null;
  spread: number | null;
  validFrom: string | null;
  validTo: string | null;
  bands: Array<{ timeBand: CtePdfTimeBand; energyPrice: number }>;
  suggestedNotes: string | null;
  warnings: string[];
  hits: CtePdfHit[];
  filledFieldLabels: string[];
  emptyFieldLabels: string[];
  textChars: number;
};

const FIELD_LABELS: Record<string, string> = {
  supplierName: "Fornitore",
  offerName: "Nome CTE",
  utility: "Commodity",
  category: "Segmento",
  commercialSegment: "Segmento commerciale",
  priceKind: "Tipologia prezzo",
  powerKwMin: "Potenza min",
  powerKwMax: "Potenza max",
  annualConsumptionMin: "Consumo annuo min",
  annualConsumptionMax: "Consumo annuo max",
  networkLosses: "Perdite di rete",
  ccvAnnual: "CCV / quota fissa",
  validFrom: "Validità dal",
  validTo: "Validità al",
  bands: "Fasce prezzo",
};

const EMPTY_TRACK = [
  "supplierName",
  "offerName",
  "utility",
  "category",
  "commercialSegment",
  "priceKind",
  "powerKwMin",
  "powerKwMax",
  "annualConsumptionMin",
  "annualConsumptionMax",
  "networkLosses",
  "ccvAnnual",
  "validFrom",
  "validTo",
  "bands",
] as const;

export function parseItalianNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/[€]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  const parts = s.split(".");
  if (parts.length > 2) {
    const n = Number(s.replace(/\./g, ""));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function italianDateToIso(d: string, m: string, y: string): string | null {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function flatten(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\u00a0/g, " ");
}

function oneLine(text: string): string {
  return flatten(text).replace(/\s+/g, " ").trim();
}

function snippetAround(haystack: string, index: number, len = 90): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(haystack.length, index + len);
  return haystack.slice(start, end).replace(/\s+/g, " ").trim();
}

function addHit(
  hits: CtePdfHit[],
  field: string,
  value: string,
  haystack: string,
  index: number,
): void {
  hits.push({
    field,
    label: FIELD_LABELS[field] ?? field,
    value,
    snippet: snippetAround(haystack, index),
  });
}

function plausibleLucePrice(n: number): boolean {
  return n >= 0.05 && n <= 0.8;
}

function plausibleGasPrice(n: number): boolean {
  return n >= 0.15 && n <= 2.5;
}

function plausibleCcv(n: number): boolean {
  return n >= 10 && n <= 800;
}

function detectLayout(line: string): CtePdfParseResult["layout"] {
  if (/soluzione energia impresa/i.test(line) || (/F1\s+F2\s+F3/.test(line) && /pmi/i.test(line))) {
    return "soluzione-energia";
  }
  if (/enel fix wow/i.test(line) || /condizioni tecnico economiche/i.test(line) && /wow/i.test(line)) {
    return "enel-wow";
  }
  if (/enel fix business/i.test(line) || /componente energia/i.test(line)) {
    return "enel-business";
  }
  return "generic";
}

function extractOfferName(text: string, line: string, hits: CtePdfHit[]): string | null {
  const titled = text.match(/^(Enel Fix [A-Za-z0-9 ]+?)$/im);
  if (titled?.[1] && !/_/.test(titled[1])) {
    const name = titled[1].trim();
    addHit(hits, "offerName", name, titled[0], 0);
    return name;
  }
  const afterOfferta = text.match(/Offerta Luce\s*\n\s*([^\n]+)/i);
  if (afterOfferta?.[1]) {
    const name = afterOfferta[1].trim();
    if (name.length >= 4 && name.length <= 80 && !/valida per/i.test(name)) {
      addHit(hits, "offerName", name, afterOfferta[0], 0);
      return name;
    }
  }
  const wow = line.match(/\b(Enel Fix WOW (?:Luce|Gas))\b/i);
  if (wow?.[1]) {
    addHit(hits, "offerName", wow[1], line, wow.index ?? 0);
    return wow[1];
  }
  const business = line.match(/\b(Enel Fix Business(?: Start)? Luce)\b/i);
  if (business?.[1]) {
    addHit(hits, "offerName", business[1], line, business.index ?? 0);
    return business[1];
  }
  const se = line.match(/\b(Soluzione Energia Impresa Pmi)\b/i);
  if (se?.[1]) {
    addHit(hits, "offerName", se[1], line, se.index ?? 0);
    return se[1];
  }
  return null;
}

function extractSupplierName(line: string, hits: CtePdfHit[]): string | null {
  const m = line.match(/\b(Enel Energia)\b/i);
  if (m?.[1]) {
    addHit(hits, "supplierName", "Enel Energia", line, m.index ?? 0);
    return "Enel Energia";
  }
  return null;
}

function extractUtility(line: string, offerName: string | null, hits: CtePdfHit[]): CteUtility | null {
  if (/prezzo gas|€\/smc|euro\/smc|gas naturale|offerta gas|wow gas/i.test(line) && !/energia elettrica/i.test(offerName ?? "")) {
    if (/wow gas|prezzo gas|€\/smc|euro\/smc/i.test(line) && !/offerta luce|prezzo luce|componente energia/i.test(line.slice(0, 400))) {
      if (/prezzo gas|wow gas|€\/smc/i.test(line)) {
        addHit(hits, "utility", "GAS", line, line.search(/gas/i));
        return "GAS";
      }
    }
  }
  if (/wow gas/i.test(offerName ?? "") || /wow gas/i.test(line)) {
    addHit(hits, "utility", "GAS", line, line.search(/wow gas/i));
    return "GAS";
  }
  if (
    /offerta luce|prezzo luce|componente energia|energia elettrica|€\/kwh|euro\/kwh|wow luce/i.test(
      line,
    )
  ) {
    addHit(hits, "utility", "LUCE", line, line.search(/luce|kwh|energia elettrica/i));
    return "LUCE";
  }
  return null;
}

function extractCategory(line: string, hits: CtePdfHit[]): CteCategory | null {
  if (/condomin/i.test(line)) {
    addHit(hits, "category", "CONDOMINI", line, line.search(/condomin/i));
    return "CONDOMINI";
  }
  if (/non domest/i.test(line) || /uso non domestico/i.test(line) || /\bpmi\b/i.test(line)) {
    addHit(hits, "category", "BUSINESS", line, line.search(/non domest|pmi/i));
    return "BUSINESS";
  }
  if (/uso domestico|clienti domestici|siti ad uso domestico/i.test(line)) {
    addHit(hits, "category", "RESIDENZIALE", line, line.search(/domestico/i));
    return "RESIDENZIALE";
  }
  return null;
}

function extractCommercialSegment(line: string, hits: CtePdfHit[]): string | null {
  const m = line.match(/\b(AC MICRO|AC SMALL|AC MEDIUM [AB]|AC MEDIUM)\b/i);
  if (!m?.[1]) return null;
  addHit(hits, "commercialSegment", m[1].toUpperCase(), line, m.index ?? 0);
  return m[1].toUpperCase();
}

function extractPriceKind(line: string, hits: CtePdfHit[]): CtePriceKind | null {
  if (/offerta a prezzo fisso|prezzo della componente energia monorario|fissi e invariabili/i.test(line)) {
    addHit(hits, "priceKind", "FISSO", line, line.search(/fisso|fissi/i));
    return "FISSO";
  }
  if (/tipologia di prezzo\??\s*offerta a prezzo variabile|prezzo variabile\/indicizzat/i.test(line)) {
    addHit(hits, "priceKind", "VARIABILE", line, line.search(/variabile/i));
    return "VARIABILE";
  }
  if (/prezzo fisso \(pfi\)/i.test(line)) {
    addHit(hits, "priceKind", "FISSO", line, line.search(/prezzo fisso/i));
    return "FISSO";
  }
  return null;
}

function extractPower(line: string, hits: CtePdfHit[], warnings: string[]): {
  min: number | null;
  max: number | null;
} {
  const rangeGeLt = line.match(
    /potenza contrattuale maggiore o uguale a\s*([\d.,]+)\s*kW(?:h)?\s*ed inferiore a\s*([\d.,]+)\s*kW/i,
  );
  if (rangeGeLt) {
    const min = parseItalianNumber(rangeGeLt[1] ?? "");
    const max = parseItalianNumber(rangeGeLt[2] ?? "");
    if (min != null) addHit(hits, "powerKwMin", String(min), line, rangeGeLt.index ?? 0);
    if (max != null) {
      addHit(hits, "powerKwMax", String(max), line, rangeGeLt.index ?? 0);
      warnings.push(
        `PDF: potenza inferiore a ${max} kW — il massimo inserito è il numero letto, verifica se va escluso.`,
      );
    }
    return { min, max };
  }
  const fromTo = line.match(/potenza contrattuale da\s*([\d.,]+)\s*a\s*([\d.,]+)\s*kW/i);
  if (fromTo) {
    const min = parseItalianNumber(fromTo[1] ?? "");
    const max = parseItalianNumber(fromTo[2] ?? "");
    if (min != null) addHit(hits, "powerKwMin", String(min), line, fromTo.index ?? 0);
    if (max != null) addHit(hits, "powerKwMax", String(max), line, fromTo.index ?? 0);
    return { min, max };
  }
  const notOver = line.match(
    /potenza contrattuale non superiore a\s*([\d.,]+)\s*kW/i,
  );
  if (notOver) {
    const max = parseItalianNumber(notOver[1] ?? "");
    if (max != null) addHit(hits, "powerKwMax", String(max), line, notOver.index ?? 0);
    return { min: null, max };
  }
  return { min: null, max: null };
}

function extractConsumption(line: string, utility: CteUtility | null, hits: CtePdfHit[]): {
  min: number | null;
  max: number | null;
} {
  const unit = utility === "GAS" ? "Smc" : "kWh";
  const inf = line.match(
    new RegExp(
      `consumi annui inferiori a\\s*([\\d.]+)\\s*${utility === "GAS" ? "Smc" : "kWh"}`,
      "i",
    ),
  );
  if (inf) {
    const max = parseItalianNumber(inf[1] ?? "");
    if (max != null && max >= 1000) {
      addHit(hits, "annualConsumptionMax", `${max} ${unit}`, line, inf.index ?? 0);
      return { min: null, max };
    }
  }
  const fino = line.match(
    new RegExp(`consumi annui fino a\\s*([\\d.]+)\\s*${utility === "GAS" ? "Smc" : "kWh"}`, "i"),
  );
  if (fino) {
    const max = parseItalianNumber(fino[1] ?? "");
    if (max != null && max >= 1000) {
      addHit(hits, "annualConsumptionMax", `${max} ${unit}`, line, fino.index ?? 0);
      return { min: null, max };
    }
  }
  return { min: null, max: null };
}

function extractValidity(
  line: string,
  hits: CtePdfHit[],
): { from: string | null; to: string | null } {
  const dalAl = line.match(
    /adesioni dal\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+al\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (dalAl) {
    const from = italianDateToIso(dalAl[1]!, dalAl[2]!, dalAl[3]!);
    const to = italianDateToIso(dalAl[4]!, dalAl[5]!, dalAl[6]!);
    if (from) addHit(hits, "validFrom", from, line, dalAl.index ?? 0);
    if (to) addHit(hits, "validTo", to, line, dalAl.index ?? 0);
    return { from, to };
  }
  const entro = line.match(/adesioni entro il\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (entro) {
    const to = italianDateToIso(entro[1]!, entro[2]!, entro[3]!);
    if (to) addHit(hits, "validTo", to, line, entro.index ?? 0);
    return { from: null, to };
  }
  return { from: null, to: null };
}

function extractCcv(
  line: string,
  hits: CtePdfHit[],
  warnings: string[],
): number | null {
  const ccv = line.match(
    /corrispettivo annuo ccv luce\s*([\d.,]+)\s*(?:€|Euro)\s*\/\s*POD\s*\/\s*anno/i,
  );
  if (ccv) {
    const n = parseItalianNumber(ccv[1] ?? "");
    if (n != null && plausibleCcv(n)) {
      addHit(hits, "ccvAnnual", String(n), line, ccv.index ?? 0);
      return n;
    }
  }
  const quota = line.match(
    /quota fissa\s+([\d.,]+)\s*(?:€|Euro)\s*\/\s*(?:POD|PDR)\s*\/\s*anno/i,
  );
  if (quota) {
    const n = parseItalianNumber(quota[1] ?? "");
    if (n != null && plausibleCcv(n)) {
      addHit(hits, "ccvAnnual", String(n), line, quota.index ?? 0);
      if (/dispbt/i.test(line)) {
        warnings.push("Quota fissa del PDF include CCV + DispBT: verifica se va usata intera come CCV catalogo.");
      }
      return n;
    }
  }
  return null;
}

function extractMonoPrice(
  line: string,
  utility: CteUtility | null,
  hits: CtePdfHit[],
): number | null {
  if (utility === "GAS") {
    const gas = line.match(/prezzo gas\s+([\d.,]+)\s*(?:€|Euro)\s*\/\s*Smc/i);
    if (gas) {
      const n = parseItalianNumber(gas[1] ?? "");
      if (n != null && plausibleGasPrice(n)) {
        addHit(hits, "bands", `MONO ${n} €/Smc`, line, gas.index ?? 0);
        return n;
      }
    }
    return null;
  }
  const luce = line.match(/prezzo luce\s+([\d.,]+)\s*(?:€|Euro)\s*\/\s*kWh/i);
  if (luce) {
    const n = parseItalianNumber(luce[1] ?? "");
    if (n != null && plausibleLucePrice(n)) {
      addHit(hits, "bands", `MONO ${n} €/kWh`, line, luce.index ?? 0);
      return n;
    }
  }
  const comp = line.match(/componente energia\s+([\d.,]+)\s*(?:€|Euro)\s*\/\s*kWh/i);
  if (comp) {
    const n = parseItalianNumber(comp[1] ?? "");
    if (n != null && plausibleLucePrice(n)) {
      addHit(hits, "bands", `MONO ${n} €/kWh`, line, comp.index ?? 0);
      return n;
    }
  }
  return null;
}

type FasciaTrio = { f1: number; f2: number; f3: number; kind: "bt-included" | "mt-excluded" | "unknown"; index: number };

function extractFasciaTrios(line: string): FasciaTrio[] {
  const out: FasciaTrio[] = [];
  const re =
    /F1\s+F2\s+F3\s+([\d.,]+)\s*(?:Euro|€)\s*\/\s*kWh\s+([\d.,]+)\s*(?:Euro|€)\s*\/\s*kWh\s+([\d.,]+)\s*(?:Euro|€)\s*\/\s*kWh/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const f1 = parseItalianNumber(m[1] ?? "");
    const f2 = parseItalianNumber(m[2] ?? "");
    const f3 = parseItalianNumber(m[3] ?? "");
    if (
      f1 == null ||
      f2 == null ||
      f3 == null ||
      !plausibleLucePrice(f1) ||
      !plausibleLucePrice(f2) ||
      !plausibleLucePrice(f3)
    ) {
      continue;
    }
    const ctx = line.slice(Math.max(0, m.index - 220), m.index + 80).toLowerCase();
    let kind: FasciaTrio["kind"] = "unknown";
    if (/alimentati in mt|perdite di rete escluse/.test(ctx)) kind = "mt-excluded";
    else if (/alimentati in bt|perdite di rete incluse/.test(ctx)) kind = "bt-included";
    out.push({ f1, f2, f3, kind, index: m.index });
  }
  return out;
}

function extractNetworkLosses(
  line: string,
  utility: CteUtility | null,
  usedBtIncluded: boolean,
  hits: CtePdfHit[],
): CteNetworkLosses | null {
  if (utility === "GAS") {
    addHit(hits, "networkLosses", "NOT_APPLICABLE", line, 0);
    return "NOT_APPLICABLE";
  }
  if (usedBtIncluded || /comprensiv[oi] delle perdite|perdite di rete incluse|prezzo luce è comprensivo delle perdite/i.test(line)) {
    addHit(hits, "networkLosses", "INCLUDED", line, line.search(/perdite/i));
    return "INCLUDED";
  }
  if (/perdite di rete escluse/i.test(line) && !/perdite di rete incluse/i.test(line)) {
    addHit(hits, "networkLosses", "EXCLUDED", line, line.search(/escluse/i));
    return "EXCLUDED";
  }
  return null;
}

/**
 * Mapper CTE da testo PDF (livello testo). Non inventa numeri assenti.
 */
export function parseCtePdfText(rawText: string): CtePdfParseResult {
  const text = flatten(rawText);
  const line = oneLine(text);
  const hits: CtePdfHit[] = [];
  const warnings: string[] = [];
  const noteParts: string[] = [];

  const layout = detectLayout(line);
  const supplierName = extractSupplierName(line, hits);
  const offerName = extractOfferName(text, line, hits);
  const utility = extractUtility(line, offerName, hits);
  const category = extractCategory(line, hits);
  const commercialSegment = extractCommercialSegment(line, hits);
  const priceKind = extractPriceKind(line, hits);
  const power = extractPower(line, hits, warnings);
  const consumption = extractConsumption(line, utility, hits);
  const validity = extractValidity(line, hits);
  const ccvAnnual = extractCcv(line, hits, warnings);

  const trios = extractFasciaTrios(line);
  const btTrio = trios.find((t) => t.kind === "bt-included") ?? (layout === "soluzione-energia" ? trios[0] : undefined);
  const mtTrio = trios.find((t) => t.kind === "mt-excluded");

  let bands: CtePdfParseResult["bands"] = [];
  if (btTrio) {
    bands = [
      { timeBand: "F1", energyPrice: btTrio.f1 },
      { timeBand: "F2", energyPrice: btTrio.f2 },
      { timeBand: "F3", energyPrice: btTrio.f3 },
    ];
    addHit(
      hits,
      "bands",
      `F1 ${btTrio.f1} / F2 ${btTrio.f2} / F3 ${btTrio.f3} €/kWh`,
      line,
      btTrio.index,
    );
    if (mtTrio) {
      warnings.push(
        `Trovata anche tabella MT (perdite escluse) F1 ${mtTrio.f1} / F2 ${mtTrio.f2} / F3 ${mtTrio.f3} — non applicata. Se serve MT, copiala a mano.`,
      );
    }
    const monoBt = line.match(
      /punti di prelievo trattati monorari PFi\s*=\s*([\d.,]+)\s*(?:Euro|€)\s*\/\s*kWh/i,
    );
    if (monoBt) {
      const n = parseItalianNumber(monoBt[1] ?? "");
      if (n != null && plausibleLucePrice(n)) {
        warnings.push(`Trovato anche prezzo monorario BT ${n} €/kWh — non applicato (usate F1/F2/F3).`);
      }
    }
    noteParts.push("Prezzi F1/F2/F3 da tabella BT (perdite incluse).");
  } else {
    const mono = extractMonoPrice(line, utility, hits);
    if (mono != null) {
      bands = [{ timeBand: "MONO", energyPrice: mono }];
    }
  }

  const usedBt = Boolean(btTrio);
  const networkLosses = extractNetworkLosses(line, utility, usedBt, hits);

  if (layout === "enel-wow" && /dispbt/i.test(line) && ccvAnnual != null) {
    noteParts.push("Quota fissa PDF = CCV Enel + DispBT ARERA.");
  }

  if (text.trim().length < 200) {
    warnings.push(
      "Il PDF non ha un livello testo sufficiente. Compila i campi a mano (nessun OCR aggiuntivo).",
    );
  }

  const filled: Record<string, boolean> = {
    supplierName: Boolean(supplierName),
    offerName: Boolean(offerName),
    utility: Boolean(utility),
    category: Boolean(category),
    commercialSegment: Boolean(commercialSegment),
    priceKind: Boolean(priceKind),
    powerKwMin: power.min != null,
    powerKwMax: power.max != null,
    annualConsumptionMin: consumption.min != null,
    annualConsumptionMax: consumption.max != null,
    networkLosses: Boolean(networkLosses),
    ccvAnnual: ccvAnnual != null,
    validFrom: Boolean(validity.from),
    validTo: Boolean(validity.to),
    bands: bands.length > 0,
  };

  const filledFieldLabels = EMPTY_TRACK.filter((k) => filled[k]).map((k) => FIELD_LABELS[k] ?? k);
  const emptyFieldLabels = EMPTY_TRACK.filter((k) => !filled[k]).map((k) => FIELD_LABELS[k] ?? k);

  return {
    layout,
    supplierName,
    offerName,
    utility,
    category,
    commercialSegment,
    priceKind,
    powerKwMin: power.min,
    powerKwMax: power.max,
    annualConsumptionMin: consumption.min,
    annualConsumptionMax: consumption.max,
    networkLosses,
    ccvAnnual,
    ccvMonthly: null,
    spread: null,
    validFrom: validity.from,
    validTo: validity.to,
    bands,
    suggestedNotes: noteParts.length ? noteParts.join(" ") : null,
    warnings,
    hits,
    filledFieldLabels,
    emptyFieldLabels,
    textChars: text.trim().length,
  };
}

export function matchSupplierId(
  extractedName: string | null,
  suppliers: Array<{ id: string; name: string; code?: string | null }>,
): { supplierId: string | null; matchedName: string | null } {
  if (!extractedName || suppliers.length === 0) {
    return { supplierId: null, matchedName: null };
  }
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/s\.?p\.?a\.?/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(extractedName);
  const exact = suppliers.find((s) => norm(s.name) === target);
  if (exact) return { supplierId: exact.id, matchedName: exact.name };
  const contains = suppliers.find(
    (s) => norm(s.name).includes(target) || target.includes(norm(s.name)),
  );
  if (contains) return { supplierId: contains.id, matchedName: contains.name };
  const first = target.split(" ")[0];
  if (first && first.length >= 4) {
    const token = suppliers.find((s) => norm(s.name).includes(first) || (s.code && norm(s.code).includes(first)));
    if (token) return { supplierId: token.id, matchedName: token.name };
  }
  return { supplierId: null, matchedName: null };
}
