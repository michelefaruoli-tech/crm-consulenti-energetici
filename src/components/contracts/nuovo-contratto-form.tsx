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
import {
  calcExpiryDate,
  type ContractServiceLine,
  type NewContractPayload,
} from "@/lib/contract-form-types";
import { computeSupplyStartDate, formatItDate } from "@/lib/supply-dates";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { format } from "date-fns";
import { Paperclip, X } from "lucide-react";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type Props = {
  session: { id: string; name: string; role: string };
  collaborators: { id: string; name: string }[];
  canPickCollaborator: boolean;
  suppliers: { id: string; name: string }[];
  initialClientId?: string;
};

export function NuovoContrattoForm({
  session,
  collaborators,
  canPickCollaborator,
  suppliers,
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

  const [supplierChoice, setSupplierChoice] = useState("");
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierName, setSupplierName] = useState("");
  const creatingSupplier = supplierChoice === "__NEW__";

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
  const [durationMonths, setDurationMonths] = useState(12);

  const [productName, setProductName] = useState("");
  const [offerCode, setOfferCode] = useState("");
  const [contractKind, setContractKind] = useState("Domestico");
  const [priceType, setPriceType] = useState("Fisso");
  const [priceIndex, setPriceIndex] = useState("PUN");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [ibanHolder, setIbanHolder] = useState("");
  const [pricePerKwh, setPricePerKwh] = useState("");
  const [pricePerSmc, setPricePerSmc] = useState("");
  const [pcv, setPcv] = useState("");
  const [spread, setSpread] = useState("");
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

  const registrationDate = useMemo(() => new Date(), []);
  const computedSupplyStart = useMemo(
    () => computeSupplyStartDate(registrationDate, operationType),
    [registrationDate, operationType],
  );
  const expiryPreview = useMemo(
    () => format(calcExpiryDate(computedSupplyStart, durationMonths), "dd/MM/yyyy"),
    [computedSupplyStart, durationMonths],
  );

  useEffect(() => {
    // Indice di riferimento in base al servizio
    if (priceType !== "Indicizzato") return;
    if (services.some((s) => s.service === "GAS") && !services.some((s) => s.service === "LUCE")) {
      setPriceIndex("PSV");
    } else {
      setPriceIndex("PUN");
    }
  }, [priceType, services]);

  // CAP gestito da CapAddressFields

  function onSupplierChange(value: string) {
    setSupplierChoice(value);
    if (value === "__NEW__") {
      setSupplierId(undefined);
      setSupplierName("");
      return;
    }
    if (!value) {
      setSupplierId(undefined);
      setSupplierName("");
      return;
    }
    const found = suppliers.find((s) => s.id === value);
    setSupplierId(value);
    setSupplierName(found?.name ?? "");
  }

  function buildPayload(draft: boolean): NewContractPayload {
    return {
      draft,
      sendToMaster,
      collaboratorId,
      clientId,
      idempotencyKey:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      supplierId: creatingSupplier ? undefined : supplierId,
      supplierName: creatingSupplier
        ? supplierName
        : suppliers.find((s) => s.id === supplierId)?.name,
      operationType,
      operationOther,
      supplySameAsResidence: supplySame,
      supplyStreet,
      supplyStreetNumber,
      supplyZipCode: supplyZip,
      supplyCity,
      supplyProvince,
      supplyRegion,
      supplyClassification: classification,
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
      spread,
      monthlyFee,
      notes,
      masterNotes,
      services,
      // Allegati via API separata (evita "unexpected response" per body troppo grande)
      attachments: [],
    };
  }

  function submit(draft: boolean) {
    setErrors([]);
    setMessage(null);
    if (sendToMaster && !draft) {
      const hasId = attachments.some((a) => ["CI_FRONTE", "CI_RETRO"].includes(a.docType));
      const hasBill = attachments.some((a) => a.docType === "BOLLETTA");
      if (!hasId || !hasBill) {
        setErrors([
          "Con invio al Master allega almeno documento di identità e bolletta/fattura.",
        ]);
        return;
      }
      if (!confirm("Confermi creazione e invio al Master (michele.faruoli@gmail.com)?")) {
        return;
      }
    }
    startTransition(async () => {
      try {
        const result = await createFullContractAction(buildPayload(draft));
        if (!result?.ok) {
          setErrors(result?.errors ?? ["Non è stato possibile salvare il contratto."]);
          return;
        }
        const contractId = result.contractIds?.[0];
        if (!contractId) {
          setErrors(["Contratto creato ma ID mancante. Controlla in Contratti / In lavorazione."]);
          return;
        }

        if (attachments.length > 0) {
          const fd = new FormData();
          for (const a of attachments) {
            const bin = atob(a.contentBase64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const file = new File([bytes], a.filename, {
              type: a.mimeType || "application/octet-stream",
            });
            fd.append("files", file);
            fd.append("docTypes", a.docType);
          }
          const up = await fetch(`/api/contracts/${contractId}/attachments`, {
            method: "POST",
            body: fd,
          });
          const upJson = (await up.json().catch(() => null)) as {
            success?: boolean;
            message?: string;
            saved?: number;
          } | null;
          if (!up.ok || !upJson?.success || !upJson.saved) {
            // Contratto salvato: NON navigare via, così l'errore resta visibile
            setErrors([
              `Il contratto è stato salvato, ma l'upload allegati non è riuscito (${upJson?.message ?? "errore"}). Apri la pratica e allega di nuovo, poi usa «Reinvia al Master».`,
            ]);
            setMessage(`Contratto salvato (ID pratica pronto). Vai a /lavorazione/${contractId} se chiudi questo messaggio.`);
            return;
          }
        }

        if (sendToMaster && !draft) {
          await new Promise((r) => setTimeout(r, 400));
          const mailRes = await fetch(`/api/contracts/${contractId}/attachments`, {
            method: "PUT",
          });
          const mailJson = (await mailRes.json().catch(() => null)) as {
            success?: boolean;
            emailSent?: boolean;
            message?: string;
            code?: string;
            attachmentsInEmail?: number;
          } | null;

          if (!mailRes.ok || !mailJson?.emailSent) {
            setErrors([
              mailJson?.message ||
                "Il contratto è stato salvato, ma l'email non è stata inviata. Usa «Reinvia al Master» dalla scheda lavorazione.",
            ]);
            setMessage(`Pratica creata. Apri /lavorazione/${contractId} per reinviare l'email.`);
            return;
          }

          setMessage(
            mailJson.message ||
              "Contratto creato e inviato al Master.",
          );
          router.push(`/lavorazione/${contractId}?ok=email`);
          router.refresh();
          return;
        }

        setMessage(result.message || "Salvato");
        router.push(`/contratti/${contractId}`);
        router.refresh();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Risposta inattesa dal server. Se il contratto risulta creato, aprilo da Contratti / In lavorazione.";
        setErrors([msg]);
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
      if (file.size > 5 * 1024 * 1024) {
        setErrors((e) => [...e, `File troppo grande (max 5MB): ${file.name}`]);
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

  function renderServiceLines() {
    return (
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
          <div key={line.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
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
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {line.service === "LUCE" ? (
                <Field label={sendToMaster ? "POD *" : "POD"}>
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
                <Field label={sendToMaster ? "PDR *" : "PDR"}>
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
    );
  }

  return (
    <div className="space-y-6">
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

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
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
              setLastName(a ?? "");
              setFirstName(rest.join(" "));
            } else {
              setLastName(q);
            }
          }}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipologia cliente *">
            <Select
              value={clientType}
              onChange={(e) => {
                const t = e.target.value as "PRIVATO" | "AZIENDA";
                setClientType(t);
                setClassification("");
                setContractKind(t === "PRIVATO" ? "Domestico" : "Non domestico");
              }}
            >
              <option value="PRIVATO">Privato (domestico)</option>
              <option value="AZIENDA">Business</option>
            </Select>
          </Field>
          <Field label={clientType === "PRIVATO" ? "Classificazione *" : "Classificazione *"}>
            <Select
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
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
        </div>

        {clientType === "PRIVATO" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome *">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Cognome *">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Codice fiscale">
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Telefono">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="PEC (facoltativa)">
              <Input value={pec} onChange={(e) => setPec(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ragione sociale *">
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field label="Partita IVA">
              <Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
            </Field>
            <Field label="CF aziendale">
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Telefono">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="PEC (facoltativa)">
              <Input value={pec} onChange={(e) => setPec(e.target.value)} />
            </Field>
            <Field label="Nome rappresentante">
              <Input
                value={legalFirstName}
                onChange={(e) => setLegalFirstName(e.target.value)}
              />
            </Field>
            <Field label="Cognome rappresentante">
              <Input
                value={legalLastName}
                onChange={(e) => setLegalLastName(e.target.value)}
              />
            </Field>
            <Field label="CF rappresentante">
              <Input
                value={legalFiscalCode}
                onChange={(e) => setLegalFiscalCode(e.target.value)}
              />
            </Field>
            <Field label="Codice SDI (facoltativo)">
              <Input value={sdiCode} onChange={(e) => setSdiCode(e.target.value)} />
            </Field>
          </div>
        )}

        <p className="text-sm font-medium text-slate-700">
          {clientType === "AZIENDA" ? "Sede legale" : "Indirizzo di residenza"}
        </p>
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
        <Field label="IBAN">
          <Input
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="IT60X..."
          />
        </Field>
        {creatingClient ? (
          <p className="text-xs text-emerald-700">
            Il nuovo cliente sarà salvato in anagrafica al salvataggio del contratto.
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Dati dell&apos;operazione</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipo operazione">
            <Select value={operationType} onChange={(e) => setOperationType(e.target.value)}>
              {OPERATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {operationType === "ALTRO" ? (
            <Field label="Specifica operazione *">
              <Input
                value={operationOther}
                onChange={(e) => setOperationOther(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Fornitore e contratto</h2>
        <Field label="Fornitore *">
          <Select value={supplierChoice} onChange={(e) => onSupplierChange(e.target.value)}>
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
          <Field label="Nome nuovo fornitore *">
            <Input
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Scrivi il nome del fornitore"
            />
          </Field>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nome offerta">
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
          </Field>
          <Field label="Codice offerta">
            <Input value={offerCode} onChange={(e) => setOfferCode(e.target.value)} />
          </Field>
          <Field label="Tipo contratto">
            <Select
              value={contractKind}
              onChange={(e) => setContractKind(e.target.value)}
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
          <Field label="Tipo prezzo">
            <Select value={priceType} onChange={(e) => setPriceType(e.target.value)}>
              <option value="Fisso">Fisso</option>
              <option value="Indicizzato">Indicizzato</option>
            </Select>
          </Field>
          {priceType === "Indicizzato" ? (
            <>
              <Field label="Indice di riferimento">
                <Select value={priceIndex} onChange={(e) => setPriceIndex(e.target.value)}>
                  <option value="PUN">PUN (luce)</option>
                  <option value="PSV">PSV (gas)</option>
                  <option value="Altro">Altro</option>
                </Select>
              </Field>
              <Field label="Spread">
                <Input value={spread} onChange={(e) => setSpread(e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field label="Data registrazione">
            <Input value={formatItDate(registrationDate)} readOnly className="bg-slate-50" />
          </Field>
          <Field label="Ingresso fornitura (calcolato)">
            <Input
              value={formatItDate(computedSupplyStart)}
              readOnly
              className="bg-slate-50"
            />
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
        <p className="text-xs text-slate-500">
          L&apos;ingresso in fornitura si calcola dalla data di registrazione (cambio: 1° mese
          successivo se prima del giorno 8, altrimenti +2 mesi; voltura/attivazione ≈ +7 giorni).
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Indirizzo di fornitura</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={supplySame}
            onChange={(e) => setSupplySame(e.target.checked)}
          />
          L&apos;indirizzo di fornitura coincide con residenza / sede legale
        </label>
        {!supplySame ? (
          <CapAddressFields
            zipCode={supplyZip}
            city={supplyCity}
            province={supplyProvince}
            region={supplyRegion}
            street={supplyStreet}
            streetNumber={supplyStreetNumber}
            onZipChange={setSupplyZip}
            onCityChange={setSupplyCity}
            onProvinceChange={setSupplyProvince}
            onRegionChange={setSupplyRegion}
            onStreetChange={setSupplyStreet}
            onStreetNumberChange={setSupplyStreetNumber}
            zipLabel="CAP fornitura"
          />
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Condizioni economiche e pagamento
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {hasLuce ? (
            <Field label="Prezzo energia €/kWh">
              <Input value={pricePerKwh} onChange={(e) => setPricePerKwh(e.target.value)} />
            </Field>
          ) : null}
          {hasGas ? (
            <Field label="Prezzo gas €/Smc">
              <Input value={pricePerSmc} onChange={(e) => setPricePerSmc(e.target.value)} />
            </Field>
          ) : null}
          <Field label="PCV €/mese">
            <Input value={pcv} onChange={(e) => setPcv(e.target.value)} />
          </Field>
          <Field label="Canone mensile €">
            <Input value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
          </Field>
          <Field label="Metodo di pagamento">
            <Select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="">Seleziona</option>
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {paymentMethod === "RID" ? (
            <>
              <Field label="IBAN (da scheda cliente)">
                <Input value={iban} readOnly className="bg-slate-50" />
              </Field>
              <Field label="Intestatario IBAN (se diverso)">
                <Input value={ibanHolder} onChange={(e) => setIbanHolder(e.target.value)} />
              </Field>
            </>
          ) : null}
        </div>
        {paymentMethod === "RID" && !iban.trim() ? (
          <p className="text-xs text-amber-700">
            Inserisci l&apos;IBAN nella scheda cliente sopra: verrà usato per il RID.
            {sendToMaster ? " Con invio al Master è obbligatorio." : " Senza invio al Master non è obbligatorio."}
          </p>
        ) : null}
      </section>

      {/* Servizi subito prima degli allegati */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Servizi del contratto</h2>
        {renderServiceLines()}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Allegati</h2>
        {sendToMaster ? (
          <p className="text-xs text-amber-800">
            Con invio al Master sono obbligatori: documento di identità e bolletta/fattura (max
            5MB ciascuno). Un solo click sulla casella apre il selettore file.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {DOC_TYPE_OPTIONS.map((doc) => {
            const inputId = `att-${doc.value}`;
            return (
              <label
                key={doc.value}
                htmlFor={inputId}
                className="attachment-tile flex cursor-pointer flex-col gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-4 hover:border-emerald-500 hover:bg-emerald-50/40 focus-within:ring-2 focus-within:ring-emerald-500"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <Paperclip className="h-4 w-4 text-emerald-700" aria-hidden />
                  {doc.label}
                </span>
                <span className="text-xs text-slate-500">
                  Clicca una volta per scegliere PDF o immagine
                </span>
                <input
                  id={inputId}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void onFilesSelected(e.target.files, doc.value);
                    e.target.value = "";
                  }}
                />
              </label>
            );
          })}
        </div>
        {attachments.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{a.filename}</p>
                  <p className="text-xs text-slate-500">
                    {DOC_TYPE_OPTIONS.find((d) => d.value === a.docType)?.label}
                    {a.mimeType ? ` · ${a.mimeType}` : ""}
                    {a.contentBase64
                      ? ` · ~${Math.max(1, Math.round((a.contentBase64.length * 0.75) / 1024))} KB`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
                  onClick={() => setAttachments((all) => all.filter((x) => x.id !== a.id))}
                >
                  <X className="h-3.5 w-3.5" />
                  Elimina
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Note e conferma</h2>
        <Field label="Note interne">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Note da inviare al Master">
          <Textarea
            rows={3}
            value={masterNotes}
            onChange={(e) => setMasterNotes(e.target.value)}
          />
        </Field>
        <div className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm">
          <p>
            <strong>Cliente:</strong>{" "}
            {clientLabel || `${firstName} ${lastName} ${companyName}`.trim() || "—"}
          </p>
          <p>
            <strong>Tipologia:</strong> {clientType === "AZIENDA" ? "Business" : "Privato"}
            {classification ? ` · ${classification}` : ""}
          </p>
          <p>
            <strong>Collaboratore:</strong>{" "}
            {collaborators.find((c) => c.id === collaboratorId)?.name ?? session.name}
          </p>
          <p>
            <strong>Servizi:</strong> {services.map((s) => s.service).join(", ")}
          </p>
          <p>
            <strong>Fornitore:</strong>{" "}
            {creatingSupplier
              ? supplierName || "—"
              : suppliers.find((s) => s.id === supplierId)?.name || "—"}
          </p>
          <p>
            <strong>Ingresso / scadenza:</strong> {formatItDate(computedSupplyStart)} →{" "}
            {expiryPreview}
          </p>
          <p>
            <strong>Invia al Master:</strong> {sendToMaster ? "Sì" : "No"}
          </p>
          <p>
            <strong>Allegati:</strong> {attachments.length}
          </p>
        </div>

        {errors.length > 0 ? (
          <PersistentAlert
            title="Salvataggio non completato"
            messages={errors}
            tone="error"
            onClose={() => setErrors([])}
          />
        ) : null}
        {message ? (
          <PersistentAlert
            title="Informazione"
            messages={[message]}
            tone={errors.length ? "warning" : "success"}
            onClose={() => setMessage(null)}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => submit(true)}
          >
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
