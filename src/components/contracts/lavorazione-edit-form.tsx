"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { updateLavorazioneContractAction } from "@/lib/lavorazione-edit-action";
import {
  OPERATION_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SERVICE_OPTIONS,
} from "@/lib/constants";

export type LavorazioneEditData = {
  id: string;
  utilityType: string | null;
  serviceOther: string | null;
  operationType: string | null;
  operationOther: string | null;
  pod: string | null;
  pdr: string | null;
  podPdr: string | null;
  productName: string | null;
  offerCode: string | null;
  contractKind: string | null;
  priceType: string | null;
  pricePerKwh: string | null;
  pricePerSmc: string | null;
  pcv: string | null;
  spread: string | null;
  monthlyFee: string | null;
  powerKw: string | null;
  annualKwh: string | null;
  annualSmc: string | null;
  paymentMethod: string | null;
  contractIban: string | null;
  ibanHolder: string | null;
  supplyStreet: string | null;
  supplyStreetNumber: string | null;
  supplyZipCode: string | null;
  supplyCity: string | null;
  supplyProvince: string | null;
  supplyRegion: string | null;
  notes: string | null;
  masterNotes: string | null;
  workNotes: string | null;
  durationMonths: number | null;
  client: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    fiscalCode: string | null;
    vatNumber: string | null;
    phone: string | null;
    email: string | null;
    pec: string | null;
    iban: string | null;
    street: string | null;
    streetNumber: string | null;
    zipCode: string | null;
    city: string | null;
    province: string | null;
    region: string | null;
  };
};

