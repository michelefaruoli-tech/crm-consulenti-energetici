"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import {
  createCteOfferAction,
  deactivateCteOfferAction,
  updateCteOfferAction,
} from "@/lib/cte-actions";
import { CTE_PDF_MAX_BYTES } from "@/lib/cte-form-schema";
import type { CteOfferInput } from "@/lib/cte-types";

type SupplierOption = { id: string; name: string };

type BandDraft = { timeBand: string; energyPrice: string };

function dec(v: number | null): string {
  return v == null ? "" : String(v);
}

function dateInput(v: Date | null): string {
  if (!v) return "";
  return v.toISOString().slice(0, 10);
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
  const [priceKind, setPriceKind] = useState(initial?.priceKind ?? "FISSO");
  const [utility, setUtility] = useState(initial?.utility ?? "LUCE");
  const [bands, setBands] = useState<BandDraft[]>(
    initial?.priceBands?.length
      ? initial.priceBands.map((b) => ({
          timeBand: b.timeBand,
          energyPrice: String(b.energyPrice),
        }))
      : [{ timeBand: "MONO", energyPrice: "" }],
  );
  const [removePdf, setRemovePdf] = useState(false);

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

    try {
      const action = mode === "create" ? createCteOfferAction : updateCteOfferAction;
      const res = await action(fd);
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      router.push(`/catalogo-cte/${res.id}?saved=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di salvataggio");
      setPending(false);
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

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Fornitore *">
          <Select name="supplierId" required defaultValue={initial?.supplierId ?? ""}>
            <option value="">Seleziona…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome CTE *">
          <Input name="offerName" required defaultValue={initial?.offerName ?? ""} />
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
          <Select name="category" defaultValue={initial?.category ?? "RESIDENZIALE"}>
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
        <Field label="Segmento commerciale">
          <Input
            name="commercialSegment"
            placeholder="Es. AC MICRO, AC SMALL"
            defaultValue={initial?.commercialSegment ?? ""}
          />
        </Field>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 font-semibold text-slate-900">Scaglioni potenza e consumo</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Potenza min (kW)">
            <Input name="powerKwMin" type="number" step="0.01" defaultValue={dec(initial?.powerKwMin ?? null)} />
          </Field>
          <Field label="Potenza max (kW)">
            <Input name="powerKwMax" type="number" step="0.01" defaultValue={dec(initial?.powerKwMax ?? null)} />
          </Field>
          <Field label={`Consumo annuo min (${utility === "GAS" ? "Smc" : "kWh"})`}>
            <Input
              name="annualConsumptionMin"
              type="number"
              step="0.01"
              defaultValue={dec(initial?.annualConsumptionMin ?? null)}
            />
          </Field>
          <Field label={`Consumo annuo max (${utility === "GAS" ? "Smc" : "kWh"})`}>
            <Input
              name="annualConsumptionMax"
              type="number"
              step="0.01"
              defaultValue={dec(initial?.annualConsumptionMax ?? null)}
            />
          </Field>
          <Field label={`Consumo mensile riferimento ranking (${utility === "GAS" ? "Smc" : "kWh"})`}>
            <Input
              name="referenceConsumption"
              type="number"
              step="0.01"
              defaultValue={dec(initial?.referenceConsumption ?? null)}
            />
          </Field>
          <Field label="Perdite di rete *">
            <Select name="networkLosses" defaultValue={initial?.networkLosses ?? "INCLUDED"}>
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
                <Field label={`Prezzo ${utility === "GAS" ? "€/Smc" : "€/kWh"}`}>
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
          <Field label="CCV annuo (€/POD o PDR)">
            <Input name="ccvAnnual" type="number" step="0.01" defaultValue={dec(initial?.ccvAnnual ?? null)} />
          </Field>
          <Field label="CCV mensile (€)">
            <Input name="ccvMonthly" type="number" step="0.01" defaultValue={dec(initial?.ccvMonthly ?? null)} />
          </Field>
          {priceKind === "VARIABILE" ? (
            <Field label="Spread (€/kWh o €/Smc) *">
              <Input name="spread" type="number" step="0.000001" defaultValue={dec(initial?.spread ?? null)} />
            </Field>
          ) : (
            <input type="hidden" name="spread" value="" />
          )}
          <Field label="Validità dal">
            <Input name="validFrom" type="date" defaultValue={dateInput(initial?.validFrom ?? null)} />
          </Field>
          <Field label="Validità al">
            <Input name="validTo" type="date" defaultValue={dateInput(initial?.validTo ?? null)} />
          </Field>
        </div>
        <Field label="Note interne">
          <Textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} />
        </Field>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 font-semibold text-slate-900">PDF allegato (opzionale)</h3>
        <p className="mb-3 text-sm text-slate-600">
          Carica il PDF fornitore (max {CTE_PDF_MAX_BYTES / (1024 * 1024)} MB). Storage PostgreSQL
          Base64 come gli allegati contratto. Fino a upload, conserva i PDF sul tuo PC.
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
          <Input name="pdfFile" type="file" accept="application/pdf,.pdf" />
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

      {error ? (
        <PersistentAlert title="Errore" messages={[error]} tone="error" />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : mode === "create" ? "Crea offerta" : "Salva modifiche"}
        </Button>
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
