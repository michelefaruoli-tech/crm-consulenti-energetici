import { OcrExtractedSchema, type OcrExtracted } from "@/lib/ocr/schema";
import {
  normalizeCap,
  normalizeFiscalCode,
  normalizePaymentMethod,
  normalizePod,
  normalizePdr,
  normalizeVat,
} from "@/lib/ocr/validators";

const SYSTEM_PROMPT = `Sei un esperto di documenti italiani per un CRM energetici.
Analizza i documenti allegati (carta d'identità, patente, passaporto, tessera sanitaria, bolletta luce/gas, fattura).
Estrai SOLO dati chiaramente leggibili. Non inventare valori.
Rispondi SOLO con JSON valido, senza markdown, con questa struttura:
{
  "documentTypes": ["CI_FRONTE"|"CI_RETRO"|"PATENTE"|"PASSAPORTO"|"CF_TS"|"BOLLETTA_LUCE"|"BOLLETTA_GAS"|"ALTRO"],
  "clientType": "PRIVATO"|"AZIENDA"|null,
  "customer": {
    "firstName": {"value":"...","source":"identity_document|bill","confidence":"high|medium|review"},
    "lastName": {...},
    "companyName": {...},
    "fiscalCode": {...},
    "vatNumber": {...},
    "phone": {...},
    "email": {...},
    "pec": {...},
    "street": {...},
    "streetNumber": {...},
    "zipCode": {...},
    "city": {...},
    "province": {...},
    "region": {...},
    "legalFirstName": {...},
    "legalLastName": {...},
    "iban": {...}
  },
  "supply": {
    "service": {"value":"LUCE|GAS|ALTRO","source":"bill","confidence":"..."},
    "pod": {...},
    "pdr": {...},
    "street": {...},
    "streetNumber": {...},
    "zipCode": {...},
    "city": {...},
    "province": {...},
    "region": {...},
    "annualKwh": {...},
    "annualSmc": {...},
    "powerKw": {...},
    "supplierName": {...},
    "productName": {...},
    "paymentMethod": {"value":"BOLLETTINO|RID|...","source":"bill","confidence":"..."},
    "classification": {"value":"RESIDENTE|NON_RESIDENTE|ALTRI_USI|DOMESTICO|...","source":"bill","confidence":"..."}
  },
  "warnings": ["..."],
  "conflicts": [{"field":"...","values":["a","b"],"message":"..."}]
}
Regole:
- POD inizia con IT; PDR è tipicamente 14 cifre.
- CF italiano 16 caratteri; P.IVA 11 cifre.
- Se nome su CI e intestatario bolletta differiscono, metti conflict.
- Province come sigla (es. PZ, RM) se possibile.
- Metodo pagamento: BOLLETTINO o RID se riconoscibile.
- Ometti i campi non trovati invece di inventarli.`;

export type OcrFileInput = {
  filename: string;
  mimeType: string;
  base64: string;
  role: "identity" | "bill" | "other";
};

export type OcrProviderName = "gemini" | "openai";

class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly provider: OcrProviderName,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function postProcess(data: OcrExtracted): OcrExtracted {
  const c = data.customer;
  if (c.fiscalCode?.value) {
    const n = normalizeFiscalCode(c.fiscalCode.value);
    if (n) c.fiscalCode = { ...c.fiscalCode, value: n, confidence: "high" };
    else {
      c.fiscalCode = { ...c.fiscalCode, confidence: "review" };
      data.warnings.push("Codice fiscale formalmente non valido — verifica.");
    }
  }
  if (c.vatNumber?.value) {
    const n = normalizeVat(c.vatNumber.value);
    if (n) c.vatNumber = { ...c.vatNumber, value: n };
    else {
      c.vatNumber = { ...c.vatNumber, confidence: "review" };
      data.warnings.push("Partita IVA formalmente non valida — verifica.");
    }
  }
  if (c.zipCode?.value) {
    const n = normalizeCap(c.zipCode.value);
    if (n) c.zipCode = { ...c.zipCode, value: n };
  }
  const s = data.supply;
  if (s.pod?.value) {
    const n = normalizePod(s.pod.value);
    if (n) s.pod = { ...s.pod, value: n, confidence: "high" };
    else {
      s.pod = { ...s.pod, confidence: "review" };
      data.warnings.push("POD formalmente non valido — verifica.");
    }
  }
  if (s.pdr?.value) {
    const n = normalizePdr(s.pdr.value);
    if (n) s.pdr = { ...s.pdr, value: n, confidence: "high" };
    else {
      s.pdr = { ...s.pdr, confidence: "review" };
      data.warnings.push("PDR formalmente non valido — verifica.");
    }
  }
  if (s.zipCode?.value) {
    const n = normalizeCap(s.zipCode.value);
    if (n) s.zipCode = { ...s.zipCode, value: n };
  }
  if (s.paymentMethod?.value) {
    const n = normalizePaymentMethod(s.paymentMethod.value);
    if (n) s.paymentMethod = { ...s.paymentMethod, value: n };
  }
  return data;
}

