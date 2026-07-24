import { z } from "zod";

export const ConfidenceSchema = z.enum(["high", "medium", "review"]);

export const ExtractedValueSchema = z.object({
  value: z.string().nullable(),
  source: z.string(),
  confidence: ConfidenceSchema,
});

export const OcrExtractedSchema = z.object({
  documentTypes: z.array(z.string()).default([]),
  clientType: z.enum(["PRIVATO", "AZIENDA"]).nullable().optional(),
  customer: z
    .object({
      firstName: ExtractedValueSchema.optional(),
      lastName: ExtractedValueSchema.optional(),
      companyName: ExtractedValueSchema.optional(),
      fiscalCode: ExtractedValueSchema.optional(),
      vatNumber: ExtractedValueSchema.optional(),
      phone: ExtractedValueSchema.optional(),
      email: ExtractedValueSchema.optional(),
      pec: ExtractedValueSchema.optional(),
      street: ExtractedValueSchema.optional(),
      streetNumber: ExtractedValueSchema.optional(),
      zipCode: ExtractedValueSchema.optional(),
      city: ExtractedValueSchema.optional(),
      province: ExtractedValueSchema.optional(),
      region: ExtractedValueSchema.optional(),
      legalFirstName: ExtractedValueSchema.optional(),
      legalLastName: ExtractedValueSchema.optional(),
      iban: ExtractedValueSchema.optional(),
    })
    .default({}),
  supply: z
    .object({
      service: ExtractedValueSchema.optional(),
      pod: ExtractedValueSchema.optional(),
      pdr: ExtractedValueSchema.optional(),
      street: ExtractedValueSchema.optional(),
      streetNumber: ExtractedValueSchema.optional(),
      zipCode: ExtractedValueSchema.optional(),
      city: ExtractedValueSchema.optional(),
      province: ExtractedValueSchema.optional(),
      region: ExtractedValueSchema.optional(),
      annualKwh: ExtractedValueSchema.optional(),
      annualSmc: ExtractedValueSchema.optional(),
      powerKw: ExtractedValueSchema.optional(),
      supplierName: ExtractedValueSchema.optional(),
      productName: ExtractedValueSchema.optional(),
      paymentMethod: ExtractedValueSchema.optional(),
      classification: ExtractedValueSchema.optional(),
    })
    .default({}),
  warnings: z.array(z.string()).default([]),
  conflicts: z
    .array(
      z.object({
        field: z.string(),
        values: z.array(z.string()),
        message: z.string(),
      }),
    )
    .default([]),
});

export type OcrExtracted = z.infer<typeof OcrExtractedSchema>;
export type ExtractedValue = z.infer<typeof ExtractedValueSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Campi applicabili al form nuovo contratto */
export type OcrApplyPayload = {
  clientType?: "PRIVATO" | "AZIENDA";
  firstName?: string;
  lastName?: string;
  companyName?: string;
  fiscalCode?: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
  pec?: string;
  street?: string;
  streetNumber?: string;
  zipCode?: string;
  city?: string;
  province?: string;
  region?: string;
  legalFirstName?: string;
  legalLastName?: string;
  iban?: string;
  classification?: string;
  supplySame?: boolean;
  supplyStreet?: string;
  supplyStreetNumber?: string;
  supplyZip?: string;
  supplyCity?: string;
  supplyProvince?: string;
  supplyRegion?: string;
  supplierName?: string;
  productName?: string;
  paymentMethod?: string;
  services?: Array<{
    service: "LUCE" | "GAS" | "ALTRO";
    pod?: string;
    pdr?: string;
    annualKwh?: string;
    annualSmc?: string;
    powerKw?: string;
  }>;
};
