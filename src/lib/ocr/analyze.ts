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

export type OcrProviderName = "gemini" | "groq" | "openai" | "ocrspace";

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

async function analyzeWithGemini(files: OcrFileInput[]): Promise<OcrExtracted> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new ProviderError("Gemini non configurato", false, "gemini");
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
      parts.push({ text: `[File ignorato: ${f.filename}]` });
      continue;
    }
    parts.push({ inline_data: { mime_type: mime, data: f.base64 } });
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
    console.error("[ocr] gemini", res.status, errText.slice(0, 200));
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("Chiave Gemini non valida", false, "gemini");
    }
    if (res.status === 429) {
      throw new ProviderError("Limite Gemini raggiunto", true, "gemini");
    }
    throw new ProviderError("Analisi Gemini non riuscita", true, "gemini");
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw =
    json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  return parseAndValidate(raw);
}

/** Groq Vision — free tier, OpenAI-compatible */
async function analyzeWithGroq(files: OcrFileInput[]): Promise<OcrExtracted> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ProviderError("Groq non configurato", false, "groq");
  const model =
    process.env.GROQ_OCR_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${SYSTEM_PROMPT}\n\n${userPrompt(files)}` },
  ];

  let imageCount = 0;
  for (const f of files) {
    if (!f.mimeType.startsWith("image/")) {
      content.push({
        type: "text",
        text: `[PDF/altro non inviato a Groq Vision: ${f.filename}. Preferisci foto JPG/PNG delle pagine.]`,
      });
      continue;
    }
    imageCount++;
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${f.mimeType === "image/jpg" ? "image/jpeg" : f.mimeType};base64,${f.base64}`,
      },
    });
  }
  if (imageCount === 0) {
    throw new ProviderError(
      "Groq Vision richiede immagini JPG/PNG (non PDF nudo)",
      false,
      "groq",
    );
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
      max_completion_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[ocr] groq", res.status, errText.slice(0, 200));
    if (res.status === 401) {
      throw new ProviderError("Chiave Groq non valida", false, "groq");
    }
    if (res.status === 429) {
      throw new ProviderError("Limite Groq raggiunto", true, "groq");
    }
    throw new ProviderError("Analisi Groq non riuscita", true, "groq");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseAndValidate(json.choices?.[0]?.message?.content ?? "{}");
}

async function analyzeWithOpenAI(files: OcrFileInput[]): Promise<OcrExtracted> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ProviderError("OpenAI non configurato", false, "openai");
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
      content.push({ type: "text", text: `[PDF: ${f.filename}]` });
      content.push({
        type: "image_url",
        image_url: { url: `data:application/pdf;base64,${f.base64}` },
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
    console.error("[ocr] openai", res.status, errText.slice(0, 200));
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
  return parseAndValidate(json.choices?.[0]?.message?.content ?? "{}");
}

/** OCR.space (testo) + LLM testo (Groq/Gemini) — ultima spiaggia gratuita */
async function ocrSpaceExtractText(file: OcrFileInput): Promise<string> {
  const apiKey = process.env.OCRSPACE_API_KEY || "K87899142388957"; // free demo key
  const form = new FormData();
  const mime = file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType;
  const bytes = Buffer.from(file.base64, "base64");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), file.filename);
  form.append("language", "ita");
  form.append("isOverlayRequired", "false");
  form.append("OCREngine", "2");
  form.append("scale", "true");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new ProviderError("OCR.space non raggiungibile", true, "ocrspace");
  }
  const json = (await res.json()) as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
    ParsedResults?: Array<{ ParsedText?: string }>;
  };
  if (json.IsErroredOnProcessing) {
    const msg = Array.isArray(json.ErrorMessage)
      ? json.ErrorMessage.join("; ")
      : json.ErrorMessage || "errore OCR";
    throw new ProviderError(`OCR.space: ${msg}`, true, "ocrspace");
  }
  return (json.ParsedResults ?? []).map((p) => p.ParsedText ?? "").join("\n").trim();
}

