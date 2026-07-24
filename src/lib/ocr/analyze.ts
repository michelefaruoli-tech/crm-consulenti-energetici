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

export async function analyzeDocumentsWithOpenAI(
  files: OcrFileInput[],
): Promise<OcrExtracted> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OCR non configurato: manca OPENAI_API_KEY su Vercel / .env",
    );
  }
  const model = process.env.OCR_MODEL || "gpt-4o";

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Analizza questi ${files.length} documenti (ruoli: ${files.map((f) => `${f.filename}=${f.role}`).join(", ")}). Estrai i dati per compilare un contratto luce/gas.`,
    },
  ];

  for (const f of files) {
    const mime = f.mimeType || "application/octet-stream";
    if (mime.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${f.base64}`,
          detail: "high",
        },
      });
    } else if (mime === "application/pdf") {
      // Molti account OpenAI accettano PDF come file input nelle Responses;
      // in Chat Completions alleghiamo nota + tentativo data URL.
      content.push({
        type: "text",
        text: `[PDF allegato: ${f.filename}, ruolo ${f.role}. Se non riesci a leggere il PDF binario qui sotto, indica warning.]`,
      });
      content.push({
        type: "image_url",
        image_url: {
          url: `data:application/pdf;base64,${f.base64}`,
        },
      });
    } else {
      content.push({
        type: "text",
        text: `[File non immagine: ${f.filename} (${mime}) — ignora se non leggibile]`,
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
    if (res.status === 401) throw new Error("Chiave OpenAI non valida");
    if (res.status === 429) throw new Error("Limite OpenAI raggiunto, riprova tra poco");
    throw new Error("Analisi documenti non riuscita (provider AI)");
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
