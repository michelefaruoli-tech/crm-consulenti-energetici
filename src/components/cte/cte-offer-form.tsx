"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import {
  CtePdfParseReview,
  CtePdfUploadPanel,
  parseCtePdfClient,
  type CtePdfParsePayload,
} from "@/components/cte/cte-pdf-upload-panel";
import {
  createCteOfferAction,
  deactivateCteOfferAction,
  updateCteOfferAction,
} from "@/lib/cte-actions";
import { CTE_PDF_MAX_BYTES } from "@/lib/cte-form-schema";
import {
  ctePdfFileKey,
  nextUnfinishedIndex,
  queueHasUnfinished,
  queueProgressLabel,
  selectCtePdfFiles,
  type CteListinoPrefill,
  type CtePdfQueueItem,
} from "@/lib/cte-pdf-queue";
import type { CteOfferInput } from "@/lib/cte-types";

type SupplierOption = { id: string; name: string };

type BandDraft = { timeBand: string; energyPrice: string };

type FormDraft = {
  supplierId: string;
  offerName: string;
  utility: "LUCE" | "GAS";
  category: string;
  commercialSegment: string;
  priceKind: "FISSO" | "VARIABILE";
  powerKwMin: string;
  powerKwMax: string;
  annualConsumptionMin: string;
  annualConsumptionMax: string;
  referenceConsumption: string;
  networkLosses: string;
  ccvAnnual: string;
  ccvMonthly: string;
  spread: string;
  validFrom: string;
  validTo: string;
  notes: string;
  bands: BandDraft[];
};

function dec(v: number | null): string {
  return v == null ? "" : String(v);
}

function dateInput(v: Date | null): string {
  if (!v) return "";
  return v.toISOString().slice(0, 10);
}

function initialToDraft(
  initial: CteOfferInput | undefined,
  fallbackSupplier: string,
): FormDraft {
  return {
    supplierId: initial?.supplierId ?? fallbackSupplier,
    offerName: initial?.offerName ?? "",
    utility: initial?.utility ?? "LUCE",
    category: initial?.category ?? "RESIDENZIALE",
    commercialSegment: initial?.commercialSegment ?? "",
    priceKind: initial?.priceKind ?? "FISSO",
    powerKwMin: dec(initial?.powerKwMin ?? null),
    powerKwMax: dec(initial?.powerKwMax ?? null),
    annualConsumptionMin: dec(initial?.annualConsumptionMin ?? null),
    annualConsumptionMax: dec(initial?.annualConsumptionMax ?? null),
    referenceConsumption: dec(initial?.referenceConsumption ?? null),
    networkLosses: initial?.networkLosses ?? "INCLUDED",
    ccvAnnual: dec(initial?.ccvAnnual ?? null),
    ccvMonthly: dec(initial?.ccvMonthly ?? null),
    spread: dec(initial?.spread ?? null),
    validFrom: dateInput(initial?.validFrom ?? null),
    validTo: dateInput(initial?.validTo ?? null),
    notes: initial?.notes ?? "",
    bands:
      initial?.priceBands?.length
        ? initial.priceBands.map((b) => ({
            timeBand: b.timeBand,
            energyPrice: String(b.energyPrice),
          }))
        : [{ timeBand: "MONO", energyPrice: "" }],
  };
}

function emptyDraft(): FormDraft {
  return initialToDraft(undefined, "");
}

function payloadToDraft(payload: CtePdfParsePayload): FormDraft {
  const e = payload.extracted;
  return {
    supplierId: payload.supplierId ?? "",
    offerName: e.offerName ?? "",
    utility: e.utility ?? "LUCE",
    category: e.category ?? "RESIDENZIALE",
    commercialSegment: e.commercialSegment ?? "",
    priceKind: e.priceKind ?? "FISSO",
    powerKwMin: dec(e.powerKwMin),
    powerKwMax: dec(e.powerKwMax),
    annualConsumptionMin: dec(e.annualConsumptionMin),
    annualConsumptionMax: dec(e.annualConsumptionMax),
    referenceConsumption: "",
    networkLosses: e.networkLosses ?? (e.utility === "GAS" ? "NOT_APPLICABLE" : "INCLUDED"),
    ccvAnnual: dec(e.ccvAnnual),
    ccvMonthly: dec(e.ccvMonthly),
    spread: dec(e.spread),
    validFrom: e.validFrom ?? "",
    validTo: e.validTo ?? "",
    notes: e.suggestedNotes ?? "",
    bands: e.bands.length
      ? e.bands.map((b) => ({ timeBand: b.timeBand, energyPrice: String(b.energyPrice) }))
      : [{ timeBand: "MONO", energyPrice: "" }],
  };
}