async function structureTextWithLlm(ocrText: string, files: OcrFileInput[]): Promise<OcrExtracted> {
  const prompt = `${SYSTEM_PROMPT}

Testo OCR estratto dai documenti (${files.map((f) => `${f.filename}=${f.role}`).join(", ")}):

---
${ocrText.slice(0, 20000)}
---

Trasforma il testo nel JSON richiesto.`;

  // Preferisci Groq testo (limiti alti), poi Gemini testo
  if (process.env.GROQ_API_KEY) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return parseAndValidate(json.choices?.[0]?.message?.content ?? "{}");
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (geminiKey) {
    const model = process.env.GEMINI_OCR_MODEL || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const raw =
        json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
        "{}";
      return parseAndValidate(raw);
    }
  }

  throw new ProviderError(
    "OCR.space ok ma nessun LLM testo disponibile (serve GROQ_API_KEY o GEMINI_API_KEY)",
    false,
    "ocrspace",
  );
}

async function analyzeWithOcrSpace(files: OcrFileInput[]): Promise<OcrExtracted> {
  const chunks: string[] = [];
  for (const f of files) {
    const text = await ocrSpaceExtractText(f);
    if (text) chunks.push(`=== ${f.filename} (${f.role}) ===\n${text}`);
  }
  if (chunks.length === 0) {
    throw new ProviderError("OCR.space non ha letto testo utile", true, "ocrspace");
  }
  const extracted = await structureTextWithLlm(chunks.join("\n\n"), files);
  extracted.warnings.push(
    "Analisi via OCR.space (testo): controlla con attenzione i campi.",
  );
  return extracted;
}

const ALL_PROVIDERS: OcrProviderName[] = ["groq", "gemini", "openai", "ocrspace"];

function configuredProviders(): OcrProviderName[] {
  const raw = (process.env.OCR_PROVIDERS || "groq,gemini,openai,ocrspace")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const list = raw.filter((p): p is OcrProviderName =>
    ALL_PROVIDERS.includes(p as OcrProviderName),
  );
  return list.length ? list : ALL_PROVIDERS;
}

function hasKey(provider: OcrProviderName): boolean {
  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  }
  if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  // ocrspace: chiave demo sempre disponibile; serve almeno un LLM per strutturare
  if (provider === "ocrspace") {
    return Boolean(
      process.env.GROQ_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY,
    );
  }
  return false;
}

async function runProvider(
  provider: OcrProviderName,
  files: OcrFileInput[],
): Promise<OcrExtracted> {
  switch (provider) {
    case "gemini":
      return analyzeWithGemini(files);
    case "groq":
      return analyzeWithGroq(files);
    case "openai":
      return analyzeWithOpenAI(files);
    case "ocrspace":
      return analyzeWithOcrSpace(files);
  }
}

export async function analyzeDocuments(
  files: OcrFileInput[],
): Promise<{ extracted: OcrExtracted; provider: OcrProviderName }> {
  const order = configuredProviders().filter(hasKey);
  if (order.length === 0) {
    throw new Error(
      "OCR non configurato: aggiungi su Vercel almeno GROQ_API_KEY (gratis) o GEMINI_API_KEY",
    );
  }

  const errors: string[] = [];
  for (const provider of order) {
    try {
      const extracted = await runProvider(provider, files);
      return { extracted, provider };
    } catch (e) {
      if (e instanceof ProviderError) {
        errors.push(`${e.provider}: ${e.message}`);
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
    `Tutti i provider OCR non disponibili. ${errors.join(" · ")}. Aspetta qualche minuto, aggiungi GROQ_API_KEY (gratis su console.groq.com), oppure compila a mano.`,
  );
}

export async function analyzeDocumentsWithOpenAI(
  files: OcrFileInput[],
): Promise<OcrExtracted> {
  const { extracted } = await analyzeDocuments(files);
  return extracted;
}

