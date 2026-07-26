"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type {
  Confidence,
  ExtractedValue,
  OcrApplyPayload,
  OcrExtracted,
} from "@/lib/ocr/schema";
import { AttachmentDropZone } from "@/components/contracts/attachment-drop-zone";
import { humanizeOcrError, ocrFileKindHint } from "@/lib/ocr/messages";

type LocalFile = {
  id: string;
  file: File;
  role: "identity" | "bill";
  previewUrl?: string;
};

type ReviewRow = {
  key: string;
  label: string;
  group: string;
  value: string;
  source: string;
  confidence: Confidence;
  selected: boolean;
};

function confLabel(c: Confidence) {
  if (c === "high") return "Affidabilità alta";
  if (c === "medium") return "Affidabilità media";
  return "Da verificare";
}

function confClass(c: Confidence) {
  if (c === "high") return "text-emerald-700";
  if (c === "medium") return "text-amber-700";
  return "text-red-700";
}

function pushField(
  rows: ReviewRow[],
  key: string,
  label: string,
  group: string,
  field?: ExtractedValue,
) {
  if (!field?.value) return;
  rows.push({
    key,
    label,
    group,
    value: field.value,
    source: field.source,
    confidence: field.confidence,
    selected: field.confidence !== "review",
  });
}

function toRows(extracted: OcrExtracted): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const c = extracted.customer;
  pushField(rows, "firstName", "Nome", "Cliente", c.firstName);
  pushField(rows, "lastName", "Cognome", "Cliente", c.lastName);
  pushField(rows, "companyName", "Ragione sociale", "Cliente", c.companyName);
  pushField(rows, "fiscalCode", "Codice fiscale", "Cliente", c.fiscalCode);
  pushField(rows, "vatNumber", "Partita IVA", "Cliente", c.vatNumber);
  pushField(rows, "phone", "Telefono", "Cliente", c.phone);
  pushField(rows, "email", "Email", "Cliente", c.email);
  pushField(rows, "pec", "PEC", "Cliente", c.pec);
  pushField(rows, "iban", "IBAN", "Cliente", c.iban);
  pushField(rows, "legalFirstName", "Nome legale", "Cliente", c.legalFirstName);
  pushField(rows, "legalLastName", "Cognome legale", "Cliente", c.legalLastName);
  pushField(rows, "street", "Via/Piazza", "Indirizzo", c.street);
  pushField(rows, "streetNumber", "Civico", "Indirizzo", c.streetNumber);
  pushField(rows, "zipCode", "CAP", "Indirizzo", c.zipCode);
  pushField(rows, "city", "Comune", "Indirizzo", c.city);
  pushField(rows, "province", "Provincia", "Indirizzo", c.province);
  pushField(rows, "region", "Regione", "Indirizzo", c.region);

  const s = extracted.supply;
  pushField(rows, "supplierName", "Fornitore", "Fornitura", s.supplierName);
  pushField(rows, "productName", "Offerta", "Fornitura", s.productName);
  pushField(rows, "service", "Servizio", "Fornitura", s.service);
  pushField(rows, "pod", "POD", "Fornitura", s.pod);
  pushField(rows, "pdr", "PDR", "Fornitura", s.pdr);
  pushField(rows, "annualKwh", "Consumo kWh", "Fornitura", s.annualKwh);
  pushField(rows, "annualSmc", "Consumo Smc", "Fornitura", s.annualSmc);
  pushField(rows, "powerKw", "Potenza kW", "Fornitura", s.powerKw);
  pushField(rows, "paymentMethod", "Pagamento", "Fornitura", s.paymentMethod);
  pushField(rows, "classification", "Classificazione", "Fornitura", s.classification);
  pushField(rows, "supplyStreet", "Via fornitura", "Fornitura", s.street);
  pushField(rows, "supplyStreetNumber", "Civico fornitura", "Fornitura", s.streetNumber);
  pushField(rows, "supplyZip", "CAP fornitura", "Fornitura", s.zipCode);
  pushField(rows, "supplyCity", "Comune fornitura", "Fornitura", s.city);
  pushField(rows, "supplyProvince", "Prov. fornitura", "Fornitura", s.province);
  pushField(rows, "supplyRegion", "Regione fornitura", "Fornitura", s.region);
  return rows;
}

