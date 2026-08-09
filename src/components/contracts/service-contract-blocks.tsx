"use client";

import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import {
  OPERATION_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SERVICE_OPTIONS,
} from "@/lib/constants";
import type { ContractServiceLine } from "@/lib/contract-form-types";

export type ListinoRuleOption = {
  id: string;
  supplierId: string;
  name: string;
  clientSegment: string;
  gettoneTotale: string;
  /** Se > 0 suggerisce pagamento RID */
  hasRid?: boolean;
  paymentType?: string;
  gettoneMensile?: number;
  installments?: number | null;
  stornoMonths?: number | null;
};

type SupplierOption = { id: string; name: string };

/**
 * Tre quadrati: Operazione (+ servizio + pagamento) → Fornitura → Fornitore (+ condizioni).
 * Usato in Nuovo contratto (ripetibile) e allineato alla scheda cliente.
 */
export function ServiceContractBlocks({
  line,
  index,
  canRemove,
  onChange,
  onRemove,
  suppliers,
  listinoRules,
  clientType,
  clientIban,
  residence,
  highlightRequired = false,
  highlightBase = false,
}: {
  line: ContractServiceLine;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<ContractServiceLine>) => void;
  onRemove?: () => void;
  suppliers: SupplierOption[];
  listinoRules: ListinoRuleOption[];
  clientType: "PRIVATO" | "AZIENDA";
  clientIban: string;
  residence: {
    street: string;
    streetNumber: string;
    zipCode: string;
    city: string;
    province: string;
    region: string;
  };
  /** Evidenza completa campi obbligatori (invio back office). */
  highlightRequired?: boolean;
  /**
   * Evidenza campi minimi anche senza Master:
   * operazione, pagamento, POD/PDR, fornitore.
   */
  highlightBase?: boolean;
}) {
  const supplySame = line.supplySameAsResidence !== false;
  const isEnergy =
    line.service === "LUCE" || line.service === "GAS" || line.service === "DUAL";
  const needsIban = line.paymentMethod === "RID";
  const creatingSupplier = line.supplierName !== undefined && !line.supplierId;
  const rulesForSupplier = listinoRules.filter(
    (r) => r.supplierId === line.supplierId,
  );
  /** Tutti i campi Master. */
  const fs = (filled: boolean): "off" | "empty" | "filled" =>
    highlightRequired ? (filled ? "filled" : "empty") : "off";
  /** Campi base (sempre se highlightBase o Master). */
  const fsBase = (filled: boolean): "off" | "empty" | "filled" =>
    highlightRequired || highlightBase ? (filled ? "filled" : "empty") : "off";
  const hasSupplier = Boolean(line.supplierId || line.supplierName?.trim());
  const hasPayment = Boolean(line.paymentMethod);
  const hasPod =
    line.service === "GAS"
      ? true
      : line.service === "LUCE" || line.service === "DUAL"
        ? Boolean(line.pod?.trim())
        : Boolean((line.migrationCode || line.techNotes || "").trim());
  const hasPdr =
    line.service === "LUCE"
      ? true
      : line.service === "GAS" || line.service === "DUAL"
        ? Boolean(line.pdr?.trim())
        : true;

  function applyListino(ruleId: string) {
    if (!ruleId) {
      onChange({ commissionRuleId: "" });
      return;
    }
    const rule = listinoRules.find((r) => r.id === ruleId);
    if (!rule) {
      onChange({ commissionRuleId: ruleId });
      return;
    }
    onChange({
      commissionRuleId: ruleId,
      productName: rule.name,
      offerCode: rule.name,
      // Se la regola ha pezzo RID, propone addebito; altrimenti bollettino
      paymentMethod: rule.hasRid ? "RID" : line.paymentMethod || "BOLLETTINO",
      priceType: line.priceType || "FISSO",
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Servizio contratto #{index + 1}
        </h2>
        {canRemove && onRemove ? (
          <button
            type="button"
            className="text-sm font-medium text-red-600 underline"
            onClick={onRemove}
          >
            Rimuovi servizio
          </button>
        ) : null}
      </div>

      {/* 1 — Operazione */}
      <div className="space-y-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-xs font-bold text-white">
            1
          </span>
          <h3 className="font-semibold text-slate-900">Operazione</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo operazione" fillStatus={fsBase(Boolean(line.operationType))}>
            <Select
              value={line.operationType ?? "SWITCH"}
              onChange={(e) => onChange({ operationType: e.target.value })}
            >
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Servizio contratto" fillStatus={fs(Boolean(line.service))}>
            <Select
              value={line.service}
              onChange={(e) => onChange({ service: e.target.value })}
            >
              {SERVICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {line.operationType === "ALTRO" ? (
          <Field
            label="Specifica operazione"
            fillStatus={fsBase(Boolean(line.operationOther?.trim()))}
          >
            <Input
              value={line.operationOther ?? ""}
              onChange={(e) => onChange({ operationOther: e.target.value })}
            />
          </Field>
        ) : null}
        {line.service === "ALTRO" ? (
          <Field
            label="Specifica servizio"
            fillStatus={fs(Boolean(line.serviceOther?.trim()))}
          >
            <Input
              value={line.serviceOther ?? ""}
              onChange={(e) => onChange({ serviceOther: e.target.value })}
            />
          </Field>
        ) : null}

        <Field label="Metodo di pagamento" fillStatus={fsBase(hasPayment)}>
          <Select
            value={line.paymentMethod ?? ""}
            onChange={(e) => onChange({ paymentMethod: e.target.value })}
          >
            <option value="">Seleziona</option>
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {needsIban ? (
          <div className="space-y-2 rounded-lg border border-sky-100 bg-white p-3">
            <Field
              label="IBAN (da anagrafica)"
              fillStatus={fs(Boolean(clientIban.trim()))}
            >
              <Input
                value={clientIban}
                readOnly
                className="bg-slate-50 font-mono"
                placeholder="Inserisci IBAN nell’anagrafica cliente sopra"
              />
            </Field>
            <Field label="Intestatario IBAN (se diverso)">
              <Input
                value={line.ibanHolder ?? ""}
                onChange={(e) => onChange({ ibanHolder: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </div>

      {/* 2 — Fornitura */}
      <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white">
            2
          </span>
          <h3 className="font-semibold text-slate-900">Fornitura</h3>
        </div>

        <p className="text-sm font-medium text-slate-800">Indirizzo di fornitura</p>
        <label className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-white p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0"
            checked={supplySame}
            onChange={(e) => {
              const checked = e.target.checked;
              onChange({
                supplySameAsResidence: checked,
                ...(checked
                  ? {
                      supplyStreet: residence.street,
                      supplyStreetNumber: residence.streetNumber,
                      supplyZipCode: residence.zipCode,
                      supplyCity: residence.city,
                      supplyProvince: residence.province,
                      supplyRegion: residence.region,
                    }
                  : {}),
              });
            }}
          />
          <span>
            Coincide con anagrafica (residenza / sede legale)
          </span>
        </label>
        {!supplySame ? (
          <CapAddressFields
            zipCode={line.supplyZipCode ?? ""}
            city={line.supplyCity ?? ""}
            province={line.supplyProvince ?? ""}
            region={line.supplyRegion ?? ""}
            street={line.supplyStreet ?? ""}
            streetNumber={line.supplyStreetNumber ?? ""}
            onZipChange={(v) => onChange({ supplyZipCode: v })}
            onCityChange={(v) => onChange({ supplyCity: v })}
            onProvinceChange={(v) => onChange({ supplyProvince: v })}
            onRegionChange={(v) => onChange({ supplyRegion: v })}
            onStreetChange={(v) => onChange({ supplyStreet: v })}
            onStreetNumberChange={(v) => onChange({ supplyStreetNumber: v })}
            zipLabel="CAP fornitura"
            highlightRequired={highlightRequired}
          />
        ) : (
          <p className="text-xs text-slate-500">
            Verrà usata la residenza / sede legale del cliente.
          </p>
        )}

        {(line.service === "LUCE" || line.service === "DUAL") && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="POD" fillStatus={fsBase(hasPod && Boolean(line.pod?.trim()))}>
              <Input
                value={line.pod ?? ""}
                onChange={(e) => onChange({ pod: e.target.value })}
                className="font-mono uppercase"
              />
            </Field>
            <Field label="Potenza contatore (kW)">
              <Input
                inputMode="decimal"
                value={line.powerKw ?? ""}
                onChange={(e) => onChange({ powerKw: e.target.value })}
              />
            </Field>
            <Field label="kWh annui">
              <Input
                inputMode="decimal"
                value={line.annualKwh ?? ""}
                onChange={(e) => onChange({ annualKwh: e.target.value })}
              />
            </Field>
          </div>
        )}
        {(line.service === "GAS" || line.service === "DUAL") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PDR" fillStatus={fsBase(hasPdr && Boolean(line.pdr?.trim()))}>
              <Input
                value={line.pdr ?? ""}
                onChange={(e) => onChange({ pdr: e.target.value })}
                className="font-mono uppercase"
              />
            </Field>
            <Field label="Smc / mc annui">
              <Input
                inputMode="decimal"
                value={line.annualSmc ?? ""}
                onChange={(e) => onChange({ annualSmc: e.target.value })}
              />
            </Field>
          </div>
        )}
        {!isEnergy ? (
          <Field
            label="POD / PDR / Codice migrazione"
            fillStatus={fsBase(Boolean((line.migrationCode || line.techNotes || "").trim()))}
          >
            <Input
              value={line.migrationCode ?? line.techNotes ?? ""}
              onChange={(e) =>
                onChange({ migrationCode: e.target.value, techNotes: e.target.value })
              }
              className="font-mono"
            />
          </Field>
        ) : null}
      </div>

      {/* 3 — Fornitore + condizioni */}
      <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-xs font-bold text-white">
            3
          </span>
          <h3 className="font-semibold text-slate-900">Fornitore e condizioni</h3>
        </div>

        <Field label="Fornitore" fillStatus={fsBase(hasSupplier)}>
          <Select
            value={creatingSupplier ? "__NEW__" : line.supplierId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__NEW__") {
                onChange({
                  supplierId: undefined,
                  supplierName: "",
                  commissionRuleId: "",
                });
                return;
              }
              onChange({
                supplierId: v || undefined,
                supplierName: undefined,
                commissionRuleId: "",
                productName: "",
                offerCode: "",
              });
            }}
          >
            <option value="">Seleziona fornitore</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__NEW__">Altro… (registra nuovo)</option>
          </Select>
        </Field>
        {creatingSupplier ? (
          <Field
            label="Nome nuovo fornitore"
            fillStatus={fsBase(Boolean(line.supplierName?.trim()))}
          >
            <Input
              value={line.supplierName ?? ""}
              onChange={(e) =>
                onChange({ supplierName: e.target.value, supplierId: undefined })
              }
              placeholder="Scrivi il nome del fornitore"
            />
          </Field>
        ) : null}

        {line.supplierId && rulesForSupplier.length > 0 ? (
          <Field label="Offerta da listino">
            <Select
              value={line.commissionRuleId ?? ""}
              onChange={(e) => applyListino(e.target.value)}
            >
              <option value="">— scegli oppure nome a mano —</option>
              {rulesForSupplier.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.clientSegment && r.clientSegment !== "TUTTI"
                    ? ` · ${r.clientSegment}`
                    : ""}
                  {r.gettoneTotale ? ` · ${r.gettoneTotale} €` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-xs text-slate-500">
            Nessuna regola listino: inserisci il nome offerta a mano.
          </p>
        )}

        <Field label="Nome offerta">
          <Input
            value={line.productName ?? ""}
            onChange={(e) => {
              const name = e.target.value;
              const match = rulesForSupplier.find(
                (r) => r.name.toLowerCase() === name.trim().toLowerCase(),
              );
              if (match) {
                applyListino(match.id);
                onChange({ productName: name });
              } else {
                onChange({ productName: name });
              }
            }}
            placeholder="Es. Casa Flex"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo contratto">
            <Select
              value={
                line.contractKind ??
                (clientType === "PRIVATO" ? "Domestico" : "Non domestico")
              }
              onChange={(e) => onChange({ contractKind: e.target.value })}
            >
              {clientType === "PRIVATO" ? (
                <>
                  <option value="Domestico">Domestico</option>
                  <option value="Altri usi">Altri usi</option>
                </>
              ) : (
                <>
                  <option value="Non domestico">Non domestico</option>
                  <option value="Altri usi">Altri usi</option>
                </>
              )}
            </Select>
          </Field>
          <Field label="Prezzo fisso o variabile">
            <Select
              value={line.priceType ?? "FISSO"}
              onChange={(e) => onChange({ priceType: e.target.value })}
            >
              <option value="FISSO">Fisso</option>
              <option value="VARIABILE">Variabile</option>
              <option value="INDICIZZATO">Indicizzato</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(line.service === "LUCE" || line.service === "DUAL") && (
            <Field label="Prezzo al kWh (€)">
              <Input
                inputMode="decimal"
                value={line.pricePerKwh ?? ""}
                onChange={(e) => onChange({ pricePerKwh: e.target.value })}
              />
            </Field>
          )}
          {(line.service === "GAS" || line.service === "DUAL") && (
            <Field label="Prezzo al mc / Smc (€)">
              <Input
                inputMode="decimal"
                value={line.pricePerSmc ?? ""}
                onChange={(e) => onChange({ pricePerSmc: e.target.value })}
              />
            </Field>
          )}
          <Field label="PCV mese (€)">
            <Input
              inputMode="decimal"
              value={line.pcv ?? ""}
              onChange={(e) => onChange({ pcv: e.target.value })}
            />
          </Field>
          <Field label="Quota fissa mensile (€)">
            <Input
              inputMode="decimal"
              value={line.monthlyFee ?? ""}
              onChange={(e) => onChange({ monthlyFee: e.target.value })}
            />
          </Field>
          {(line.priceType === "VARIABILE" || line.priceType === "INDICIZZATO") && (
            <Field label="Spread">
              <Input
                inputMode="decimal"
                value={line.spread ?? ""}
                onChange={(e) => onChange({ spread: e.target.value })}
              />
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

export function AddServiceButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClick}>
      + Aggiungi servizio
    </Button>
  );
}
