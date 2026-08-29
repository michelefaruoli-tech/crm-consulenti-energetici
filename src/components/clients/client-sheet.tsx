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

const SERVICE_VALUE_SET = new Set<string>(SERVICE_OPTIONS.map((o) => o.value));

function normalizeUtilityType(raw: string | null | undefined): string {
  const u = (raw ?? "LUCE").toUpperCase();
  return SERVICE_VALUE_SET.has(u) ? u : "ALTRO";
}

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
  commissionConfirmed: boolean;
  commissionRuleId?: string | null;
  warnOnEdit?: boolean;
  stornoLabel?: string;
  koReason: string | null;
  koNotes: string | null;
  /** Contratto padre se creato insieme (es. Gas collegato a Luce) */
  parentContractId?: string | null;
  emailStatus?: string | null;
  createdAt?: string | null;
};

export type ClientSheetSupplier = { id: string; name: string; code: string };
export type ClientSheetListinoRule = {
  id: string;
  supplierId: string;
  name: string;
  clientSegment: string;
  gettoneBase: string;
  gettoneTotale: string;
  hasRid?: boolean;
};
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
  listinoRules = [],
  collaborators,
  canEditClient,
  canEditAllContracts,
  sessionUserId,
  canChangeCollaborator,
  canEditGettone,
  canEditOwnGettone,
  initialContractId,
}: {
  client: ClientSheetClient;
  contracts: ClientSheetContract[];
  suppliers: ClientSheetSupplier[];
  listinoRules?: ClientSheetListinoRule[];
  collaborators: ClientSheetCollaborator[];
  canEditClient: boolean;
  canEditAllContracts: boolean;
  sessionUserId: string;
  canChangeCollaborator: boolean;
  canEditGettone: boolean;
  canEditOwnGettone?: boolean;
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
  const canEditSelectedGettone =
    !!selected &&
    (canEditGettone ||
      (!!canEditOwnGettone && selected.collaboratorId === sessionUserId));

  const [clientDirty, setClientDirty] = useState(false);
  const [block2Dirty, setBlock2Dirty] = useState(false);
  const [block3Dirty, setBlock3Dirty] = useState(false);
  const dirty = clientDirty || block2Dirty || block3Dirty;

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);

  /** Contratti creati insieme (padre + figli) per invio email unica. */
  function siblingContractIds(contractId: string): string[] {
    const c = contracts.find((x) => x.id === contractId);
    if (!c) return [contractId];
    const root = c.parentContractId || c.id;
    const linked = contracts.filter(
      (x) => x.id === root || x.parentContractId === root,
    );
    if (linked.length > 1) return linked.map((x) => x.id);

    // Fallback: stesso collaboratore creati entro 5 minuti (Luce+Gas senza parent link)
    if (c.createdAt) {
      const t = new Date(c.createdAt).getTime();
      const near = contracts.filter((x) => {
        if (x.collaboratorId !== c.collaboratorId) return false;
        if (!x.createdAt) return false;
        return Math.abs(new Date(x.createdAt).getTime() - t) <= 5 * 60 * 1000;
      });
      if (near.length > 1) return near.map((x) => x.id);
    }
    return [contractId];
  }

  function sendBackofficeEmail(contractId: string) {
    const ids = siblingContractIds(contractId);
    const labels = ids
      .map((id) => {
        const c = contracts.find((x) => x.id === id);
        return c ? `${c.utilityType || "?"} ${c.contractNumber}` : id.slice(-6);
      })
      .join(" + ");
    const ok = window.confirm(
      ids.length > 1
        ? `INVIA AL BACK OFFICE\n\nVerrà inviata un'unica email con:\n${labels}\n\n(anagrafica + blocchi servizio + allegati)\n\nConfermi?`
        : `INVIA AL BACK OFFICE\n\nInviare l'email per ${labels}?\n\nConfermi?`,
    );
    if (!ok) return;

    setErr(null);
    setMsg(null);
    setSendingEmailId(contractId);
    start(async () => {
      try {
        const res = await fetch("/api/contracts/notify-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractIds: ids }),
        });
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          emailSent?: boolean;
          message?: string;
          recipients?: string;
        } | null;
        if (!res.ok || !json?.emailSent) {
          setErr(json?.message || "Invio email non riuscito");
          return;
        }
        setMsg(
          json.message ||
            (ids.length > 1
              ? `Email inviata per ${ids.length} contratti (${labels}).`
              : `Email inviata per ${labels}.`),
        );
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore di rete");
      } finally {
        setSendingEmailId(null);
      }
    });
  }

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
  const [utilityType, setUtilityType] = useState(() =>
    normalizeUtilityType(selected?.utilityType),
  );
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
  const [offerSupplierId, setOfferSupplierId] = useState(selected?.supplierId ?? "");
  const [commissionRuleId, setCommissionRuleId] = useState(selected?.commissionRuleId ?? "");
  const [productName, setProductName] = useState(selected?.productName ?? "");
  const [offerCode, setOfferCode] = useState(selected?.offerCode ?? "");
  const [gettoneValue, setGettoneValue] = useState(selected?.gettone ?? "");
  const [priceType, setPriceType] = useState(selected?.priceType ?? "");

  const rulesForSupplier = useMemo(
    () => listinoRules.filter((r) => r.supplierId === offerSupplierId),
    [listinoRules, offerSupplierId],
  );

  const needsIban = paymentMethod === "RID";
  const isEnergy =
    utilityType === "LUCE" || utilityType === "GAS" || utilityType === "DUAL";

  useEffect(() => {
    if (!selected) return;
    // Il cambio contratto selezionato deve riallineare l'intero form locale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUtilityType(normalizeUtilityType(selected.utilityType));
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
    setOfferSupplierId(selected.supplierId);
    setCommissionRuleId(selected.commissionRuleId ?? "");
    setProductName(selected.productName ?? "");
    setOfferCode(selected.offerCode ?? "");
    setGettoneValue(selected.gettone ?? "");
    setPriceType(selected.priceType ?? "");
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
                <Field label="Cognome">
                  <Input name="lastName" defaultValue={client.lastName ?? ""} />
                </Field>
                <Field label="Nome">
                  <Input name="firstName" defaultValue={client.firstName ?? ""} />
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

            <Field label="Codice fiscale">
              <Input name="fiscalCode" defaultValue={client.fiscalCode ?? ""} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telefono">
                <Input name="phone" defaultValue={client.phone ?? ""} />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" defaultValue={client.email ?? ""} />
              </Field>
            </div>
            <Field label="PEC (facoltativa)">
              <Input name="pec" defaultValue={client.pec ?? ""} />
            </Field>
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

            <Button type="submit" disabled={pending}>
              {pending && clientDirty ? "Salvataggio…" : "Salva anagrafica"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">Non hai permesso di modificare l&apos;anagrafica.</p>
        )}
      </section>

      {/* Elenco contratti */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">
            Contratti stipulati ({contracts.length})
          </h2>
          <Link
            href={`/contratti/nuovo?clientId=${client.id}`}
            className="text-sm font-medium text-emerald-700 underline"
          >
            + Nuovo contratto
          </Link>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Se un invio fallisce, usa <strong>Invia al BACK OFFICE</strong> sulla riga: se Luce e Gas
          sono stati creati insieme, partono entrambi in un&apos;unica email (non serve rifare il
          contratto).
        </p>
        {msg ? (
          <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</p>
        ) : null}
        {err ? (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
        ) : null}
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nessun contratto ancora.{" "}
            <Link href={`/contratti/nuovo?clientId=${client.id}`} className="text-emerald-700 underline">
              Creane uno
            </Link>
          </p>
        ) : (
          <>
            {/* Mobile: card tocco-friendly */}
            <div className="grid gap-2 sm:hidden">
              {contracts.map((c) => {
                const u = resolveUtilityDisplay(c);
                const active = c.id === selectedId;
                const siblings = siblingContractIds(c.id);
                const busy = pending && sendingEmailId === c.id;
                return (
                  <div
                    key={c.id}
                    className={
                      active
                        ? "rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3"
                        : "rounded-xl border border-slate-200 bg-white p-3"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => selectContract(c.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{c.contractNumber}</p>
                          <p className="text-xs text-slate-500">{c.insertionDate}</p>
                        </div>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="mt-1 text-sm text-slate-800">
                        {u.serviceLabel}
                        {c.operationType ? ` · ${c.operationType}` : ""}
                      </p>
                      <p className="text-xs text-slate-600">
                        {c.supplierName} · {c.collaboratorName}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-700">
                        Gettone € {c.gettone}
                        {c.commissionConfirmed ? " · confermato" : " · da confermare"}
                      </p>
                      {c.emailStatus ? (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Email: {c.emailStatus}
                          {siblings.length > 1 ? ` · gruppo ${siblings.length} contratti` : ""}
                        </p>
                      ) : null}
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? "primary" : "secondary"}
                        onClick={() => selectContract(c.id)}
                      >
                        {active ? "Selezionato" : "Apri"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-emerald-700 text-white hover:bg-emerald-800"
                        disabled={pending}
                        onClick={() => sendBackofficeEmail(c.id)}
                      >
                        {busy
                          ? "Invio…"
                          : siblings.length > 1
                            ? `Invia al BACK OFFICE (${siblings.length})`
                            : "Invia al BACK OFFICE"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: tabella */}
            <div className="hidden overflow-x-auto sm:block">
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
                    <th className="px-2 py-2">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => {
                    const u = resolveUtilityDisplay(c);
                    const active = c.id === selectedId;
                    const siblings = siblingContractIds(c.id);
                    const busy = pending && sendingEmailId === c.id;
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
                          {c.emailStatus ? (
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              Email: {c.emailStatus}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <div>€ {c.gettone}</div>
                          <div
                            className={
                              c.commissionConfirmed
                                ? "text-[10px] font-medium text-emerald-700"
                                : "text-[10px] font-medium text-amber-800"
                            }
                          >
                            {c.commissionConfirmed ? "Confermata" : "Da confermare"}
                          </div>
                          {c.stornoLabel ? (
                            <div className="text-[10px] text-slate-600">{c.stornoLabel}</div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant={active ? "primary" : "secondary"}
                              onClick={() => selectContract(c.id)}
                            >
                              {active ? "Selezionato" : "Apri"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="bg-emerald-700 text-white hover:bg-emerald-800"
                              disabled={pending}
                              title={
                                siblings.length > 1
                                  ? `Invia email unica per ${siblings.length} contratti collegati`
                                  : "Invia email al back office"
                              }
                              onClick={() => sendBackofficeEmail(c.id)}
                            >
                              {busy
                                ? "Invio…"
                                : siblings.length > 1
                                  ? `Invia BO (${siblings.length})`
                                  : "Invia al BACK OFFICE"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {selected && canEditSelected ? (
        <>
          <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
            <div className="mb-1">
              <h2 className="font-semibold text-slate-900">
                Scheda contratto · {selected.contractNumber}
              </h2>
              <p className="text-xs text-slate-500">
                Tre blocchi: Operazione · Fornitura · Fornitore (come in Nuovo contratto)
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected.warnOnEdit) {
                  const ok = window.confirm(
                    "Attenzione: questo contratto NON è fuori storno " +
                      `(${selected.stornoLabel ?? "in storno"}).\n\n` +
                      "Confermi di voler salvare comunque?",
                  );
                  if (!ok) return;
                }
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
                fd.set("supplierId", offerSupplierId);
                setErr(null);
                setMsg(null);
                start(async () => {
                  try {
                    const res = await updateClientContractBlockAction(fd);
                    if (!res.ok) {
                      setErr(res.error);
                      return;
                    }
                    setBlock2Dirty(false);
                    setMsg("Fornitura e operazione salvate");
                    router.refresh();
                  } catch (error) {
                    setErr(error instanceof Error ? error.message : "Errore salvataggio");
                  }
                });
              }}
              onInput={mark2}
              onChange={mark2}
            >
              <input type="hidden" name="contractId" value={selected.id} />
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="supplierId" value={offerSupplierId} />

              {/* 1 Operazione */}
              <div className="space-y-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-xs font-bold text-white">
                    1
                  </span>
                  <h3 className="font-semibold text-slate-900">Operazione</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <Field label="Servizio contratto">
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
                </div>
                {operationType === "ALTRO" ? (
                  <Field label="Specifica operazione *">
                    <Input name="operationOther" defaultValue={selected.operationOther ?? ""} required />
                  </Field>
                ) : null}
                {utilityType === "ALTRO" ? (
                  <Field label="Specifica servizio *">
                    <Input name="serviceOther" defaultValue={selected.serviceOther ?? ""} required />
                  </Field>
                ) : null}
                <Field label="Metodo di pagamento">
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
                    {PAYMENT_METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {needsIban ? (
                  <div className="space-y-3 rounded-lg border border-sky-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">IBAN per addebito</p>
                      {client.iban ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-emerald-700 underline"
                          onClick={() => {
                            setContractIban(client.iban ?? "");
                            mark2();
                          }}
                        >
                          Copia da anagrafica
                        </button>
                      ) : (
                        <span className="text-xs text-amber-700">Nessun IBAN in anagrafica</span>
                      )}
                    </div>
                    <Field label="IBAN contratto *">
                      <Input
                        value={contractIban}
                        onChange={(e) => {
                          setContractIban(e.target.value);
                          mark2();
                        }}
                        required
                        className="font-mono text-base tracking-wide"
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Intestatario conto">
                        <Input name="ibanHolder" defaultValue={selected.ibanHolder ?? ""} />
                      </Field>
                      <Field label="CF intestatario">
                        <Input name="ibanHolderCf" defaultValue={selected.ibanHolderCf ?? ""} />
                      </Field>
                    </div>
                  </div>
                ) : (
                  <Field label="Note pagamento">
                    <Input name="paymentNotes" defaultValue={selected.paymentNotes ?? ""} />
                  </Field>
                )}
              </div>

              {/* 2 Fornitura */}
              <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white">
                    2
                  </span>
                  <h3 className="font-semibold text-slate-900">Fornitura</h3>
                </div>
                <p className="text-sm font-medium text-slate-800">Indirizzo di fornitura</p>
                <label className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-white p-3 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
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
                  <span>
                    <strong>Coincide con anagrafica</strong>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Usa lo stesso indirizzo di residenza / sede legale
                    </span>
                  </span>
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
                    Indirizzo fornitura = anagrafica (copiato al salvataggio).
                  </p>
                )}
                <input type="hidden" name="supplyCountry" value="Italia" />

                {(utilityType === "LUCE" || utilityType === "DUAL") && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="POD">
                      <Input
                        name="pod"
                        defaultValue={selected.pod ?? selected.podPdr ?? ""}
                        className="font-mono uppercase"
                      />
                    </Field>
                    <Field label="Potenza contatore (kW)">
                      <Input name="powerKw" inputMode="decimal" defaultValue={selected.powerKw ?? ""} />
                    </Field>
                    <Field label="kWh annui consumati">
                      <Input name="annualKwh" inputMode="decimal" defaultValue={selected.annualKwh ?? ""} />
                    </Field>
                  </div>
                )}
                {(utilityType === "GAS" || utilityType === "DUAL") && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="PDR">
                      <Input name="pdr" defaultValue={selected.pdr ?? ""} className="font-mono uppercase" />
                    </Field>
                    <Field label="Smc / mc annui consumati">
                      <Input name="annualSmc" inputMode="decimal" defaultValue={selected.annualSmc ?? ""} />
                    </Field>
                  </div>
                )}
                {!isEnergy ? (
                  <Field label="POD / PDR / Codice migrazione">
                    <Input
                      name="podPdr"
                      defaultValue={selected.podPdr ?? selected.pod ?? selected.pdr ?? ""}
                      className="font-mono"
                    />
                  </Field>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Classificazione fornitura">
                    <Select
                      name="supplyClassification"
                      defaultValue={
                        selected.supplyClassification ??
                        (clientType === "AZIENDA" && utilityType !== "GAS" ? "ALTRI_USI" : "")
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
                  <Field label="Data ingresso in fornitura">
                    <Input
                      type="date"
                      name="supplyStartDate"
                      defaultValue={selected.supplyStartDate ?? ""}
                    />
                  </Field>
                </div>
                <Field label="Note contratto">
                  <Textarea name="notes" rows={2} defaultValue={selected.notes ?? ""} />
                </Field>
              </div>

              <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                {pending && block2Dirty ? "Salvataggio…" : "Salva fornitura e operazione"}
              </Button>
            </form>

            {/* 3 Fornitore + condizioni */}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected.warnOnEdit) {
                  const ok = window.confirm(
                    "Attenzione: questo contratto NON è fuori storno " +
                      `(${selected.stornoLabel ?? "in storno"}).\n\n` +
                      "Confermi di voler salvare comunque?",
                  );
                  if (!ok) return;
                }
                const fd = new FormData(e.currentTarget);
                fd.set("status", status);
                fd.set("priceType", priceType);
                fd.set("supplierId", offerSupplierId);
                setErr(null);
                setMsg(null);
                start(async () => {
                  try {
                    const res = await updateClientOfferBlockAction(fd);
                    if (!res.ok) {
                      setErr(res.error);
                      return;
                    }
                    setBlock3Dirty(false);
                    setMsg("Fornitore e condizioni salvati");
                    router.refresh();
                  } catch (error) {
                    setErr(error instanceof Error ? error.message : "Errore salvataggio");
                  }
                });
              }}
              onInput={mark3}
              onChange={mark3}
            >
              <input type="hidden" name="contractId" value={selected.id} />
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="supplierId" value={offerSupplierId} />

              <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-xs font-bold text-white">
                    3
                  </span>
                  <h3 className="font-semibold text-slate-900">Fornitore e condizioni</h3>
                </div>

                <Field label="Fornitore">
                  <Select
                    name="supplierIdSelect"
                    value={offerSupplierId}
                    onChange={(e) => {
                      setOfferSupplierId(e.target.value);
                      setCommissionRuleId("");
                      setProductName("");
                      setOfferCode("");
                      mark3();
                    }}
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </Select>
                </Field>

                {rulesForSupplier.length > 0 ? (
                  <Field label="Offerta da listino">
                    <Select
                      name="commissionRuleId"
                      value={commissionRuleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setCommissionRuleId(id);
                        if (!id) {
                          mark3();
                          return;
                        }
                        const rule = listinoRules.find((r) => r.id === id);
                        if (rule) {
                          setProductName(rule.name);
                          setOfferCode(rule.name);
                          if (canEditSelectedGettone && rule.gettoneTotale) {
                            setGettoneValue(rule.gettoneTotale);
                          }
                          if (rule.hasRid) {
                            setPaymentMethod("RID");
                            if (!contractIban && client.iban) setContractIban(client.iban);
                            mark2();
                          } else if (!paymentMethod) {
                            setPaymentMethod("BOLLETTINO");
                            mark2();
                          }
                          setPriceType((prev) => prev || "FISSO");
                        }
                        mark3();
                      }}
                    >
                      <option value="">— scegli oppure compilazione manuale —</option>
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
                  <>
                    <input type="hidden" name="commissionRuleId" value="" />
                    <p className="text-xs text-slate-500">
                      Nessuna offerta in listino: inserisci il nome a mano.
                    </p>
                  </>
                )}

                <Field label="Nome offerta">
                  <Input
                    name="productName"
                    value={productName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setProductName(name);
                      const match = rulesForSupplier.find(
                        (r) => r.name.toLowerCase() === name.trim().toLowerCase(),
                      );
                      if (match) {
                        setCommissionRuleId(match.id);
                        setOfferCode(match.name);
                        if (canEditSelectedGettone && match.gettoneTotale) {
                          setGettoneValue(match.gettoneTotale);
                        }
                        if (match.hasRid) {
                          setPaymentMethod("RID");
                          if (!contractIban && client.iban) setContractIban(client.iban);
                          mark2();
                        }
                      }
                      mark3();
                    }}
                  />
                </Field>
                <Field label="Codice offerta (facoltativo)">
                  <Input
                    name="offerCode"
                    value={offerCode}
                    onChange={(e) => {
                      setOfferCode(e.target.value);
                      mark3();
                    }}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Prezzo fisso o variabile">
                    <Select
                      value={priceType}
                      onChange={(e) => {
                        setPriceType(e.target.value);
                        mark3();
                      }}
                    >
                      <option value="">—</option>
                      <option value="FISSO">Fisso</option>
                      <option value="VARIABILE">Variabile</option>
                      <option value="INDICIZZATO">Indicizzato</option>
                    </Select>
                  </Field>
                  <Field label="PCV mese (€)">
                    <Input name="pcv" inputMode="decimal" defaultValue={selected.pcv ?? ""} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Prezzo al kWh (€)">
                    <Input name="pricePerKwh" inputMode="decimal" defaultValue={selected.pricePerKwh ?? ""} />
                  </Field>
                  <Field label="Prezzo al mc / Smc (€)">
                    <Input name="pricePerSmc" inputMode="decimal" defaultValue={selected.pricePerSmc ?? ""} />
                  </Field>
                  <Field label="Quota fissa mensile">
                    <Input name="monthlyFee" inputMode="decimal" defaultValue={selected.monthlyFee ?? ""} />
                  </Field>
                  <Field label="Spread (se variabile)">
                    <Input name="spread" inputMode="decimal" defaultValue={selected.spread ?? ""} />
                  </Field>
                </div>

                <Field label="Note">
                  <Textarea
                    name="economicNotes"
                    rows={3}
                    defaultValue={selected.economicNotes ?? ""}
                    placeholder="Note per Master / collaboratore"
                  />
                </Field>
                <Field label="Valore gettone (€) — indicativo">
                  <Input
                    name="gettone"
                    value={gettoneValue}
                    onChange={(e) => {
                      setGettoneValue(e.target.value);
                      mark3();
                    }}
                    inputMode="decimal"
                    disabled={!canEditSelectedGettone}
                    className="text-lg font-semibold"
                  />
                  <p
                    className={
                      selected.commissionConfirmed
                        ? "mt-1 text-xs font-medium text-emerald-700"
                        : "mt-1 text-xs font-medium text-amber-800"
                    }
                  >
                    {selected.commissionConfirmed
                      ? "Gettone confermato dal Master / Admin"
                      : "Da confermare dal Master (indicativo collaboratore)"}
                  </p>
                </Field>

                <Field label="Stato pratica">
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
                {(["KO", "ANNULLATO", "CHIUSO"].includes(status)) && (
                  <>
                    <Field label="Data chiusura *">
                      <Input name="closureDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
                    </Field>
                    <Field label={status === "KO" ? "Motivo KO *" : status === "CHIUSO" ? "Motivo chiusura *" : "Motivo annullamento *"}>
                      <Input name="koReason" defaultValue={selected.koReason ?? ""} required />
                    </Field>
                    <Field label="Note">
                      <Textarea name="koNotes" rows={2} defaultValue={selected.koNotes ?? ""} />
                    </Field>
                  </>
                )}
                {status === "DOCUMENTAZIONE_INCOMPLETA" ? (
                  <Field label="Cosa manca (integrazione)">
                    <Textarea
                      name="koNotes"
                      rows={2}
                      defaultValue={selected.koNotes ?? ""}
                      placeholder="Dati o documenti da integrare"
                    />
                  </Field>
                ) : null}

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
              </div>

              <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                {pending && block3Dirty ? "Salvataggio…" : "Salva fornitore e condizioni"}
              </Button>
            </form>

            {/* Barra azioni in fondo: reinvio email Master + back office fornitore */}
            <div className="mt-6 space-y-3 rounded-2xl border-4 border-emerald-600 bg-emerald-50 p-4 shadow-md sm:p-5">
              <h3 className="text-lg font-black uppercase tracking-wide text-emerald-950">
                Reinvia email al BACK OFFICE
              </h3>
              <p className="text-sm text-emerald-900">
                Invia di nuovo l&apos;email completa (anagrafica + blocchi servizio + allegati) a{" "}
                <strong>Master</strong> e ai <strong>back office</strong> del fornitore (stesse
                regole di sempre: Enel → Giuseppe + Stefania, Edison → Mada, ecc.).
                {siblingContractIds(selected.id).length > 1
                  ? ` Verranno inclusi anche i ${siblingContractIds(selected.id).length} contratti collegati (es. Luce + Gas).`
                  : ""}
              </p>
              {msg ? (
                <p className="rounded-lg bg-white px-3 py-2 text-sm text-emerald-800">{msg}</p>
              ) : null}
              {err ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="min-h-14 w-full bg-emerald-700 text-base font-bold uppercase tracking-wide text-white hover:bg-emerald-800 sm:w-auto sm:min-w-[16rem]"
                disabled={pending}
                onClick={() => sendBackofficeEmail(selected.id)}
              >
                {pending && sendingEmailId === selected.id
                  ? "Invio in corso…"
                  : siblingContractIds(selected.id).length > 1
                    ? `Reinvia email (${siblingContractIds(selected.id).length} contratti)`
                    : "Reinvia email al BACK OFFICE"}
              </Button>
            </div>
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