function rowsToApply(
  rows: ReviewRow[],
  extracted: OcrExtracted,
): OcrApplyPayload {
  const selected = new Map(
    rows.filter((r) => r.selected && r.value.trim()).map((r) => [r.key, r.value.trim()]),
  );
  const get = (k: string) => selected.get(k);

  const payload: OcrApplyPayload = {};
  if (extracted.clientType) payload.clientType = extracted.clientType;
  else if (get("companyName") || get("vatNumber")) payload.clientType = "AZIENDA";
  else if (get("firstName") || get("lastName")) payload.clientType = "PRIVATO";

  const mapKeys: Array<keyof OcrApplyPayload> = [
    "firstName",
    "lastName",
    "companyName",
    "fiscalCode",
    "vatNumber",
    "phone",
    "email",
    "pec",
    "street",
    "streetNumber",
    "zipCode",
    "city",
    "province",
    "region",
    "legalFirstName",
    "legalLastName",
    "iban",
    "classification",
    "supplierName",
    "productName",
    "paymentMethod",
  ];
  for (const k of mapKeys) {
    const v = get(k);
    if (v) (payload as Record<string, string>)[k] = v;
  }

  const supplyStreet = get("supplyStreet");
  const supplyZip = get("supplyZip");
  if (supplyStreet || supplyZip || get("supplyCity")) {
    payload.supplySame = false;
    if (supplyStreet) payload.supplyStreet = supplyStreet;
    if (get("supplyStreetNumber")) payload.supplyStreetNumber = get("supplyStreetNumber");
    if (supplyZip) payload.supplyZip = supplyZip;
    if (get("supplyCity")) payload.supplyCity = get("supplyCity");
    if (get("supplyProvince")) payload.supplyProvince = get("supplyProvince");
    if (get("supplyRegion")) payload.supplyRegion = get("supplyRegion");
  } else {
    payload.supplySame = true;
  }

  const pod = get("pod");
  const pdr = get("pdr");
  const serviceHint = (get("service") || "").toUpperCase();
  const services: OcrApplyPayload["services"] = [];
  if (pod && pdr) {
    services.push({
      service: "LUCE",
      pod,
      annualKwh: get("annualKwh"),
      powerKw: get("powerKw"),
    });
    services.push({
      service: "GAS",
      pdr,
      annualSmc: get("annualSmc"),
    });
  } else if (pod || serviceHint.includes("LUCE")) {
    services.push({
      service: "LUCE",
      pod: pod || undefined,
      annualKwh: get("annualKwh"),
      powerKw: get("powerKw"),
    });
  } else if (pdr || serviceHint.includes("GAS")) {
    services.push({
      service: "GAS",
      pdr: pdr || undefined,
      annualSmc: get("annualSmc"),
    });
  }
  if (services.length) payload.services = services;

  return payload;
}