export function CteOfferForm({
  suppliers,
  initial,
  mode,
}: {
  suppliers: SupplierOption[];
  initial?: CteOfferInput & {
    pdfFilename?: string | null;
  };
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [draft, setDraft] = useState<FormDraft>(() => initialToDraft(initial, ""));
  const [priceKind, setPriceKind] = useState(draft.priceKind);
  const [utility, setUtility] = useState(draft.utility);
  const [bands, setBands] = useState<BandDraft[]>(draft.bands);
  const [removePdf, setRemovePdf] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parsePayload, setParsePayload] = useState<CtePdfParsePayload | null>(null);
  const [queue, setQueue] = useState<CtePdfQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [parsePending, setParsePending] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectErrors, setSelectErrors] = useState<string[]>([]);
  const parseGen = useRef(0);
  const fromPdf = parsePayload != null;
  const isMultiQueue = queue.length > 1;
  const queueStatuses = queue.map((item) => item.status);
  const queueUnfinished = queueHasUnfinished(queueStatuses);
  const remainingAfterCurrent = nextUnfinishedIndex(queueStatuses, currentIndex);

  function applyDraft(next: FormDraft) {
    setDraft(next);
    setUtility(next.utility);
    setPriceKind(next.priceKind);
    setBands(next.bands);
    setFieldsKey((k) => k + 1);
  }

  function patchQueue(index: number, patch: Partial<CtePdfQueueItem>) {
    setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function resetCurrentForm() {
    setParsePayload(null);
    setParseError(null);
    applyDraft(emptyDraft());
  }

  async function parseQueueItem(index: number, file: File, prefill?: CteListinoPrefill) {
    const gen = ++parseGen.current;
    setPdfFile(file);
    setCurrentIndex(index);
    setParsePayload(null);
    setParseError(null);
    setError(null);
    patchQueue(index, { status: "reading", error: undefined });
    if (prefill) {
      if (gen !== parseGen.current) return;
      setParsePending(false);
      patchQueue(index, { status: "review", error: undefined });
      const payload: CtePdfParsePayload = { ...prefill, file, totalPages: 1 };
      setParsePayload(payload);
      applyDraft(payloadToDraft(payload));
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setParsePending(true);
    const result = await parseCtePdfClient(file);
    if (gen !== parseGen.current) return;
    setParsePending(false);
    if (!result.ok) {
      setParseError(result.error);
      patchQueue(index, { status: "error", error: result.error });
      applyDraft(emptyDraft());
      return;
    }
    const payload = result.kind === "listino" ? result.payloads[0] : result.payload;
    if (!payload) {
      setParseError("Nessun dato letto dal file.");
      patchQueue(index, { status: "error", error: "Nessun dato letto dal file." });
      applyDraft(emptyDraft());
      return;
    }
    patchQueue(index, { status: "review", error: undefined });
    setParsePayload(payload);
    applyDraft(payloadToDraft(payload));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSelectFiles(files: File[]) {
    const statuses = queue.map((item) => item.status);
    const replace = queue.length === 0 || !queueHasUnfinished(statuses);
    const existing = replace ? [] : queue;
    const selected = selectCtePdfFiles(files, {
      alreadyCount: existing.length,
      existingKeys: existing.map((item) => ctePdfFileKey(item.file)),
    });
    setSelectErrors(selected.errors);
    if (selected.files.length === 0) return;
    setParsePending(true);
    const added: CtePdfQueueItem[] = [];
    for (const file of selected.files) {
      const isImage =
        /^image\//i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
      if (!isImage) {
        added.push({ file, status: "pending" });
        continue;
      }
      const result = await parseCtePdfClient(file);
      if (!result.ok) {
        added.push({ file, status: "error", error: result.error });
        continue;
      }
      const payloads = result.kind === "listino" ? result.payloads : [result.payload];
      for (const payload of payloads) {
        added.push({
          file,
          status: "pending",
          listinoPrefill: {
            filename: payload.filename,
            supplierId: payload.supplierId,
            supplierMatchName: payload.supplierMatchName,
            extracted: payload.extracted,
            textPreview: payload.textPreview,
          },
        });
      }
    }
    setParsePending(false);
    if (added.length === 0) return;
    const nextQueue = replace ? added : [...existing, ...added];
    setQueue(nextQueue);
    const startIndex = replace ? 0 : existing.length;
    const startItem = nextQueue[startIndex];
    if (replace) resetCurrentForm();
    if (startItem) void parseQueueItem(startIndex, startItem.file, startItem.listinoPrefill);
  }

  function handleRetryParse() {
    const item = queue[currentIndex];
    if (!item) return;
    void parseQueueItem(currentIndex, item.file, item.listinoPrefill);
  }

  function handleSkipCurrent() {
    parseGen.current += 1;
    setParsePending(false);
    patchQueue(currentIndex, { status: "skipped", error: undefined });
    const statuses = queue.map((item, i) => (i === currentIndex ? "skipped" : item.status));
    const next = nextUnfinishedIndex(statuses, currentIndex);
    if (next == null) {
      setPdfFile(null);
      resetCurrentForm();
      return;
    }
    const nextItem = queue[next];
    if (nextItem) void parseQueueItem(next, nextItem.file, nextItem.listinoPrefill);
  }

  function addBand() {
    setBands((prev) => [...prev, { timeBand: "F1", energyPrice: "" }]);
  }

  function removeBand(index: number) {
    setBands((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.delete("bandTime");
    fd.delete("bandPrice");
    for (const band of bands) {
      if (!band.energyPrice.trim()) continue;
      fd.append("bandTime", band.timeBand);
      fd.append("bandPrice", band.energyPrice);
    }
    if (removePdf) fd.set("removePdf", "1");
    if (pdfFile) fd.set("pdfFile", pdfFile);
    fd.set("extractionOrigin", fromPdf ? "pdf" : "manual");

    try {
      const action = mode === "create" ? createCteOfferAction : updateCteOfferAction;
      if (mode === "create" && queue[currentIndex]) {
        patchQueue(currentIndex, { status: "saving" });
      }
      const res = await action(fd);
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        if (mode === "create" && queue[currentIndex]) {
          patchQueue(currentIndex, { status: parsePayload ? "review" : "error" });
        }
        return;
      }
      const savedName = String(fd.get("offerName") ?? "").trim();
      if (mode === "create" && isMultiQueue) {
        patchQueue(currentIndex, {
          status: "saved",
          savedId: res.id,
          savedOfferName: savedName || queue[currentIndex]?.file.name,
        });
        const statuses = queue.map((item, i) => (i === currentIndex ? "saved" : item.status));
        const next = nextUnfinishedIndex(statuses, currentIndex);
        setPending(false);
        if (next == null) {
          setPdfFile(null);
          resetCurrentForm();
          router.refresh();
          return;
        }
        const nextItem = queue[next];
        resetCurrentForm();
        if (nextItem) void parseQueueItem(next, nextItem.file, nextItem.listinoPrefill);
        return;
      }
      router.push(`/catalogo-cte/${res.id}?saved=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di salvataggio");
      setPending(false);
      if (mode === "create" && queue[currentIndex]) {
        patchQueue(currentIndex, { status: parsePayload ? "review" : "error" });
      }
    }
  }

  async function handleDeactivate() {
    if (!initial?.id) return;
    if (!window.confirm("Disattivare questa offerta CTE? Resta in archivio ma non compare nel catalogo.")) {
      return;
    }
    setPending(true);
    const fd = new FormData();
    fd.set("id", initial.id);
    const res = await deactivateCteOfferAction(fd);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/catalogo-cte");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {mode === "edit" && initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="extractionOrigin" value={fromPdf ? "pdf" : "manual"} />

      {mode === "create" ? (
        <>
          <CtePdfUploadPanel
            queue={queue}
            currentIndex={currentIndex}
            parsePending={parsePending}
            parseError={parseError}
            onSelectFiles={handleSelectFiles}
            onRetry={handleRetryParse}
            onSkip={handleSkipCurrent}
          />
          {selectErrors.length ? (
            <PersistentAlert title="Selezione PDF" messages={selectErrors} tone="error" />
          ) : null}
          {parsePayload ? <CtePdfParseReview payload={parsePayload} /> : null}
          {queue.some((item) => item.status === "saved") ? (
            <section className="rounded-xl border border-emerald-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Offerte create in questa sessione</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-800">
                {queue
                  .filter((item) => item.status === "saved" && item.savedId)
                  .map((item) => (
                    <li key={item.savedId}>
                      <a
                        href={`/catalogo-cte/${item.savedId}`}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {item.savedOfferName || item.file.name}
                      </a>
                      <span className="text-slate-500"> · {item.file.name}</span>
                    </li>
                  ))}
              </ul>
              {!queueUnfinished && queue.length > 0 ? (
                <p className="mt-3 text-sm text-slate-600">
                  Coda completata. Puoi caricare altri PDF oppure tornare al catalogo.
                </p>
              ) : null}
            </section>
          ) : null}
          <p className="text-sm text-slate-500">
            Ogni PDF resta allegato alla propria offerta al salvataggio. Se il file non è
            disponibile puoi compilare a mano.
          </p>
        </>
      ) : null}

      <div key={fieldsKey} className="space-y-6">
        <h2 className="font-semibold text-slate-900">
          {mode === "create"
            ? isMultiQueue && queueUnfinished
              ? `3. Verifica e completa i campi (${queueProgressLabel(currentIndex, queue.length)})`
              : "3. Verifica e completa i campi"
            : "Dati offerta"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Fornitore *" fillStatus={fromPdf ? (draft.supplierId ? "filled" : "empty") : "off"}>
            <Select name="supplierId" required defaultValue={draft.supplierId}>
              <option value="">Seleziona…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nome CTE *" fillStatus={fromPdf ? (draft.offerName ? "filled" : "empty") : "off"}>
            <Input name="offerName" required defaultValue={draft.offerName} />
          </Field>
          <Field label="Commodity *">
            <Select
              name="utility"
              value={utility}
              onChange={(e) => setUtility(e.target.value as "LUCE" | "GAS")}
            >
              <option value="LUCE">Luce</option>
              <option value="GAS">Gas</option>
            </Select>
          </Field>
          <Field label="Categoria *">
            <Select name="category" defaultValue={draft.category}>
              <option value="RESIDENZIALE">Residenziale</option>
              <option value="BUSINESS">Business</option>
              <option value="CONDOMINI">Condomini</option>
            </Select>
          </Field>
          <Field label="Tipologia prezzo *">
            <Select
              name="priceKind"
              value={priceKind}
              onChange={(e) => setPriceKind(e.target.value as "FISSO" | "VARIABILE")}
            >
              <option value="FISSO">Fisso</option>
              <option value="VARIABILE">Variabile / indicizzato</option>
            </Select>
          </Field>
          <Field
            label="Segmento commerciale"
            fillStatus={fromPdf ? (draft.commercialSegment ? "filled" : "empty") : "off"}
          >
            <Input
              name="commercialSegment"
              placeholder="Es. AC MICRO, AC SMALL"
              defaultValue={draft.commercialSegment}
            />
          </Field>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 font-semibold text-slate-900">Scaglioni potenza e consumo</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Potenza min (kW)" fillStatus={fromPdf ? (draft.powerKwMin ? "filled" : "empty") : "off"}>
              <Input name="powerKwMin" type="number" step="0.01" defaultValue={draft.powerKwMin} />
            </Field>
            <Field label="Potenza max (kW)" fillStatus={fromPdf ? (draft.powerKwMax ? "filled" : "empty") : "off"}>
              <Input name="powerKwMax" type="number" step="0.01" defaultValue={draft.powerKwMax} />
            </Field>
            <Field label={`Consumo annuo min (${utility === "GAS" ? "Smc" : "kWh"})`}>
              <Input
                name="annualConsumptionMin"
                type="number"
                step="0.01"
                defaultValue={draft.annualConsumptionMin}
              />
            </Field>
            <Field
              label={`Consumo annuo max (${utility === "GAS" ? "Smc" : "kWh"})`}
              fillStatus={fromPdf ? (draft.annualConsumptionMax ? "filled" : "empty") : "off"}
            >
              <Input
                name="annualConsumptionMax"
                type="number"
                step="0.01"
                defaultValue={draft.annualConsumptionMax}
              />
            </Field>
            <Field label={`Consumo mensile riferimento ranking (${utility === "GAS" ? "Smc" : "kWh"})`}>
              <Input
                name="referenceConsumption"
                type="number"
                step="0.01"
                defaultValue={draft.referenceConsumption}
              />
            </Field>
            <Field label="Perdite di rete *">
              <Select name="networkLosses" defaultValue={draft.networkLosses}>
                <option value="INCLUDED">Incluse nel prezzo energia</option>
                <option value="EXCLUDED">Escluse (normalizzate in ranking)</option>
                <option value="NOT_APPLICABLE">Non applicabile (gas)</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Fasce prezzo energia</h3>
            <Button type="button" variant="secondary" size="sm" onClick={addBand}>
              + Fascia
            </Button>
          </div>
          <p className="mb-3 text-sm text-slate-500">
            Monoraria: una riga MONO. Corporate: F1, F2, F3. Non confrontare offerte con perdite
            incluse vs escluse senza normalizzazione — indica il flag in tabella.
          </p>
          <div className="space-y-2">
            {bands.map((band, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[7rem]">
                  <Field label="Fascia">
                    <Select
                      value={band.timeBand}
                      onChange={(e) =>
                        setBands((prev) =>
                          prev.map((b, i) => (i === index ? { ...b, timeBand: e.target.value } : b)),
                        )
                      }
                    >
                      <option value="MONO">Monoraria</option>
                      <option value="F1">F1</option>
                      <option value="F2">F2</option>
                      <option value="F3">F3</option>
                    </Select>
                  </Field>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <Field
                    label={`Prezzo ${utility === "GAS" ? "€/Smc" : "€/kWh"}`}
                    fillStatus={fromPdf ? (band.energyPrice ? "filled" : "empty") : "off"}
                  >
                    <Input
                      type="number"
                      step="0.000001"
                      min={0}
                      value={band.energyPrice}
                      onChange={(e) =>
                        setBands((prev) =>
                          prev.map((b, i) => (i === index ? { ...b, energyPrice: e.target.value } : b)),
                        )
                      }
                    />
                  </Field>
                </div>
                {bands.length > 1 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => removeBand(index)}>
                    Rimuovi
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 font-semibold text-slate-900">Componenti economiche e validità</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="CCV annuo (€/POD o PDR)"
              fillStatus={fromPdf ? (draft.ccvAnnual ? "filled" : "empty") : "off"}
            >
              <Input name="ccvAnnual" type="number" step="0.01" defaultValue={draft.ccvAnnual} />
            </Field>
            <Field label="CCV mensile (€)">
              <Input name="ccvMonthly" type="number" step="0.01" defaultValue={draft.ccvMonthly} />
            </Field>
            {priceKind === "VARIABILE" ? (
              <Field label="Spread (€/kWh o €/Smc) *">
                <Input name="spread" type="number" step="0.000001" defaultValue={draft.spread} />
              </Field>
            ) : (
              <input type="hidden" name="spread" value="" />
            )}
            <Field
              label="Validità dal"
              fillStatus={fromPdf ? (draft.validFrom ? "filled" : "empty") : "off"}
            >
              <Input name="validFrom" type="date" defaultValue={draft.validFrom} />
            </Field>
            <Field label="Validità al" fillStatus={fromPdf ? (draft.validTo ? "filled" : "empty") : "off"}>
              <Input name="validTo" type="date" defaultValue={draft.validTo} />
            </Field>
          </div>
          <Field label="Note interne">
            <Textarea name="notes" rows={3} defaultValue={draft.notes} />
          </Field>
        </section>
      </div>

      {mode === "edit" ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-2 font-semibold text-slate-900">PDF allegato</h3>
          <p className="mb-3 text-sm text-slate-600">
            Carica o sostituisci il PDF fornitore (max {CTE_PDF_MAX_BYTES / (1024 * 1024)} MB).
          </p>
          {initial?.pdfFilename && !removePdf ? (
            <p className="mb-2 text-sm text-slate-700">
              Allegato attuale:{" "}
              <a
                href={`/api/catalogo-cte/${initial.id}/pdf`}
                className="font-medium text-emerald-700 hover:underline"
              >
                {initial.pdfFilename}
              </a>
            </p>
          ) : null}
          <Field label="Nuovo PDF">
            <Input
              name="pdfFile"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          {initial?.pdfFilename ? (
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={removePdf}
                onChange={(e) => setRemovePdf(e.target.checked)}
              />
              Rimuovi PDF esistente
            </label>
          ) : null}
        </section>
      ) : null}

      {error ? <PersistentAlert title="Errore" messages={[error]} tone="error" /> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || parsePending}>
          {pending
            ? "Salvataggio…"
            : mode === "create" && isMultiQueue && queueUnfinished && remainingAfterCurrent != null
              ? `Salva e passa al successivo (${queueProgressLabel(currentIndex, queue.length)})`
              : mode === "create" && isMultiQueue && queueUnfinished
                ? "Salva ultima offerta"
                : mode === "create"
                  ? "Crea offerta"
                  : "Salva modifiche"}
        </Button>
        {mode === "create" && isMultiQueue && !queueUnfinished ? (
          <Button type="button" onClick={() => router.push("/catalogo-cte")}>
            Vai al catalogo
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => router.push("/catalogo-cte")}>
          Annulla
        </Button>
        {mode === "edit" ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={handleDeactivate}>
            Disattiva offerta
          </Button>
        ) : null}
      </div>
    </form>
  );
}
