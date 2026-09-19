import { z } from "zod";

const optionalDecimal = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim() ?? "";
    if (!t) return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((v) => v === null || !Number.isNaN(v), "Numero non valido");

const optionalDate = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim() ?? "";
    if (!t) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  });

export const ctePriceBandSchema = z.object({
  timeBand: z.enum(["MONO", "F1", "F2", "F3"]),
  energyPrice: z
    .string()
    .min(1, "Prezzo obbligatorio")
    .transform((v) => Number(v.replace(",", ".")))
    .refine((n) => Number.isFinite(n) && n >= 0, "Prezzo non valido"),
});

export const cteOfferFormSchema = z
  .object({
    supplierId: z.string().min(1, "Fornitore obbligatorio"),
    utility: z.enum(["LUCE", "GAS"]),
    category: z.enum(["RESIDENZIALE", "BUSINESS", "CONDOMINI"]),
    commercialSegment: z.string().optional(),
    offerName: z.string().min(1, "Nome CTE obbligatorio"),
    priceKind: z.enum(["FISSO", "VARIABILE"]),
    powerKwMin: optionalDecimal,
    powerKwMax: optionalDecimal,
    annualConsumptionMin: optionalDecimal,
    annualConsumptionMax: optionalDecimal,
    referenceConsumption: optionalDecimal,
    networkLosses: z.enum(["INCLUDED", "EXCLUDED", "NOT_APPLICABLE"]),
    ccvAnnual: optionalDecimal,
    ccvMonthly: optionalDecimal,
    spread: optionalDecimal,
    validFrom: optionalDate,
    validTo: optionalDate,
    notes: z.string().optional(),
    extractionOrigin: z.enum(["manual", "pdf"]).optional(),
    bands: z.array(ctePriceBandSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.validFrom && data.validTo && data.validFrom > data.validTo) {
      ctx.addIssue({
        code: "custom",
        message: "La data di inizio deve precedere la fine validità",
        path: ["validTo"],
      });
    }

    if (data.priceKind === "VARIABILE" && data.spread == null) {
      ctx.addIssue({
        code: "custom",
        message: "Spread obbligatorio per offerte variabili",
        path: ["spread"],
      });
    }

    if (data.priceKind === "FISSO" && data.bands.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Inserire almeno una fascia di prezzo (MONO o F1/F2/F3)",
        path: ["bands"],
      });
    }

    if (data.utility === "GAS" && data.networkLosses === "EXCLUDED") {
      ctx.addIssue({
        code: "custom",
        message: "Per il gas usare perdite non applicabili o incluse",
        path: ["networkLosses"],
      });
    }
  });

export type CteOfferFormValues = z.infer<typeof cteOfferFormSchema>;

export function parseCteFormData(formData: FormData): CteOfferFormValues {
  const bands: Array<{ timeBand: "MONO" | "F1" | "F2" | "F3"; energyPrice: string }> = [];
  const timeBands = formData.getAll("bandTime");
  const prices = formData.getAll("bandPrice");
  for (let i = 0; i < timeBands.length; i++) {
    const timeBand = String(timeBands[i] ?? "").trim();
    const energyPrice = String(prices[i] ?? "").trim();
    if (!timeBand || !energyPrice) continue;
    if (!["MONO", "F1", "F2", "F3"].includes(timeBand)) continue;
    bands.push({ timeBand: timeBand as "MONO" | "F1" | "F2" | "F3", energyPrice });
  }

  return cteOfferFormSchema.parse({
    supplierId: String(formData.get("supplierId") ?? ""),
    utility: String(formData.get("utility") ?? "LUCE"),
    category: String(formData.get("category") ?? "RESIDENZIALE"),
    commercialSegment: String(formData.get("commercialSegment") ?? ""),
    offerName: String(formData.get("offerName") ?? ""),
    priceKind: String(formData.get("priceKind") ?? "FISSO"),
    powerKwMin: String(formData.get("powerKwMin") ?? ""),
    powerKwMax: String(formData.get("powerKwMax") ?? ""),
    annualConsumptionMin: String(formData.get("annualConsumptionMin") ?? ""),
    annualConsumptionMax: String(formData.get("annualConsumptionMax") ?? ""),
    referenceConsumption: String(formData.get("referenceConsumption") ?? ""),
    networkLosses: String(formData.get("networkLosses") ?? "INCLUDED"),
    ccvAnnual: String(formData.get("ccvAnnual") ?? ""),
    ccvMonthly: String(formData.get("ccvMonthly") ?? ""),
    spread: String(formData.get("spread") ?? ""),
    validFrom: String(formData.get("validFrom") ?? ""),
    validTo: String(formData.get("validTo") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    extractionOrigin: String(formData.get("extractionOrigin") ?? "manual") === "pdf" ? "pdf" : "manual",
    bands,
  });
}

/** Max 3 MB per PDF CTE (storage postgres base64, come allegati contratto). */
export const CTE_PDF_MAX_BYTES = 3 * 1024 * 1024;

/** Max PDF selezionabili insieme su Nuova CTE (coda sequenziale). */
export const CTE_PDF_MAX_FILES = 15;
