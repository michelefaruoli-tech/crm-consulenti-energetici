"use client";

import { useState } from "react";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createClientAction } from "@/lib/actions";

export function NuovoClienteForm() {
  const [clientType, setClientType] = useState<"PRIVATO" | "AZIENDA">("PRIVATO");
  const [zipCode, setZipCode] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [region, setRegion] = useState("");
  const [street, setStreet] = useState("");
  const [streetNumber, setStreetNumber] = useState("");

  const addressLabel =
    clientType === "AZIENDA" ? "Sede legale" : "Indirizzo di residenza";

  return (
    <form
      action={createClientAction}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <Field label="Tipo cliente">
        <Select
          name="type"
          value={clientType}
          onChange={(e) => setClientType(e.target.value as "PRIVATO" | "AZIENDA")}
        >
          <option value="PRIVATO">Privato</option>
          <option value="AZIENDA">Azienda / Business</option>
        </Select>
      </Field>

      {clientType === "PRIVATO" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome">
            <Input name="firstName" />
          </Field>
          <Field label="Cognome">
            <Input name="lastName" />
          </Field>
        </div>
      ) : (
        <>
          <Field label="Ragione sociale">
            <Input name="companyName" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome referente">
              <Input name="legalFirstName" />
            </Field>
            <Field label="Cognome referente">
              <Input name="legalLastName" />
            </Field>
          </div>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Codice fiscale">
          <Input name="fiscalCode" />
        </Field>
        <Field label="Partita IVA">
          <Input name="vatNumber" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Email">
          <Input name="email" type="email" />
        </Field>
        <Field label="Telefono">
          <Input name="phone" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="PEC (facoltativa)">
          <Input name="pec" />
        </Field>
        <Field label="IBAN (facoltativo)">
          <Input name="iban" />
        </Field>
      </div>

      <h3 className="pt-2 text-sm font-semibold text-slate-800">{addressLabel}</h3>
      <input type="hidden" name="street" value={street} />
      <input type="hidden" name="streetNumber" value={streetNumber} />
      <input type="hidden" name="zipCode" value={zipCode} />
      <input type="hidden" name="city" value={city} />
      <input type="hidden" name="province" value={province} />
      <input type="hidden" name="region" value={region} />
      <input
        type="hidden"
        name="address"
        value={[street, streetNumber].filter(Boolean).join(", ")}
      />
      <CapAddressFields
        zipCode={zipCode}
        city={city}
        province={province}
        region={region}
        street={street}
        streetNumber={streetNumber}
        onZipChange={setZipCode}
        onCityChange={setCity}
        onProvinceChange={setProvince}
        onRegionChange={setRegion}
        onStreetChange={setStreet}
        onStreetNumberChange={setStreetNumber}
      />
      <Field label="Nazione">
        <Input name="country" defaultValue="Italia" />
      </Field>

      <Field label="Note">
        <Textarea name="notes" rows={4} />
      </Field>

      <Button type="submit">Salva cliente</Button>
    </form>
  );
}
