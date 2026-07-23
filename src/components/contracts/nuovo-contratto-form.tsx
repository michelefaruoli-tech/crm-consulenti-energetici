"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AutocompleteSearch } from "@/components/contracts/autocomplete-search";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createFullContractAction } from "@/lib/contract-create-action";
import {
  DOC_TYPE_OPTIONS,
  OPERATION_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SERVICE_OPTIONS,
} from "@/lib/constants";
import { calcExpiryDate, type ContractServiceLine, type NewContractPayload } from "@/lib/contract-form-types";
import { format } from "date-fns";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type Props = {
  session: { id: string; name: string; role: string };
  collaborators: { id: string; name: string }[];
  canPickCollaborator: boolean;
  initialClientId?: string;
};

export function NuovoContrattoForm({
  session,
  collaborators,
  canPickCollaborator,
  initialClientId,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [sendToMaster, setSendToMaster] = useState(false);
  const [collaboratorId, setCollaboratorId] = useState(session.id);
  const [clientId, setClientId] = useState<string | undefined>(initialClientId);
  const [clientLabel, setClientLabel] = useState<string | undefined>();
  const [creatingClient, setCreatingClient] = useState(!initialClientId);
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierLabel, setSupplierLabel] = useState<string | undefined>();
  const [supplierName, setSupplierName] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const [clientType, setClientType] = useState<"PRIVATO" | "AZIENDA">("PRIVATO");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fiscalCode, setFiscalCode] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pec, setPec] = useState("");
  const [iban, setIban] = useState("");
  const [street, setStreet] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [region, setRegion] = useState("");
  const [legalFirstName, setLegalFirstName] = useState("");
  const [legalLastName, setLegalLastName] = useState("");
  const [legalFiscalCode, setLegalFiscalCode] = useState("");
  const [sdiCode, setSdiCode] = useState("");
  const [classification, setClassification] = useState("");

  const [operationType, setOperationType] = useState("SWITCH");
  const [operationOther, setOperationOther] = useState("");
  const [supplySame, setSupplySame] = useState(true);
  const [supplyStreet, setSupplyStreet] = useState("");
  const [supplyStreetNumber, setSupplyStreetNumber] = useState("");
  const [supplyZip, setSupplyZip] = useState("");
  const [supplyCity, setSupplyCity] = useState("");
  const [supplyProvince, setSupplyProvince] = useState("");
  const [supplyRegion, setSupplyRegion] = useState("");
  const [supplyClassification, setSupplyClassification] = useState("");
  const [supplyStartDate, setSupplyStartDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [durationMonths, setDurationMonths] = useState(12);

  const [productName, setProductName] = useState("");
  const [offerCode, setOfferCode] = useState("");
  const [contractKind, setContractKind] = useState("Mercato libero");
  const [priceType, setPriceType] = useState("Fisso");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [ibanHolder, setIbanHolder] = useState("");
  const [pricePerKwh, setPricePerKwh] = useState("");
  const [pricePerSmc, setPricePerSmc] = useState("");
  const [pcv, setPcv] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("");
  const [notes, setNotes] = useState("");
  const [masterNotes, setMasterNotes] = useState("");

  const [services, setServices] = useState<ContractServiceLine[]>([
    { id: uid(), service: "LUCE", pod: "" },
  ]);
  const [attachments, setAttachments] = useState<
    {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      docType: string;
      contentBase64: string;
    }[]
  >([]);

  const expiryPreview = useMemo(() => {
    try {
      return format(calcExpiryDate(new Date(supplyStartDate), durationMonths), "dd/MM/yyyy");
    } catch {
      return "—";
    }
  }, [supplyStartDate, durationMonths]);

  useEffect(() => {
    if (zipCode.replace(/\D/g, "").length !== 5) return;
    void fetch(`/api/cap/${zipCode.replace(/\D/g, "")}`)
      .then((r) => r.json())
      .then((d: { found?: boolean; city?: string; province?: string; region?: string }) => {
        if (!d.found) return;
        if (d.city) setCity(d.city);
        if (d.province) setProvince(d.province);
        if (d.region) setRegion(d.region);
      })
      .catch(() => undefined);
  }, [zipCode]);

  useEffect(() => {
    if (supplySame || supplyZip.replace(/\D/g, "").length !== 5) return;
    void fetch(`/api/cap/${supplyZip.replace(/\D/g, "")}`)
      .then((r) => r.json())
      .then((d: { found?: boolean; city?: string; province?: string; region?: string }) => {
        if (!d.found) return;
        if (d.city) setSupplyCity(d.city);
        if (d.province) setSupplyProvince(d.province);
        if (d.region) setSupplyRegion(d.region);
      })
      .catch(() => undefined);
  }, [supplyZip, supplySame]);

  function buildPayload(draft: boolean): NewContractPayload {
    return {
      draft,
      sendToMaster,
      collaboratorId,
      clientId,
      client: {
        type: clientType,
        firstName,
        lastName,
        companyName,
        fiscalCode,
        vatNumber,
        phone,
        email,
        pec,
        iban,
        street,
        streetNumber,
        zipCode,
        city,
        province,
        region,
        legalFirstName,
        legalLastName,
        legalFiscalCode,
        sdiCode,
        classification,
      },
      supplierId,
      supplierName: creatingSupplier ? supplierName : supplierLabel,
      operationType,
      operationOther,
      supplySameAsResidence: supplySame,
      supplyStreet,
      supplyStreetNumber,
      supplyZipCode: supplyZip,
      supplyCity,
      supplyProvince,
      supplyRegion,
      supplyClassification,
      supplyStartDate,
      durationMonths,
      productName,
      offerCode,
      contractKind,
      priceType,
      paymentMethod,
      ibanHolder,
      pricePerKwh,
      pricePerSmc,
      pcv,
      monthlyFee,
      notes,
      masterNotes,
      services,
      attachments,
    };
  }

  function submit(draft: boolean) {
    setErrors([]);
    setMessage(null);
    if (sendToMaster && !draft) {
      if (!confirm("Confermi creazione e invio al Master (michele.faruoli@gmail.com)?")) {
        return;
      }
    }
    startTransition(async () => {
      const result = await createFullContractAction(buildPayload(draft));
      if (!result.ok) {
        setErrors(result.errors ?? ["Errore di salvataggio"]);
        return;
      }
      setMessage(
        [result.message, result.emailError].filter(Boolean).join(" — ") || "Salvato",
      );
      if (result.contractIds?.[0]) {
        router.push(`/contratti/${result.contractIds[0]}`);
        router.refresh();
      }
    });
  }

  async function onFilesSelected(files: FileList | null, docType: string) {
    if (!files?.length) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (!["application/pdf", "image/jpeg", "image/png", "image/jpg"].includes(file.type)) {
        setErrors((e) => [...e, `Formato non supportato: ${file.name}`]);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setErrors((e) => [...e, `File troppo grande (max 8MB): ${file.name}`]);
        continue;
      }
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      next.push({
        id: uid(),
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        docType,
        contentBase64,
      });
    }
    setAttachments(next);
  }

  const hasLuce = services.some((s) => s.service === "LUCE");
  const hasGas = services.some((s) => s.service === "GAS");

  return (
    <div className="space-y-6">
      {/* 1. Opzioni */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Opzioni e stato</h2>
            <p className="text-sm text-slate-500">Salva in gestionale oppure invia al Master</p>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={sendToMaster}
              onChange={(e) => setSendToMaster(e.target.checked)}
            />
            <span className="text-sm font-semibold text-emerald-900">
              Invia al Master per la lavorazione
            </span>
          </label>
        </div>
        {canPickCollaborator ? (
          <div className="mt-4 max-w-md">
            <Field label="Collaboratore">
              <Select
                value={collaboratorId}
                onChange={(e) => setCollaboratorId(e.target.value)}
              >
                {collaborators.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Collaboratore: <strong>{session.name}</strong> (assegnato automaticamente)
          </p>
        )}
      </section>

      {/* 2-3 Cliente */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Dati cliente</h2>
        <AutocompleteSearch
          label="Cliente"
          required
          placeholder="Cerca nome, cognome, ragione sociale, CF, P.IVA..."
          endpoint="/api/clients/search"
          selectedLabel={clientLabel}
          createLabel="+ Crea nuovo cliente"
          onClear={() => {
            setClientId(undefined);
            setClientLabel(undefined);
            setCreatingClient(true);
          }}
          onSelect={(item) => {
            setClientId(item.id);
            setClientLabel(String(item.label));
            setCreatingClient(false);
            setClientType(item.type === "AZIENDA" ? "AZIENDA" : "PRIVATO");
            setFirstName(String(item.firstName ?? ""));
            setLastName(String(item.lastName ?? ""));
            setCompanyName(String(item.companyName ?? ""));
            setFiscalCode(String(item.fiscalCode ?? ""));
            setVatNumber(String(item.vatNumber ?? ""));
            setPhone(String(item.phone ?? ""));
            setEmail(String(item.email ?? ""));
            setPec(String(item.pec ?? ""));
            setIban(String(item.iban ?? ""));
            setStreet(String(item.street ?? ""));
            setStreetNumber(String(item.streetNumber ?? ""));
            setZipCode(String(item.zipCode ?? ""));
            setCity(String(item.city ?? ""));
            setProvince(String(item.province ?? ""));
            setRegion(String(item.region ?? ""));
            setLegalFirstName(String(item.legalFirstName ?? ""));
            setLegalLastName(String(item.legalLastName ?? ""));
            setLegalFiscalCode(String(item.legalFiscalCode ?? ""));
            setSdiCode(String(item.sdiCode ?? ""));
            setClassification(String(item.classification ?? ""));
          }}
          onCreate={(q) => {
            setClientId(undefined);
            setClientLabel(undefined);
            setCreatingClient(true);
            if (q.includes(" ")) {
              const [a, ...rest] = q.split(" ");
              setLastName(a);
              setFirstName(rest.join(" "));
            } else {
              setLastName(q);
            }
          }}
        />

        <Field label="Tipologia cliente">
          <Select
            value={clientType}
            onChange={(e) => setClientType(e.target.value as "PRIVATO" | "AZIENDA")}
          >
            <option value="PRIVATO">Privato</option>
            <option value="AZIENDA">Business</option>
          </Select>
        </Field>

        {clientType === "PRIVATO" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome *"><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
            <Field label="Cognome *"><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
            <Field label="Codice fiscale"><Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} /></Field>
            <Field label="Telefono"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="PEC (facoltativa)"><Input value={pec} onChange={(e) => setPec(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ragione sociale *"><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
            <Field label="Partita IVA *"><Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} /></Field>
            <Field label="CF aziendale"><Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} /></Field>
            <Field label="Telefono"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="PEC (facoltativa)"><Input value={pec} onChange={(e) => setPec(e.target.value)} /></Field>
            <Field label="Nome rappresentante"><Input value={legalFirstName} onChange={(e) => setLegalFirstName(e.target.value)} /></Field>
            <Field label="Cognome rappresentante"><Input value={legalLastName} onChange={(e) => setLegalLastName(e.target.value)} /></Field>
            <Field label="CF rappresentante"><Input value={legalFiscalCode} onChange={(e) => setLegalFiscalCode(e.target.value)} /></Field>
            <Field label="Codice SDI (facoltativo)"><Input value={sdiCode} onChange={(e) => setSdiCode(e.target.value)} /></Field>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-6">
          <Field label="CAP *"><Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} /></Field>
          <Field label="Comune"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="Provincia"><Input value={province} onChange={(e) => setProvince(e.target.value)} /></Field>
          <Field label="Regione"><Input value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
          <Field label="Via/Piazza"><Input value={street} onChange={(e) => setStreet(e.target.value)} /></Field>
          <Field label="Civico"><Input value={streetNumber} onChange={(e) => setStreetNumber(e.target.value)} /></Field>
        </div>
        <Field label="IBAN">
          <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IT60X..." />
        </Field>
        {creatingClient ? (
          <p className="text-xs text-emerald-700">Il nuovo cliente sarà salvato in anagrafica al salvataggio del contratto.</p>
        ) : null}
      </section>

      {/* 4 Operazione + servizi */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Dati dell&apos;operazione</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipo operazione *">
            <Select value={operationType} onChange={(e) => setOperationType(e.target.value)}>
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          {operationType === "ALTRO" ? (
            <Field label="Specifica operazione *">
              <Input value={operationOther} onChange={(e) => setOperationOther(e.target.value)} />
            </Field>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-800">Servizi / punti fornitura</h3>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setServices((s) => [...s, { id: uid(), service: "GAS", pdr: "" }])
              }
            >
              + Aggiungi servizio (nuovo contratto)
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Multi POD/PDR: ogni riga crea un contratto collegato, senza ripetere i dati cliente.
          </p>
          {services.map((line, idx) => (
            <div key={line.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Servizio #{idx + 1}</span>
                {services.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() => setServices((s) => s.filter((x) => x.id !== line.id))}
                  >
                    Rimuovi
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Field label="Servizio">
                  <Select
                    value={line.service}
                    onChange={(e) =>
                      setServices((all) =>
                        all.map((x) =>
                          x.id === line.id ? { ...x, service: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {SERVICE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </Field>
                {line.service === "LUCE" ? (
                  <Field label="POD *">
                    <Input
                      value={line.pod ?? ""}
                      onChange={(e) =>
                        setServices((all) =>
                          all.map((x) =>
                            x.id === line.id ? { ...x, pod: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
                {line.service === "GAS" ? (
                  <Field label="PDR *">
                    <Input
                      value={line.pdr ?? ""}
                      onChange={(e) =>
                        setServices((all) =>
                          all.map((x) =>
                            x.id === line.id ? { ...x, pdr: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
                {line.service === "ALTRO" ? (
                  <Field label="Specifica servizio">
                    <Input
                      value={line.serviceOther ?? ""}
                      onChange={(e) =>
                        setServices((all) =>
                          all.map((x) =>
                            x.id === line.id ? { ...x, serviceOther: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
                {line.service === "LUCE" ? (
                  <>
                    <Field label="Consumo annuo kWh">
                      <Input
                        value={line.annualKwh ?? ""}
                        onChange={(e) =>
                          setServices((all) =>
                            all.map((x) =>
                              x.id === line.id ? { ...x, annualKwh: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Potenza kW">
                      <Input
                        value={line.powerKw ?? ""}
                        onChange={(e) =>
                          setServices((all) =>
                            all.map((x) =>
                              x.id === line.id ? { ...x, powerKw: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                  </>
                ) : null}
                {line.service === "GAS" ? (
                  <Field label="Consumo annuo Smc">
                    <Input
                      value={line.annualSmc ?? ""}
                      onChange={(e) =>
                        setServices((all) =>
                          all.map((x) =>
                            x.id === line.id ? { ...x, annualSmc: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
                {!["LUCE", "GAS"].includes(line.service) ? (
                  <Field label="Identificativo / note tecniche">
                    <Input
                      value={line.techNotes ?? ""}
                      onChange={(e) =>
                        setServices((all) =>
                          all.map((x) =>
                            x.id === line.id ? { ...x, techNotes: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Fornitore + condizioni */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Fornitore e contratto</h2>
        <AutocompleteSearch
          label="Fornitore"
          required
          placeholder="Cerca fornitore..."
          endpoint="/api/suppliers/search"
          selectedLabel={creatingSupplier ? undefined : supplierLabel}
          createLabel="+ Registra nuovo fornitore"
          onClear={() => {
            setSupplierId(undefined);
            setSupplierLabel(undefined);
            setCreatingSupplier(false);
            setSupplierName("");
          }}
          onSelect={(item) => {
            setSupplierId(item.id);
            setSupplierLabel(String(item.label));
            setCreatingSupplier(false);
            setSupplierName("");
          }}
          onCreate={(q) => {
            setCreatingSupplier(true);
            setSupplierId(undefined);
            setSupplierLabel(undefined);
            setSupplierName(q);
          }}
        />
        {creatingSupplier ? (
          <Field label="Nome nuovo fornitore *">
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </Field>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nome offerta"><Input value={productName} onChange={(e) => setProductName(e.target.value)} /></Field>
          <Field label="Codice offerta"><Input value={offerCode} onChange={(e) => setOfferCode(e.target.value)} /></Field>
          <Field label="Tipo contratto">
            <Select value={contractKind} onChange={(e) => setContractKind(e.target.value)}>
              <option>Mercato libero</option>
              <option>Tutela / servizio regolato</option>
              <option>Residenziale</option>
              <option>Business</option>
              <option>Dual</option>
              <option>Altro</option>
            </Select>
          </Field>
          <Field label="Tipo prezzo">
            <Select value={priceType} onChange={(e) => setPriceType(e.target.value)}>
              <option>Fisso</option>
              <option>Variabile</option>
              <option>Indicizzato</option>
              <option>Altro</option>
            </Select>
          </Field>
          <Field label="Data ingresso fornitura *">
            <Input type="date" value={supplyStartDate} onChange={(e) => setSupplyStartDate(e.target.value)} />
          </Field>
          <Field label="Durata (mesi)">
            <Input
              type="number"
              min={1}
              value={durationMonths}
              onChange={(e) => setDurationMonths(Number(e.target.value) || 12)}
            />
          </Field>
          <Field label="Data scadenza (auto)">
            <Input value={expiryPreview} readOnly className="bg-slate-50" />
          </Field>
        </div>
      </section>

      {/* Indirizzo fornitura */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Indirizzo di fornitura</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={supplySame} onChange={(e) => setSupplySame(e.target.checked)} />
          L&apos;indirizzo di fornitura coincide con residenza / sede legale
        </label>
        {!supplySame ? (
          <div className="grid gap-3 md:grid-cols-6">
            <Field label="CAP"><Input value={supplyZip} onChange={(e) => setSupplyZip(e.target.value)} /></Field>
            <Field label="Comune"><Input value={supplyCity} onChange={(e) => setSupplyCity(e.target.value)} /></Field>
            <Field label="Provincia"><Input value={supplyProvince} onChange={(e) => setSupplyProvince(e.target.value)} /></Field>
            <Field label="Regione"><Input value={supplyRegion} onChange={(e) => setSupplyRegion(e.target.value)} /></Field>
            <Field label="Via"><Input value={supplyStreet} onChange={(e) => setSupplyStreet(e.target.value)} /></Field>
            <Field label="Civico"><Input value={supplyStreetNumber} onChange={(e) => setSupplyStreetNumber(e.target.value)} /></Field>
          </div>
        ) : null}
        <Field label="Classificazione fornitura">
          <Select value={supplyClassification} onChange={(e) => setSupplyClassification(e.target.value)}>
            <option value="">Seleziona</option>
            {clientType === "PRIVATO" ? (
              <>
                <option value="Residente">Residente</option>
                <option value="Non residente">Non residente</option>
                <option value="Altri usi">Altri usi</option>
              </>
            ) : (
              <>
                <option value="Business">Business</option>
                <option value="Altri usi">Altri usi</option>
                <option value="Condominio">Condominio</option>
                <option value="PA">Pubblica amministrazione</option>
                <option value="Altro">Altro</option>
              </>
            )}
          </Select>
        </Field>
      </section>

      {/* Economiche + pagamento */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Condizioni economiche e pagamento</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {hasLuce ? (
            <Field label="Prezzo energia €/kWh"><Input value={pricePerKwh} onChange={(e) => setPricePerKwh(e.target.value)} /></Field>
          ) : null}
          {hasGas ? (
            <Field label="Prezzo gas €/Smc"><Input value={pricePerSmc} onChange={(e) => setPricePerSmc(e.target.value)} /></Field>
          ) : null}
          <Field label="PCV €/mese"><Input value={pcv} onChange={(e) => setPcv(e.target.value)} /></Field>
          <Field label="Canone mensile €"><Input value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} /></Field>
          <Field label="Metodo di pagamento">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">Seleziona</option>
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          {paymentMethod === "RID" ? (
            <Field label="Intestatario IBAN (se diverso)">
              <Input value={ibanHolder} onChange={(e) => setIbanHolder(e.target.value)} />
            </Field>
          ) : null}
        </div>
      </section>

      {/* Allegati */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Allegati</h2>
        {sendToMaster ? (
          <p className="text-xs text-amber-800">
            Con invio al Master sono obbligatori: documento di identità e bolletta/fattura.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {DOC_TYPE_OPTIONS.map((doc) => (
            <div key={doc.value} className="rounded-lg border border-dashed border-slate-300 p-3">
              <p className="mb-2 text-sm font-medium">{doc.label}</p>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                onChange={(e) => void onFilesSelected(e.target.files, doc.value)}
              />
            </div>
          ))}
        </div>
        {attachments.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
                <span>
                  {a.filename} · {DOC_TYPE_OPTIONS.find((d) => d.value === a.docType)?.label}
                </span>
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => setAttachments((all) => all.filter((x) => x.id !== a.id))}
                >
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Note + riepilogo */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Note e conferma</h2>
        <Field label="Note interne"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Note da inviare al Master">
          <Textarea rows={3} value={masterNotes} onChange={(e) => setMasterNotes(e.target.value)} />
        </Field>
        <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
          <p><strong>Cliente:</strong> {clientLabel || `${firstName} ${lastName} ${companyName}`.trim() || "—"}</p>
          <p><strong>Collaboratore:</strong> {collaborators.find((c) => c.id === collaboratorId)?.name ?? session.name}</p>
          <p><strong>Servizi:</strong> {services.map((s) => s.service).join(", ")}</p>
          <p><strong>Fornitore:</strong> {supplierLabel || supplierName || "—"}</p>
          <p><strong>Scadenza:</strong> {expiryPreview} ({durationMonths} mesi)</p>
          <p><strong>Invia al Master:</strong> {sendToMaster ? "Sì" : "No"}</p>
          <p><strong>Allegati:</strong> {attachments.length}</p>
        </div>

        {errors.length > 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold">Correggi questi errori:</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {message}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => submit(true)}>
            Salva come bozza
          </Button>
          <Button type="button" disabled={pending} onClick={() => submit(false)}>
            {sendToMaster ? "Crea e invia al Master" : "Crea contratto"}
          </Button>
        </div>
      </section>
    </div>
  );
}