function dec(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

export function LavorazioneEditForm({
  data,
  canEdit,
}: {
  data: LavorazioneEditData;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [utilityType, setUtilityType] = useState(
    data.utilityType === "GAS" || data.utilityType === "LUCE" || data.utilityType === "ALTRO"
      ? data.utilityType
      : data.utilityType
        ? "ALTRO"
        : "LUCE",
  );
  const [serviceOther, setServiceOther] = useState(data.serviceOther ?? "");
  const [pod, setPod] = useState(data.pod ?? "");
  const [pdr, setPdr] = useState(data.pdr ?? "");

  const [clientZip, setClientZip] = useState(data.client.zipCode ?? "");
  const [clientCity, setClientCity] = useState(data.client.city ?? "");
  const [clientProvince, setClientProvince] = useState(data.client.province ?? "");
  const [clientRegion, setClientRegion] = useState(data.client.region ?? "");
  const [clientStreet, setClientStreet] = useState(data.client.street ?? "");
  const [clientStreetNumber, setClientStreetNumber] = useState(
    data.client.streetNumber ?? "",
  );

  const [supplyZip, setSupplyZip] = useState(data.supplyZipCode ?? "");
  const [supplyCity, setSupplyCity] = useState(data.supplyCity ?? "");
  const [supplyProvince, setSupplyProvince] = useState(data.supplyProvince ?? "");
  const [supplyRegion, setSupplyRegion] = useState(data.supplyRegion ?? "");
  const [supplyStreet, setSupplyStreet] = useState(data.supplyStreet ?? "");
  const [supplyStreetNumber, setSupplyStreetNumber] = useState(
    data.supplyStreetNumber ?? "",
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    setOk(null);
  }

  if (!canEdit) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Non hai il permesso di modificare questa pratica. Puoi solo consultarla.
      </p>
    );
  }

  return (
    <form
      className="space-y-6"
      onChange={markDirty}
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty) return;
        setError(null);
        setOk(null);
        const fd = new FormData(e.currentTarget);
        fd.set("contractId", data.id);
        fd.set("utilityType", utilityType);
        fd.set("serviceOther", serviceOther);
        fd.set("pod", pod);
        fd.set("pdr", pdr);
        fd.set("clientZipCode", clientZip);
        fd.set("clientCity", clientCity);
        fd.set("clientProvince", clientProvince);
        fd.set("clientRegion", clientRegion);
        fd.set("clientStreet", clientStreet);
        fd.set("clientStreetNumber", clientStreetNumber);
        fd.set("supplyZipCode", supplyZip);
        fd.set("supplyCity", supplyCity);
        fd.set("supplyProvince", supplyProvince);
        fd.set("supplyRegion", supplyRegion);
        fd.set("supplyStreet", supplyStreet);
        fd.set("supplyStreetNumber", supplyStreetNumber);
        start(async () => {
          const res = await updateLavorazioneContractAction(fd);
          if (!res.ok) {
            setError(res.error ?? "Salvataggio non riuscito");
            return;
          }
          setOk(res.message ?? "Salvato");
          setDirty(false);
          router.refresh();
        });
      }}
    >
      {error ? (
        <PersistentAlert
          title="Errore di salvataggio"
          messages={[error]}
          onClose={() => setError(null)}
        />
      ) : null}
      {ok ? (
        <PersistentAlert
          title="Salvataggio riuscito"
          messages={[ok]}
          tone="success"
          onClose={() => setOk(null)}
        />
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Dati cliente</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nome">
            <Input name="clientFirstName" defaultValue={data.client.firstName ?? ""} />
          </Field>
          <Field label="Cognome">
            <Input name="clientLastName" defaultValue={data.client.lastName ?? ""} />
          </Field>
          <Field label="Ragione sociale">
            <Input name="clientCompanyName" defaultValue={data.client.companyName ?? ""} />
          </Field>
          <Field label="Codice fiscale">
            <Input name="clientFiscalCode" defaultValue={data.client.fiscalCode ?? ""} />
          </Field>
          <Field label="Partita IVA">
            <Input name="clientVatNumber" defaultValue={data.client.vatNumber ?? ""} />
          </Field>
          <Field label="Telefono">
            <Input name="clientPhone" defaultValue={data.client.phone ?? ""} />
          </Field>
          <Field label="Email">
            <Input name="clientEmail" defaultValue={data.client.email ?? ""} />
          </Field>
          <Field label="PEC">
            <Input name="clientPec" defaultValue={data.client.pec ?? ""} />
          </Field>
          <Field label="IBAN">
            <Input name="clientIban" defaultValue={data.client.iban ?? ""} />
          </Field>
        </div>
        <div className="mt-4">
          <CapAddressFields
            zipCode={clientZip}
            city={clientCity}
            province={clientProvince}
            region={clientRegion}
            street={clientStreet}
            streetNumber={clientStreetNumber}
            onZipChange={(v) => {
              setClientZip(v);
              markDirty();
            }}
            onCityChange={setClientCity}
            onProvinceChange={setClientProvince}
            onRegionChange={setClientRegion}
            onStreetChange={setClientStreet}
            onStreetNumberChange={setClientStreetNumber}
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Dati fornitura</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Servizio">
            <Select
              value={utilityType}
              onChange={(e) => {
                setUtilityType(e.target.value);
                markDirty();
              }}
            >
              {SERVICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {utilityType === "LUCE" ? (
            <Field label="POD">
              <Input value={pod} onChange={(e) => setPod(e.target.value)} />
            </Field>
          ) : null}
          {utilityType === "GAS" ? (
            <Field label="PDR">
              <Input value={pdr} onChange={(e) => setPdr(e.target.value)} />
            </Field>
          ) : null}
          {utilityType === "ALTRO" ? (
            <Field label="Specifica servizio *">
              <Input
                value={serviceOther}
                onChange={(e) => setServiceOther(e.target.value)}
                required
              />
            </Field>
          ) : null}
          <Field label="Tipo operazione">
            <Select name="operationType" defaultValue={data.operationType ?? ""}>
              <option value="">—</option>
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Consumo annuo kWh">
            <Input name="annualKwh" defaultValue={dec(data.annualKwh)} />
          </Field>
          <Field label="Potenza kW">
            <Input name="powerKw" defaultValue={dec(data.powerKw)} />
          </Field>
          <Field label="Consumo annuo Smc">
            <Input name="annualSmc" defaultValue={dec(data.annualSmc)} />
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Indirizzo di fornitura</p>
          <CapAddressFields
            zipCode={supplyZip}
            city={supplyCity}
            province={supplyProvince}
            region={supplyRegion}
            street={supplyStreet}
            streetNumber={supplyStreetNumber}
            onZipChange={(v) => {
              setSupplyZip(v);
              markDirty();
            }}
            onCityChange={setSupplyCity}
            onProvinceChange={setSupplyProvince}
            onRegionChange={setSupplyRegion}
            onStreetChange={setSupplyStreet}
            onStreetNumberChange={setSupplyStreetNumber}
            zipLabel="CAP fornitura"
          />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Condizioni contrattuali</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nome offerta">
            <Input name="productName" defaultValue={data.productName ?? ""} />
          </Field>
          <Field label="Codice offerta">
            <Input name="offerCode" defaultValue={data.offerCode ?? ""} />
          </Field>
          <Field label="Tipo contratto">
            <Input name="contractKind" defaultValue={data.contractKind ?? ""} />
          </Field>
          <Field label="Tipo prezzo">
            <Input name="priceType" defaultValue={data.priceType ?? ""} />
          </Field>
          <Field label="Prezzo €/kWh">
            <Input name="pricePerKwh" defaultValue={dec(data.pricePerKwh)} />
          </Field>
          <Field label="Prezzo €/Smc">
            <Input name="pricePerSmc" defaultValue={dec(data.pricePerSmc)} />
          </Field>
          <Field label="PCV">
            <Input name="pcv" defaultValue={dec(data.pcv)} />
          </Field>
          <Field label="Spread">
            <Input name="spread" defaultValue={dec(data.spread)} />
          </Field>
          <Field label="Canone mensile">
            <Input name="monthlyFee" defaultValue={dec(data.monthlyFee)} />
          </Field>
          <Field label="Durata (mesi)">
            <Input
              name="durationMonths"
              defaultValue={data.durationMonths != null ? String(data.durationMonths) : "12"}
            />
          </Field>
          <Field label="Metodo pagamento">
            <Select name="paymentMethod" defaultValue={data.paymentMethod ?? ""}>
              <option value="">—</option>
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="IBAN contratto">
            <Input name="contractIban" defaultValue={data.contractIban ?? ""} />
          </Field>
          <Field label="Intestatario IBAN">
            <Input name="ibanHolder" defaultValue={data.ibanHolder ?? ""} />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Note</h2>
        <div className="grid gap-3">
          <Field label="Note interne">
            <Textarea name="notes" rows={2} defaultValue={data.notes ?? ""} />
          </Field>
          <Field label="Note Master">
            <Textarea name="masterNotes" rows={2} defaultValue={data.masterNotes ?? ""} />
          </Field>
          <Field label="Note operative">
            <Textarea name="workNotes" rows={2} defaultValue={data.workNotes ?? ""} />
          </Field>
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/95 px-4 py-3 shadow-lg backdrop-blur">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Salvataggio…" : "Salva cambiamenti"}
        </Button>
        {dirty ? (
          <span className="text-sm text-amber-800">Ci sono modifiche non salvate.</span>
        ) : (
          <span className="text-sm text-slate-600">Nessuna modifica in sospeso.</span>
        )}
      </div>
    </form>
  );
}
