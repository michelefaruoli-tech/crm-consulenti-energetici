"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { updateClientAction } from "@/lib/actions";
import {
  updateClientContractBlockAction,
  updateClientOfferBlockAction,
} from "@/lib/client-sheet-actions";
import {
  CONTRACT_STATUS_LABELS,
  OPERATION_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  ROLE_LABELS,
  SERVICE_OPTIONS,
  type AppContractStatus,
  type AppRole,
} from "@/lib/constants";
import { resolveUtilityDisplay } from "@/lib/utility-display";

export type ClientSheetClient = {
  id: string;
  type: "PRIVATO" | "AZIENDA";
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  fiscalCode: string | null;
  vatNumber: string | null;
  email: string | null;
  pec: string | null;
  phone: string | null;
  iban: string | null;
  address: string | null;
  street: string | null;
  streetNumber: string | null;
  city: string | null;
  province: string | null;
  region: string | null;
  zipCode: string | null;
  country: string | null;
  classification: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  legalFiscalCode: string | null;
  sdiCode: string | null;
  notes: string | null;
};

export type ClientSheetContract = {
  id: string;
  contractNumber: string;
  status: string;
  insertionDate: string;
  updatedAt: string;
  utilityType: string | null;
  operationType: string | null;
  operationOther: string | null;
  serviceOther: string | null;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  powerKw: string | null;
  annualKwh: string | null;
  annualSmc: string | null;
  supplyClassification: string | null;
  voltageLevel: string | null;
  supplyStartDate: string | null;
  notes: string | null;
  paymentMethod: string | null;
  contractIban: string | null;
  ibanHolder: string | null;
  ibanHolderCf: string | null;
  sepaMandate: string | null;
  paymentNotes: string | null;
  addressesMatch: boolean | null;
  supplyStreet: string | null;
  supplyStreetNumber: string | null;
  supplyZipCode: string | null;
  supplyCity: string | null;
  supplyProvince: string | null;
  supplyRegion: string | null;
  supplyCountry: string | null;
  supplyAddress: string | null;
  productName: string | null;
  offerCode: string | null;
  priceType: string | null;
  pcv: string | null;
  pricePerKwh: string | null;
  pricePerSmc: string | null;
  spread: string | null;
  monthlyFee: string | null;
  oneOffFee: string | null;
  discount: string | null;
  economicNotes: string | null;
  durationMonths: number;
  subscriptionDate: string | null;
  supplierId: string;
  supplierName: string;
  collaboratorId: string;
  collaboratorName: string;
  gettone: string;
  koReason: string | null;
  koNotes: string | null;
};

export type ClientSheetSupplier = { id: string; name: string; code: string };
export type ClientSheetCollaborator = {
  id: string;
  name: string;
  active: boolean;
  role: string;
};