function parseAndValidate(raw: string): OcrExtracted {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Output AI non valido (JSON)");
  }
  const validated = OcrExtractedSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[ocr] zod", validated.error.flatten());
    throw new Error("Dati estratti non validabili — riprova o compila a mano");
  }
  return postProcess(validated.data);
}

function userPrompt(files: OcrFileInput[]): string {
  return `Analizza questi ${files.length} documenti (ruoli: ${files
    .map((f) => `${f.filename}=${f.role}`)
    .join(", ")}). Estrai i dati per compilare un contratto luce/gas.`;
}

/** Gemini (free tier generoso) — supporta immagini e PDF. */
async function analyzeWithGemini(files: OcrFileInput[]): Promise<OcrExtracted> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("Gemini non configurato", false, "gemini");
  }
  const model = process.env.GEMINI_OCR_MODEL || "gemini-2.0-flash";

  const parts: Array<Record<string, unknown>> = [
    { text: `${SYSTEM_PROMPT}\n\n${userPrompt(files)}` },
  ];

  for (const f of files) {
    const mime = f.mimeType.startsWith("image/")
      ? f.mimeType === "image/jpg"
        ? "image/jpeg"
        : f.mimeType
      : f.mimeType === "application/pdf"
        ? "application/pdf"
        : null;
    if (!mime) {
      parts.push({
        text: `[File ignorato perché non immagine/PDF: ${f.filename}]`,
      });
      continue;
    }
    parts.push({
      inline_data: {
        mime_type: mime,
        data: f.base64,
      },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[ocr] gemini error", res.status, errText.slice(0, 300));
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("Chiave Gemini non valida", false, "gemini");
    }
    if (res.status === 429) {
      throw new ProviderError("Limite Gemini raggiunto", true, "gemini");
    }
    throw new ProviderError("Analisi Gemini non riuscita", true, "gemini");
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  return parseAndValidate(raw);
}

/** OpenAI Vision */
async function analyzeWithOpenAI(files: OcrFileInput[]): Promise<OcrExtracted> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OpenAI non configurato", false, "openai");
  }
  const model = process.env.OCR_MODEL || "gpt-4o";

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: userPrompt(files) },
  ];

  for (const f of files) {
    const mime = f.mimeType || "application/octet-stream";
    if (mime.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mime === "image/jpg" ? "image/jpeg" : mime};base64,${f.base64}`,
          detail: "high",
        },
      });
    } else if (mime === "application/pdf") {
      content.push({
        type: "text",
        text: `[PDF: ${f.filename}, ruolo ${f.role}]`,
      });
      content.push({
        type: "image_url",
        image_url: { url: `data:application/pdf;base64,${f.base64}` },
      });
    } else {
      content.push({
        type: "text",
        text: `[File non supportato: ${f.filename}]`,
      });
    }
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[ocr] openai error", res.status, errText.slice(0, 300));
    if (res.status === 401) {
      throw new ProviderError("Chiave OpenAI non valida", false, "openai");
    }
    if (res.status === 429) {
      throw new ProviderError("Limite OpenAI raggiunto", true, "openai");
    }
    throw new ProviderError("Analisi OpenAI non riuscita", true, "openai");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  return parseAndValidate(raw);
}

function configuredProviders(): OcrProviderName[] {
  // Default: Gemini prima (free tier), poi OpenAI
  const raw = (process.env.OCR_PROVIDERS || "gemini,openai")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const list = raw.filter((p): p is OcrProviderName => p === "gemini" || p === "openai");
  return list.length ? list : ["gemini", "openai"];
}

function hasKey(provider: OcrProviderName): boolean {
  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  }
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Prova i provider nell'ordine configurato.
 * Se uno va in limite (429) o errore temporaneo, passa al successivo.
 */
export async function analyzeDocuments(
  files: OcrFileInput[],
): Promise<{ extracted: OcrExtracted; provider: OcrProviderName }> {
  const order = configuredProviders().filter(hasKey);
  if (order.length === 0) {
    throw new Error(
      "OCR non configurato: inserisci GEMINI_API_KEY e/o OPENAI_API_KEY su Vercel",
    );
  }

  const errors: string[] = [];
  for (const provider of order) {
    try {
      const extracted =
        provider === "gemini"
          ? await analyzeWithGemini(files)
          : await analyzeWithOpenAI(files);
      return { extracted, provider };
    } catch (e) {
      if (e instanceof ProviderError) {
        errors.push(`${e.provider}: ${e.message}`);
        // passa al successivo se retryable o se ci sono altri provider
        continue;
      }
      if (e instanceof Error) {
        errors.push(e.message);
        continue;
      }
      errors.push("Errore sconosciuto");
    }
  }

  throw new Error(
    `Tutti i provider OCR non disponibili. ${errors.join(" · ")}. Riprova tra poco o compila a mano.`,
  );
}

/** @deprecated usa analyzeDocuments */
export async function analyzeDocumentsWithOpenAI(
  files: OcrFileInput[],
): Promise<OcrExtracted> {
  const { extracted } = await analyzeDocuments(files);
  return extracted;
}
