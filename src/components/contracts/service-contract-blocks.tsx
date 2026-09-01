"use client";

import { useState } from "react";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import {
  OPERATION_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  PROPERTY_HOLDER_OPTIONS,
  SERVICE_OPTIONS,
} from "@/lib/constants";
import type { ContractServiceLine } from "@/lib/contract-form-types";
import { computeSupplyStartDate, formatItDate } from "@/lib/supply-dates";

export type ListinoRuleOption = {
  id: string;
  supplierId: string;
  name: string;
  clientSegment: string;
  gettoneTotale: string;
  hasRid?: boolean;
  paymentType?: string;
  gettoneMensile?: number;
  installments?: number | null;
  stornoMonths?: number | null;
};

type SupplierOption = { id: string; name: string };

function identifierHint(service: string): string {
  if (service === "LUCE" || service === "DUAL") return "POD";
  if (service === "GAS") return "PDR";
  if (service === "TELEFONIA") return "Codice migrazione";
  if (service === "POS") return "Codice / info POS";
  if (service === "FOTOVOLTAICO") return "Codice / info impianto";
  return "Codice / info";
}

/**
 * Una sola scheda compatta per servizio: operazione, utenza, fornitore, offerta.
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
  anagraficaIban,
  contractIban,
  onContractIbanChange,
  clientEmail,
  residence,
  insertionDate,
  classification,
  classificationOptions,
  onClassificationChange,
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
  anagraficaIban: string;
  contractIban: string;
  onContractIbanChange: (value: string, fromAnagrafica?: boolean) => void;
  clientEmail: string;
  residence: {
    street: string;
    streetNumber: string;
    zipCode: string;
    city: string;
    province: string;
    region: string;
  };
  insertionDate: Date;
  /** Solo sul primo servizio: classificazione utenza (residente, business, …). */
  classification?: string;
  classificationOptions?: ReadonlyArray<{ value: string; label: string }>;
  onClassificationChange?: (value: string) => void;
  highlightRequired?: boolean;
  highlightBase?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const supplySame = line.supplySameAsResidence !== false;
  const isEnergy =
    line.service === "LUCE" || line.service === "GAS" || line.service === "DUAL";
  const needsIban = line.paymentMethod === "RID";
  const creatingSupplier = line.supplierName !== undefined && !line.supplierId;
  const rulesForSupplier = listinoRules.filter(
    (r) => r.supplierId === line.supplierId,
  );
  const fs = (filled: boolean): "off" | "empty" | "filled" =>
    highlightRequired ? (filled ? "filled" : "empty") : "off";
  const fsBase = (filled: boolean): "off" | "empty" | "filled" =>
    highlightRequired || highlightBase ? (filled ? "filled" : "empty") : "off";
  const hasSupplier = Boolean(line.supplierId || line.supplierName?.trim());
  const hasPayment = Boolean(line.paymentMethod);
  const ingresso = computeSupplyStartDate(insertionDate, line.operationType);

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
    const nextPayment = rule.hasRid ? "RID" : line.paymentMethod || "BOLLETTINO";
    onChange({
      commissionRuleId: ruleId,
      productName: rule.name,
      offerCode: rule.name,
      paymentMethod: nextPayment,
      priceType: line.priceType || "FISSO",
    });
    if (nextPayment === "RID" && !contractIban.trim() && anagraficaIban.trim()) {
      onContractIbanChange(anagraficaIban, true);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {index === 0 ? "Dati contratto" : `Servizio aggiuntivo ${index + 1}`}
          <span className="ml-2 font-normal text-slate-500">
            {line.service === "LUCE"
              ? "Luce"
              : line.service === "GAS"
                ? "Gas"
                : line.service}
          </span>
        </h3>
        {canRemove && onRemove ? (
          <button
            type="button"
            className="text-sm font-medium text-red-600 underline"
            onClick={onRemove}
          >
            Rimuovi
          </button>
        ) : null}
      </div>

      <div
        className={`grid gap-3 ${classificationOptions ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
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
        <Field label="Servizio" fillStatus={fs(Boolean(line.service))}>
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
        {classificationOptions && onClassificationChange ? (
          <Field
            label="Classificazione"
            fillStatus={fs(Boolean(classification?.trim()))}
          >
            <Select
              value={classification ?? ""}
              onChange={(e) => onClassificationChange(e.target.value)}
            >
              <option value="">Seleziona</option>
              {classificationOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
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

      {(line.service === "LUCE" || line.service === "DUAL") && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="POD" fillStatus={fsBase(Boolean(line.pod?.trim()))}>
            <Input
              value={line.pod ?? ""}
              onChange={(e) => onChange({ pod: e.target.value })}
              className="font-mono uppercase"
            />
          </Field>
          <Field label="Potenza (kW)">
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
          <Field label="PDR" fillStatus={fsBase(Boolean(line.pdr?.trim()))}>
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
      {line.service === "TELEFONIA" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Codice migrazione"
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
          <Field label="Numero di telefono">
            <Input
              value={line.phoneNumber ?? ""}
              onChange={(e) => onChange({ phoneNumber: e.target.value })}
            />
          </Field>
        </div>
      ) : null}
      {!isEnergy && line.service !== "TELEFONIA" ? (
        <Field
          label={identifierHint(line.service)}
          fillStatus={fsBase(Boolean((line.migrationCode || line.techNotes || "").trim()))}
        >
          <Input
            value={line.migrationCode ?? line.techNotes ?? ""}
            onChange={(e) =>
              onChange({ migrationCode: e.target.value, techNotes: e.target.value })
            }
          />
        </Field>
      ) : null}

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
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
        <span>Indirizzo di fornitura uguale alla residenza / sede</span>
      </label>
      {!supplySame ? (
        <CapAddressFields
          compact
          compactLabel="Indirizzo di fornitura"
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
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Metodo di pagamento" fillStatus={fsBase(hasPayment)}>
          <Select
            value={line.paymentMethod ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              onChange({ paymentMethod: value });
              if (value === "RID" && !contractIban.trim() && anagraficaIban.trim()) {
                onContractIbanChange(anagraficaIban, true);
              }
            }}
          >
            <option value="">Seleziona</option>
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Titolo sull'immobile">
          <Select
            value={line.propertyHolder ?? ""}
            onChange={(e) => onChange({ propertyHolder: e.target.value })}
          >
            <option value="">Seleziona</option>
            {PROPERTY_HOLDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {needsIban ? (
        <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">IBAN contratto (addebito RID)</p>
            {anagraficaIban.trim() ? (
              <button
                type="button"
                className="text-xs font-medium text-emerald-700 underline"
                onClick={() => onContractIbanChange(anagraficaIban, true)}
              >
                Copia da anagrafica
              </button>
            ) : (
              <span className="text-xs text-amber-700">Nessun IBAN in anagrafica</span>
            )}
          </div>
          <Field
            label="IBAN contratto"
            fillStatus={fs(Boolean(contractIban.trim()))}
          >
            <Input
              value={contractIban}
              onChange={(e) => onContractIbanChange(e.target.value)}
              className="bg-white font-mono"
              placeholder="IT60X..."
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
          />
        </Field>
      ) : null}

      {line.supplierId && rulesForSupplier.length > 0 ? (
        <Field label="Offerta scelta">
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
      ) : null}
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
          placeholder="Es. Dynamic Residenziale"
        />
      </Field>

      <p className="text-xs text-slate-500">
        Ingresso previsto: <strong>{formatItDate(ingresso)}</strong>
      </p>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-sm font-semibold text-slate-600 underline"
      >
        {showAdvanced ? "Nascondi dettagli avanzati" : "Dettagli avanzati (prezzo, PCV)"}
      </button>
      {showAdvanced ? (
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
          <Field label="Prezzo">
            <Select
              value={line.priceType ?? "FISSO"}
              onChange={(e) => onChange({ priceType: e.target.value })}
            >
              <option value="FISSO">Fisso</option>
              <option value="VARIABILE">Variabile</option>
              <option value="INDICIZZATO">Indicizzato</option>
            </Select>
          </Field>
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
          <Field label="Invio bolletta">
            <Select
              value={line.invoiceMode ?? "MAIL"}
              onChange={(e) => {
                const mode = e.target.value;
                onChange({
                  invoiceMode: mode,
                  invoiceEmail: mode === "MAIL" ? clientEmail : line.invoiceEmail,
                });
              }}
            >
              <option value="MAIL">Mail</option>
              <option value="POSTA">Posta</option>
            </Select>
          </Field>
        </div>
      ) : null}
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