export function ClientSheet({
  client,
  contracts,
  suppliers,
  collaborators,
  canEditClient,
  canEditAllContracts,
  sessionUserId,
  canChangeCollaborator,
  canEditGettone,
  initialContractId,
}: {
  client: ClientSheetClient;
  contracts: ClientSheetContract[];
  suppliers: ClientSheetSupplier[];
  collaborators: ClientSheetCollaborator[];
  canEditClient: boolean;
  canEditAllContracts: boolean;
  sessionUserId: string;
  canChangeCollaborator: boolean;
  canEditGettone: boolean;
  initialContractId?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    initialContractId && contracts.some((c) => c.id === initialContractId)
      ? initialContractId
      : contracts[0]?.id ?? null,
  );
  const selected = useMemo(
    () => contracts.find((c) => c.id === selectedId) ?? null,
    [contracts, selectedId],
  );
  const canEditSelected =
    !!selected &&
    (canEditAllContracts || selected.collaboratorId === sessionUserId);

  const [clientDirty, setClientDirty] = useState(false);
  const [block2Dirty, setBlock2Dirty] = useState(false);
  const [block3Dirty, setBlock3Dirty] = useState(false);
  const dirty = clientDirty || block2Dirty || block3Dirty;

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Anagrafica CAP state
  const [zipCode, setZipCode] = useState(client.zipCode ?? "");
  const [city, setCity] = useState(client.city ?? "");
  const [province, setProvince] = useState(client.province ?? "");
  const [region, setRegion] = useState(client.region ?? "");
  const [street, setStreet] = useState(client.street ?? client.address ?? "");
  const [streetNumber, setStreetNumber] = useState(client.streetNumber ?? "");
  const [clientType, setClientType] = useState(client.type);

  // Blocco 2 state
  const [utilityType, setUtilityType] = useState(selected?.utilityType ?? "LUCE");
  const [operationType, setOperationType] = useState(
    selected?.operationType === "CAMBIO" ? "SWITCH" : selected?.operationType ?? "SWITCH",
  );
  const [paymentMethod, setPaymentMethod] = useState(selected?.paymentMethod ?? "BOLLETTINO");
  const [addressesMatch, setAddressesMatch] = useState(Boolean(selected?.addressesMatch));
  const [supplyZip, setSupplyZip] = useState(selected?.supplyZipCode ?? "");
  const [supplyCity, setSupplyCity] = useState(selected?.supplyCity ?? "");
  const [supplyProvince, setSupplyProvince] = useState(selected?.supplyProvince ?? "");
  const [supplyRegion, setSupplyRegion] = useState(selected?.supplyRegion ?? "");
  const [supplyStreet, setSupplyStreet] = useState(selected?.supplyStreet ?? "");
  const [supplyStreetNumber, setSupplyStreetNumber] = useState(
    selected?.supplyStreetNumber ?? "",
  );
  const [contractIban, setContractIban] = useState(
    selected?.contractIban ?? client.iban ?? "",
  );
  const [status, setStatus] = useState(selected?.status ?? "BOZZA");

  useEffect(() => {
    if (!selected) return;
    setUtilityType(selected.utilityType ?? "LUCE");
    setOperationType(
      selected.operationType === "CAMBIO" ? "SWITCH" : selected.operationType ?? "SWITCH",
    );
    setPaymentMethod(selected.paymentMethod ?? "BOLLETTINO");
    setAddressesMatch(Boolean(selected.addressesMatch));
    setSupplyZip(selected.supplyZipCode ?? "");
    setSupplyCity(selected.supplyCity ?? "");
    setSupplyProvince(selected.supplyProvince ?? "");
    setSupplyRegion(selected.supplyRegion ?? "");
    setSupplyStreet(selected.supplyStreet ?? selected.supplyAddress ?? "");
    setSupplyStreetNumber(selected.supplyStreetNumber ?? "");
    setContractIban(selected.contractIban ?? client.iban ?? "");
    setStatus(selected.status);
    setBlock2Dirty(false);
    setBlock3Dirty(false);
  }, [selected, client.iban]);

  function markClientDirty() {
    setClientDirty(true);
    setMsg(null);
    setErr(null);
  }
  function mark2() {
    setBlock2Dirty(true);
    setMsg(null);
    setErr(null);
  }
  function mark3() {
    setBlock3Dirty(true);
    setMsg(null);
    setErr(null);
  }

  function selectContract(id: string) {
    if (dirty && !confirm("Hai modifiche non salvate. Vuoi cambiare contratto senza salvare?")) {
      return;
    }
    setSelectedId(id);
    router.replace(`/clienti/${client.id}?contratto=${id}`, { scroll: false });
  }

  const addressLabel =
    clientType === "AZIENDA" ? "Sede legale" : "Indirizzo di residenza";

  const classificationOptions = useMemo(() => {
    const u = (utilityType || "").toUpperCase();
    if (u === "GAS") {
      if (clientType === "AZIENDA") {
        return [
          { value: "BUSINESS", label: "Business" },
          { value: "INDUSTRIALE", label: "Industriale" },
        ];
      }
      return [
        { value: "DOMESTICO", label: "Domestico" },
        { value: "NON_DOMESTICO", label: "Non domestico" },
        { value: "ALTRI_USI", label: "Altri usi" },
      ];
    }
    // Luce / Dual / altro
    if (clientType === "AZIENDA") {
      return [{ value: "ALTRI_USI", label: "Altri usi" }];
    }
    return [
      { value: "RESIDENTE", label: "Residente" },
      { value: "NON_RESIDENTE", label: "Non residente" },
      { value: "ALTRI_USI", label: "Altri usi" },
    ];
  }, [utilityType, clientType]);

  return (
    <div className="space-y-6">
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {err ? <p className="text-sm text-red-700">{err}</p> : null}

      {/* BLOCCA 1 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-800">
            1
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">Anagrafica cliente</h2>
            <p className="text-xs text-slate-500">Solo residenza / sede legale — niente indirizzo fornitura</p>
          </div>
        </div>

        {canEditClient ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("street", street);
              fd.set("streetNumber", streetNumber);
              fd.set("zipCode", zipCode);
              fd.set("city", city);
              fd.set("province", province);
              fd.set("region", region);
              fd.set("address", [street, streetNumber].filter(Boolean).join(", "));
              start(async () => {
                try {
                  await updateClientAction(fd);
                  setClientDirty(false);
                  setMsg("Anagrafica salvata");
                  router.refresh();
                } catch (error) {
                  setErr(error instanceof Error ? error.message : "Errore salvataggio");
                }
              });
            }}
            onChange={markClientDirty}
          >
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Tipo">
              <Select
                name="type"
                value={clientType}
                onChange={(e) => {
                  setClientType(e.target.value as "PRIVATO" | "AZIENDA");
                  markClientDirty();
                }}
              >
                <option value="PRIVATO">Privato</option>
                <option value="AZIENDA">Business</option>
              </Select>
            </Field>

            {clientType === "PRIVATO" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome">
                  <Input name="firstName" defaultValue={client.firstName ?? ""} />
                </Field>
                <Field label="Cognome">
                  <Input name="lastName" defaultValue={client.lastName ?? ""} />
                </Field>
              </div>
            ) : (
              <>
                <Field label="Ragione sociale">
                  <Input name="companyName" defaultValue={client.companyName ?? ""} />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Nome referente / amministratore">
                    <Input name="legalFirstName" defaultValue={client.legalFirstName ?? ""} />
                  </Field>
                  <Field label="Cognome referente / amministratore">
                    <Input name="legalLastName" defaultValue={client.legalLastName ?? ""} />
                  </Field>
                </div>
                <Field label="Partita IVA">
                  <Input name="vatNumber" defaultValue={client.vatNumber ?? ""} />
                </Field>
                <Field label="Codice destinatario (SDI)">
                  <Input name="sdiCode" defaultValue={client.sdiCode ?? ""} />
                </Field>
              </>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Codice fiscale">
                <Input name="fiscalCode" defaultValue={client.fiscalCode ?? ""} />
              </Field>
              <Field label="Telefono">
                <Input name="phone" defaultValue={client.phone ?? ""} />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Email">
                <Input name="email" type="email" defaultValue={client.email ?? ""} />
              </Field>
              <Field label="PEC (facoltativa)">
                <Input name="pec" defaultValue={client.pec ?? ""} />
              </Field>
            </div>
            <Field label="IBAN (facoltativo)">
              <Input name="iban" defaultValue={client.iban ?? ""} />
            </Field>

            <h3 className="pt-2 text-sm font-semibold text-slate-800">{addressLabel}</h3>
            <CapAddressFields
              zipCode={zipCode}
              city={city}
              province={province}
              region={region}
              street={street}
              streetNumber={streetNumber}
              onZipChange={(v) => {
                setZipCode(v);
                markClientDirty();
              }}
              onCityChange={(v) => {
                setCity(v);
                markClientDirty();
              }}
              onProvinceChange={(v) => {
                setProvince(v);
                markClientDirty();
              }}
              onRegionChange={(v) => {
                setRegion(v);
                markClientDirty();
              }}
              onStreetChange={(v) => {
                setStreet(v);
                markClientDirty();
              }}
              onStreetNumberChange={(v) => {
                setStreetNumber(v);
                markClientDirty();
              }}
            />
            <Field label="Nazione">
              <Input name="country" defaultValue={client.country ?? "Italia"} />
            </Field>
            <Field label="Note">
              <Textarea name="notes" rows={2} defaultValue={client.notes ?? ""} />
            </Field>

            <Button type="submit" disabled={!clientDirty || pending}>
              {pending && clientDirty ? "Salvataggio…" : "Salva anagrafica"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">Non hai permesso di modificare l&apos;anagrafica.</p>
        )}
      </section>

      {/* Elenco contratti */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">
          Contratti del cliente ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nessun contratto.{" "}
            <Link href={`/contratti/nuovo?clientId=${client.id}`} className="text-emerald-700 underline">
              Creane uno
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2">N°</th>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Servizio / ID</th>
                  <th className="px-2 py-2">Fornitore</th>
                  <th className="px-2 py-2">Collaboratore</th>
                  <th className="px-2 py-2">Stato</th>
                  <th className="px-2 py-2">Gettone</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const u = resolveUtilityDisplay(c);
                  const active = c.id === selectedId;
                  return (
                    <tr
                      key={c.id}
                      className={
                        active
                          ? "border-t border-emerald-200 bg-emerald-50"
                          : "border-t border-slate-100"
                      }
                    >
                      <td className="px-2 py-2 font-medium">{c.contractNumber}</td>
                      <td className="px-2 py-2">{c.insertionDate}</td>
                      <td className="px-2 py-2">
                        <div className="text-xs">{u.techLines.join(" · ") || "—"}</div>
                        <div className="text-[10px] uppercase text-slate-500">{u.serviceLabel}</div>
                      </td>
                      <td className="px-2 py-2">{c.supplierName}</td>
                      <td className="px-2 py-2">{c.collaboratorName}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-2 py-2">€ {c.gettone}</td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={active ? "primary" : "secondary"}
                          onClick={() => selectContract(c.id)}
                        >
                          {active ? "Selezionato" : "Apri"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && canEditSelected ? (
        <>
          {/* BLOCCA 2 */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-800">
                2
              </span>
              <div>
                <h2 className="font-semibold text-slate-900">Contratto e dati della fornitura</h2>
                <p className="text-xs text-slate-500">{selected.contractNumber}</p>
              </div>
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("utilityType", utilityType);
                fd.set("operationType", operationType);
                fd.set("paymentMethod", paymentMethod);
                fd.set("addressesMatch", addressesMatch ? "true" : "false");
                fd.set("supplyStreet", supplyStreet);
                fd.set("supplyStreetNumber", supplyStreetNumber);
                fd.set("supplyZipCode", supplyZip);
                fd.set("supplyCity", supplyCity);
                fd.set("supplyProvince", supplyProvince);
                fd.set("supplyRegion", supplyRegion);
                fd.set("contractIban", contractIban);
                start(async () => {
                  try {
                    await updateClientContractBlockAction(fd);
                    setBlock2Dirty(false);
                    setMsg("Contratto salvato");
                    router.refresh();
                  } catch (error) {
                    setErr(error instanceof Error ? error.message : "Errore salvataggio");
                  }
                });
              }}
              onChange={mark2}
            >
              <input type="hidden" name="contractId" value={selected.id} />
              <input type="hidden" name="clientId" value={client.id} />

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Numero contratto">
                  <Input readOnly value={selected.contractNumber} />
                </Field>
                <Field label="Data creazione">
                  <Input readOnly value={selected.insertionDate} />
                </Field>
                <Field label="Ultimo aggiornamento">
                  <Input readOnly value={selected.updatedAt} />
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Servizio">
                  <Select
                    value={utilityType}
                    onChange={(e) => {
                      setUtilityType(e.target.value);
                      mark2();
                    }}
                  >
                    {SERVICE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tipo operazione">
                  <Select
                    value={operationType}
                    onChange={(e) => {
                      setOperationType(e.target.value);
                      mark2();
                    }}
                  >
                    {OPERATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {operationType === "ALTRO" ? (
                <Field label="Specifica operazione *">
                  <Input name="operationOther" defaultValue={selected.operationOther ?? ""} required />
                </Field>
              ) : null}

              {(utilityType === "LUCE" || utilityType === "DUAL") && (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="POD">
                    <Input name="pod" defaultValue={selected.pod ?? selected.podPdr ?? ""} />
                  </Field>
                  <Field label="Potenza impegnata (kW)">
                    <Input name="powerKw" defaultValue={selected.powerKw ?? ""} />
                  </Field>
                  <Field label="Consumo annuo (kWh)">
                    <Input name="annualKwh" defaultValue={selected.annualKwh ?? ""} />
                  </Field>
                </div>
              )}
              {(utilityType === "GAS" || utilityType === "DUAL") && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="PDR">
                    <Input name="pdr" defaultValue={selected.pdr ?? ""} />
                  </Field>
                  <Field label="Consumo annuo (Smc)">
                    <Input name="annualSmc" defaultValue={selected.annualSmc ?? ""} />
                  </Field>
                </div>
              )}
              {utilityType !== "LUCE" &&
              utilityType !== "GAS" &&
              utilityType !== "DUAL" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Identificativo">
                    <Input name="podPdr" defaultValue={selected.podPdr ?? ""} />
                  </Field>
                  <Field label="Descrizione / dettagli">
                    <Input name="serviceOther" defaultValue={selected.serviceOther ?? ""} />
                  </Field>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Classificazione fornitura">
                  <Select
                    name="supplyClassification"
                    defaultValue={
                      selected.supplyClassification ??
                      (clientType === "AZIENDA" && utilityType !== "GAS"
                        ? "ALTRI_USI"
                        : "")
                    }
                    onChange={mark2}
                  >
                    <option value="">—</option>
                    {classificationOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {clientType === "AZIENDA" &&
                (utilityType === "LUCE" || utilityType === "DUAL") ? (
                  <Field label="Livello di tensione">
                    <Select name="voltageLevel" defaultValue={selected.voltageLevel ?? ""}>
                      <option value="">—</option>
                      <option value="BASSA">Bassa tensione</option>
                      <option value="MEDIA">Media tensione</option>
                    </Select>
                  </Field>
                ) : null}
              </div>

              <Field label="Data ingresso in fornitura">
                <Input
                  type="date"
                  name="supplyStartDate"
                  defaultValue={selected.supplyStartDate ?? ""}
                />
              </Field>
              <Field label="Note contratto">
                <Textarea name="notes" rows={2} defaultValue={selected.notes ?? ""} />
              </Field>

              <h3 className="pt-2 text-sm font-semibold text-slate-800">Indirizzo di fornitura</h3>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={addressesMatch}
                  onChange={(e) => {
                    setAddressesMatch(e.target.checked);
                    if (e.target.checked) {
                      setSupplyStreet(street);
                      setSupplyStreetNumber(streetNumber);
                      setSupplyZip(zipCode);
                      setSupplyCity(city);
                      setSupplyProvince(province);
                      setSupplyRegion(region);
                    }
                    mark2();
                  }}
                />
                Coincide con la residenza o sede legale
              </label>
              {!addressesMatch ? (
                <CapAddressFields
                  zipCode={supplyZip}
                  city={supplyCity}
                  province={supplyProvince}
                  region={supplyRegion}
                  street={supplyStreet}
                  streetNumber={supplyStreetNumber}
                  onZipChange={(v) => {
                    setSupplyZip(v);
                    mark2();
                  }}
                  onCityChange={(v) => {
                    setSupplyCity(v);
                    mark2();
                  }}
                  onProvinceChange={(v) => {
                    setSupplyProvince(v);
                    mark2();
                  }}
                  onRegionChange={(v) => {
                    setSupplyRegion(v);
                    mark2();
                  }}
                  onStreetChange={(v) => {
                    setSupplyStreet(v);
                    mark2();
                  }}
                  onStreetNumberChange={(v) => {
                    setSupplyStreetNumber(v);
                    mark2();
                  }}
                />
              ) : (
                <p className="text-xs text-slate-500">
                  Verrà salvata una copia dell&apos;indirizzo anagrafico sul contratto.
                </p>
              )}
              <input type="hidden" name="supplyCountry" value="Italia" />

              <h3 className="pt-2 text-sm font-semibold text-slate-800">Modalità di pagamento</h3>
              <Field label="Pagamento">
                <Select
                  value={paymentMethod}
                  onChange={(e) => {
                    setPaymentMethod(e.target.value);
                    if (e.target.value === "RID" && !contractIban && client.iban) {
                      setContractIban(client.iban);
                    }
                    mark2();
                  }}
                >
                  {PAYMENT_METHOD_OPTIONS.filter((o) =>
                    ["BOLLETTINO", "RID"].includes(o.value),
                  ).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {paymentMethod === "RID" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="IBAN contratto *">
                    <Input
                      value={contractIban}
                      onChange={(e) => {
                        setContractIban(e.target.value);
                        mark2();
                      }}
                      required
                    />
                  </Field>
                  <Field label="Intestatario conto">
                    <Input name="ibanHolder" defaultValue={selected.ibanHolder ?? ""} />
                  </Field>
                  <Field label="CF intestatario">
                    <Input name="ibanHolderCf" defaultValue={selected.ibanHolderCf ?? ""} />
                  </Field>
                  <Field label="Mandato SEPA">
                    <Input name="sepaMandate" defaultValue={selected.sepaMandate ?? ""} />
                  </Field>
                </div>
              ) : null}
              <Field label="Note pagamento">
                <Input name="paymentNotes" defaultValue={selected.paymentNotes ?? ""} />
              </Field>

              <Button type="submit" disabled={!block2Dirty || pending}>
                {pending && block2Dirty ? "Salvataggio…" : "Salva contratto"}
              </Button>
            </form>
          </section>

          {/* BLOCCA 3 */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold text-amber-900">
                3
              </span>
              <div>
                <h2 className="font-semibold text-slate-900">Fornitore, offerta, stato e gettone</h2>
                <p className="text-xs text-slate-500">Dati commerciali e operativi</p>
              </div>
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set("status", status);
                start(async () => {
                  try {
                    await updateClientOfferBlockAction(fd);
                    setBlock3Dirty(false);
                    setMsg("Offerta e stato salvati");
                    router.refresh();
                  } catch (error) {
                    setErr(error instanceof Error ? error.message : "Errore salvataggio");
                  }
                });
              }}
              onChange={mark3}
            >
              <input type="hidden" name="contractId" value={selected.id} />
              <input type="hidden" name="clientId" value={client.id} />

              <Field label="Fornitore">
                <Select name="supplierId" defaultValue={selected.supplierId}>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome offerta">
                  <Input name="productName" defaultValue={selected.productName ?? ""} />
                </Field>
                <Field label="Codice offerta">
                  <Input name="offerCode" defaultValue={selected.offerCode ?? ""} />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Tipo prezzo">
                  <Select name="priceType" defaultValue={selected.priceType ?? ""}>
                    <option value="">—</option>
                    <option value="FISSO">Fisso</option>
                    <option value="INDICIZZATO">Indicizzato</option>
                  </Select>
                </Field>
                <Field label="PCV">
                  <Input name="pcv" defaultValue={selected.pcv ?? ""} />
                </Field>
                <Field label="Spread">
                  <Input name="spread" defaultValue={selected.spread ?? ""} />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Prezzo kWh">
                  <Input name="pricePerKwh" defaultValue={selected.pricePerKwh ?? ""} />
                </Field>
                <Field label="Prezzo Smc">
                  <Input name="pricePerSmc" defaultValue={selected.pricePerSmc ?? ""} />
                </Field>
                <Field label="Quota fissa">
                  <Input name="monthlyFee" defaultValue={selected.monthlyFee ?? ""} />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Sconto / Bonus">
                  <Input name="discount" defaultValue={selected.discount ?? ""} />
                </Field>
                <Field label="Durata (mesi)">
                  <Input name="durationMonths" defaultValue={String(selected.durationMonths)} />
                </Field>
              </div>
              <Field label="Note economiche">
                <Textarea name="economicNotes" rows={2} defaultValue={selected.economicNotes ?? ""} />
              </Field>

              <Field label="Stato contratto">
                <Select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    mark3();
                  }}
                >
                  {(Object.keys(CONTRACT_STATUS_LABELS) as AppContractStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {CONTRACT_STATUS_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              {(status === "KO" || status === "ANNULLATO") && (
                <>
                  <Field label={status === "KO" ? "Motivo KO *" : "Motivo annullamento *"}>
                    <Input name="koReason" defaultValue={selected.koReason ?? ""} required />
                  </Field>
                  <Field label="Note">
                    <Textarea name="koNotes" rows={2} defaultValue={selected.koNotes ?? ""} />
                  </Field>
                </>
              )}

              <Field label="Valore gettone (€)">
                <Input
                  name="gettone"
                  defaultValue={selected.gettone}
                  disabled={!canEditGettone}
                  title={
                    canEditGettone
                      ? "Gettone previsto (Commission.expected)"
                      : "Non autorizzato a modificare il gettone"
                  }
                />
              </Field>

              <Field label="Collaboratore">
                {canChangeCollaborator ? (
                  <Select name="collaboratorId" defaultValue={selected.collaboratorId}>
                    {collaborators.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.active}>
                        {c.name}
                        {!c.active ? " (inattivo)" : ""}
                        {" · "}
                        {ROLE_LABELS[c.role as AppRole] ?? c.role}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <Input readOnly value={selected.collaboratorName} />
                    <input type="hidden" name="collaboratorId" value={selected.collaboratorId} />
                  </>
                )}
              </Field>

              <Button type="submit" disabled={!block3Dirty || pending}>
                {pending && block3Dirty ? "Salvataggio…" : "Salva offerta e stato"}
              </Button>
            </form>
          </section>
        </>
      ) : selected ? (
        <p className="text-sm text-slate-500">
          Contratto selezionato in sola lettura.{" "}
          <Link href={`/contratti/${selected.id}`} className="text-emerald-700 underline">
            Apri scheda contratto
          </Link>
        </p>
      ) : null}
    </div>
  );
}