export function DocumentAutoFillPanel({
  onApply,
  onAttachFiles,
  canUseMistralOcr = false,
}: {
  onApply: (payload: OcrApplyPayload) => void;
  /** Aggiunge i file agli allegati del contratto (CI / bolletta) */
  onAttachFiles: (
    files: Array<{ file: File; docType: string }>,
  ) => void;
  /** Può attivare Mistral OCR sui PDF (a pagamento) */
  canUseMistralOcr?: boolean;
}) {
  const [identityFiles, setIdentityFiles] = useState<LocalFile[]>([]);
  const [billFiles, setBillFiles] = useState<LocalFile[]>([]);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<OcrExtracted | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [useMistralOcr, setUseMistralOcr] = useState(false);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canAnalyze = identityFiles.length + billFiles.length > 0;

  const allFilesMeta = useMemo(
    () =>
      [...identityFiles, ...billFiles].map((f) => ({
        name: f.file.name,
        type: f.file.type,
      })),
    [identityFiles, billFiles],
  );
  const fileHint = useMemo(() => ocrFileKindHint(allFilesMeta), [allFilesMeta]);

  function addFiles(list: FileList | null, role: "identity" | "bill") {
    if (!list) return;
    const next: LocalFile[] = [];
    for (const file of Array.from(list)) {
      const ok =
        /pdf|jpeg|jpg|png|webp/i.test(file.type) ||
        /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
      if (!ok) {
        setError(humanizeOcrError(`Formato non supportato: ${file.name}`));
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(humanizeOcrError(`File troppo grande (max 10 MB): ${file.name}`));
        continue;
      }
      next.push({
        id: Math.random().toString(36).slice(2),
        file,
        role,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      });
    }
    setError(null);
    if (role === "identity") setIdentityFiles((p) => [...p, ...next].slice(0, 4));
    else setBillFiles((p) => [...p, ...next].slice(0, 4));
  }

  function removeFile(id: string, role: "identity" | "bill") {
    if (role === "identity") setIdentityFiles((p) => p.filter((f) => f.id !== id));
    else setBillFiles((p) => p.filter((f) => f.id !== id));
  }

  function analyze() {
    start(async () => {
      setError(null);
      setExtracted(null);
      setLastProvider(null);
      setPhase("Caricamento documenti…");
      try {
        const fd = new FormData();
        for (const f of identityFiles) {
          fd.append("files", f.file);
          fd.append("roles", "identity");
        }
        for (const f of billFiles) {
          fd.append("files", f.file);
          fd.append("roles", "bill");
        }
        if (canUseMistralOcr && useMistralOcr) {
          fd.append("useMistralOcr", "true");
        }
        setPhase(
          canUseMistralOcr && useMistralOcr
            ? "Lettura PDF con Mistral…"
            : fileHint.onlyPdf
              ? "Lettura PDF (meglio foto JPG)…"
              : "Lettura documenti…",
        );
        const res = await fetch("/api/ocr/analyze", { method: "POST", body: fd });
        setPhase("Riconoscimento dati…");
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          extracted?: OcrExtracted;
          provider?: string;
        };
        if (!res.ok || !data.ok || !data.extracted) {
          throw new Error(data.error || "Analisi non riuscita");
        }
        setPhase("Preparazione anteprima…");
        setExtracted(data.extracted);
        setRows(toRows(data.extracted));
        setLastProvider(data.provider ?? null);
        setPhase(null);
      } catch (e) {
        setPhase(null);
        const raw = e instanceof Error ? e.message : "Errore analisi";
        setError(humanizeOcrError(raw));
      }
    });
  }

  const groups = useMemo(() => {
    const map = new Map<string, ReviewRow[]>();
    for (const r of rows) {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    }
    return [...map.entries()];
  }, [rows]);

  const providerLabel: Record<string, string> = {
    groq: "foto (Groq)",
    gemini: "Gemini",
    openrouter: "OpenRouter",
    openai: "OpenAI",
    ocrspace: "OCR.space + testo",
  };

  return (
    <section className="space-y-4 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Compila automaticamente dai documenti
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <strong>Consigliato:</strong> foto <strong>JPG/PNG</strong> nitide di CI e bolletta
            (gratis e più affidabile).
          </li>
          <li>
            PDF solo se necessario; se fallisce, rifai con foto delle pagine.
          </li>
          <li>Controlla i dati riconosciuti, poi applica al modulo.</li>
        </ol>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          title="Documento cliente"
          hint="CI / patente / tessera — preferisci JPG/PNG (anche PDF)"
          files={identityFiles}
          onAdd={(fl) => addFiles(fl, "identity")}
          onRemove={(id) => removeFile(id, "identity")}
        />
        <DropZone
          title="Fattura o bolletta"
          hint="Bolletta luce/gas — preferisci JPG/PNG (anche PDF)"
          files={billFiles}
          onAdd={(fl) => addFiles(fl, "bill")}
          onRemove={(id) => removeFile(id, "bill")}
        />
      </div>

      {fileHint.tip ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {fileHint.tip}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!canAnalyze || pending}
          onClick={analyze}
        >
          {pending ? phase || "Analisi…" : "Analizza documenti"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canAnalyze}
          onClick={() => {
            setExtracted(null);
            setRows([]);
            setError(null);
            setPhase(null);
            setLastProvider(null);
          }}
        >
          Continua manualmente
        </Button>
        {canUseMistralOcr && fileHint.onlyPdf ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={useMistralOcr}
              onChange={(e) => setUseMistralOcr(e.target.checked)}
            />
            <span>
              PDF difficili: attiva <strong>Mistral OCR</strong> (a pagamento)
            </span>
          </label>
        ) : canUseMistralOcr ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={useMistralOcr}
              onChange={(e) => setUseMistralOcr(e.target.checked)}
            />
            Mistral OCR (a pagamento)
          </label>
        ) : null}
      </div>

      {phase ? <p className="text-sm text-emerald-800">{phase}</p> : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">Non sono riuscito a leggere i documenti</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}

      {extracted ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Dati riconosciuti — conferma</h3>
            {lastProvider ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                Motore: {providerLabel[lastProvider] ?? lastProvider}
              </span>
            ) : null}
          </div>
          {extracted.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
              {extracted.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {extracted.conflicts.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-800">
              {extracted.conflicts.map((c) => (
                <li key={c.field + c.message}>
                  I documenti contengono valori differenti su <strong>{c.field}</strong>:{" "}
                  {c.values.join(" / ")} — {c.message}
                </li>
              ))}
            </ul>
          ) : null}

          {groups.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nessun campo riconosciuto. Riprova con foto più nitide oppure compila a mano.
            </p>
          ) : (
            groups.map(([group, list]) => (
              <div key={group} className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-800">{group}</h4>
                <div className="space-y-2">
                  {list.map((row) => (
                    <div
                      key={row.key}
                      className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 md:grid-cols-[auto_1fr_1fr_auto]"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.key === row.key
                                  ? { ...r, selected: e.target.checked }
                                  : r,
                              ),
                            )
                          }
                        />
                        Usa
                      </label>
                      <div>
                        <p className="text-xs text-slate-500">{row.label}</p>
                        <Input
                          value={row.value}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.key === row.key
                                  ? { ...r, value: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="text-xs text-slate-500">
                        Fonte: {row.source}
                        <p className={confClass(row.confidence)}>
                          {confLabel(row.confidence)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                if (!extracted) return;
                const payload = rowsToApply(rows, extracted);
                onApply(payload);
                onAttachFiles([
                  ...identityFiles.map((f, i) => ({
                    file: f.file,
                    docType: i === 0 ? "CI_FRONTE" : "CI_RETRO",
                  })),
                  ...billFiles.map((f) => ({
                    file: f.file,
                    docType: "BOLLETTA" as const,
                  })),
                ]);
              }}
            >
              Applica dati selezionati
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={analyze}>
              Ripeti analisi
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setExtracted(null);
                setRows([]);
                setLastProvider(null);
              }}
            >
              Annulla anteprima
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DropZone({
  title,
  hint,
  files,
  onAdd,
  onRemove,
}: {
  title: string;
  hint: string;
  files: LocalFile[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <AttachmentDropZone title={title} hint={hint} onAdd={onAdd}>
      <ul className="mt-3 space-y-2">
        {files.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-white px-2 py-1 text-xs"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{f.file.name}</p>
              <p className="text-slate-500">
                {(f.file.size / 1024).toFixed(0)} KB · {f.file.type || "file"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.previewUrl}
                  alt=""
                  className="h-10 w-10 rounded object-cover"
                />
              ) : null}
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => onRemove(f.id)}
              >
                Elimina
              </button>
            </div>
          </li>
        ))}
      </ul>
    </AttachmentDropZone>
  );
}
