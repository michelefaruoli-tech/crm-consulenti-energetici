"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AutocompleteSearch } from "@/components/contracts/autocomplete-search";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createFullContractAction } from "@/lib/contract-create-action";
import {
  DOC_TYPE_OPTIONS,
} from "@/lib/constants";
import {
  calcExpiryDate,
  createEmptyServiceLine,
  type ContractServiceLine,
  type NewContractPayload,
} from "@/lib/contract-form-types";
import { computeSupplyStartDate, formatItDate } from "@/lib/supply-dates";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { DocumentAutoFillPanel } from "@/components/contracts/ocr/document-auto-fill-panel";
import {
  AddServiceButton,
  ServiceContractBlocks,
} from "@/components/contracts/service-contract-blocks";
import type { OcrApplyPayload } from "@/lib/ocr/schema";
import { format } from "date-fns";
import { AttachmentDropZone } from "@/components/contracts/attachment-drop-zone";
import { X } from "lucide-react";
import { splitItalianPersonName } from "@/lib/italian-person-name";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fillStatus(active: boolean, filled: boolean): "off" | "empty" | "filled" {
  if (!active) return "off";
  return filled ? "filled" : "empty";
}

function hasIdentityDoc(
  attachments: { docType: string }[],
): boolean {
  const unico = attachments.some((a) => a.docType === "CI_UNICO");
  const fronte = attachments.some((a) => a.docType === "CI_FRONTE");
  const retro = attachments.some((a) => a.docType === "CI_RETRO");
  return unico || (fronte && retro);
}

function hasBillDoc(attachments: { docType: string }[]): boolean {
  return attachments.some((a) => a.docType === "BOLLETTA");
}

type Props = {
  session: { id: string; name: string; role: string };
  collaborators: { id: string; name: string }[];
  canPickCollaborator: boolean;
  suppliers: { id: string; name: string }[];
  listinoRules?: {
    id: string;
    supplierId: string;
    name: string;
    clientSegment: string;
    gettoneTotale: string;
    hasRid?: boolean;
  }[];
  initialClientId?: string;
};

export function NuovoContrattoForm({
  session,
  collaborators,
  canPickCollaborator,
  suppliers,
  listinoRules = [],
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

  const [durationMonths, setDurationMonths] = useState(12);
  const [notes, setNotes] = useState("");
  const [masterNotes, setMasterNotes] = useState("");

  const [services, setServices] = useState<ContractServiceLine[]>([
    createEmptyServiceLine({ service: "LUCE" }),
  ]);
  const [attachments, setAttachments] = useState<
    {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      docType: string;
      /** File originale (preferito per upload su Vercel) */
      file?: File;
      contentBase64?: string;
    }[]
  >([]);

  const [registrationDate, setRegistrationDate] = useState(() => new Date());
  const primary = services[0];
  const primaryOp = primary?.operationType ?? "SWITCH";
  const computedSupplyStart = useMemo(
    () => computeSupplyStartDate(registrationDate, primaryOp),
    [registrationDate, primaryOp],
  );
  const expiryPreview = useMemo(
    () => format(calcExpiryDate(computedSupplyStart, durationMonths), "dd/MM/yyyy"),
    [computedSupplyStart, durationMonths],
  );

  const req = sendToMaster;
  const identityOk = useMemo(() => hasIdentityDoc(attachments), [attachments]);
  const billOk = useMemo(() => hasBillDoc(attachments), [attachments]);
  const addressOk = Boolean(
    (street || streetNumber).trim() &&
      zipCode.replace(/\D/g, "").length === 5 &&
      city.trim() &&
      province.trim(),
  );
  const clientNameOk =
    clientType === "PRIVATO"
      ? Boolean(firstName.trim() && lastName.trim())
      : Boolean(companyName.trim());
  const clientOk = Boolean(clientId) || (creatingClient && clientNameOk);

  function patchService(id: string, patch: Partial<ContractServiceLine>) {
    setServices((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addService() {
    const prev = services[services.length - 1];
    setServices((s) => [
      ...s,
      createEmptyServiceLine({
        service: prev?.service === "LUCE" ? "GAS" : "LUCE",
        supplySameAsResidence: prev?.supplySameAsResidence ?? true,
        operationType: prev?.operationType ?? "SWITCH",
        paymentMethod: prev?.paymentMethod ?? "",
        supplierId: prev?.supplierId,
        contractKind:
          prev?.contractKind ??
          (clientType === "PRIVATO" ? "Domestico" : "Non domestico"),
        priceType: prev?.priceType ?? "FISSO",
      }),
    ]);
  }

  function buildPayload(draft: boolean): NewContractPayload {
    const first = services[0];
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
      supplierId: first?.supplierId,
      supplierName: first?.supplierName,
      operationType: first?.operationType || "SWITCH",
      operationOther: first?.operationOther,
      insertionDate: formatItDate(registrationDate),
      supplySameAsResidence: first?.supplySameAsResidence !== false,
      supplyStreet: first?.supplyStreet,
      supplyStreetNumber: first?.supplyStreetNumber,
      supplyZipCode: first?.supplyZipCode,
      supplyCity: first?.supplyCity,
      supplyProvince: first?.supplyProvince,
      supplyRegion: first?.supplyRegion,
      supplyClassification: classification,
      durationMonths,
      productName: first?.productName,
      offerCode: first?.offerCode,
      commissionRuleId: first?.commissionRuleId || undefined,
      contractKind:
        first?.contractKind ||
        (clientType === "PRIVATO" ? "Domestico" : "Non domestico"),
      priceType: first?.priceType,
      paymentMethod: first?.paymentMethod,
      ibanHolder: first?.ibanHolder,
      pricePerKwh: first?.pricePerKwh,
      pricePerSmc: first?.pricePerSmc,
      pcv: first?.pcv,
      spread: first?.spread,
      monthlyFee: first?.monthlyFee,
      notes,
      masterNotes,
      services,
      attachments: [],
    };
  }

  function submit(draft: boolean) {
    setErrors([]);
    setMessage(null);
    if (sendToMaster && !draft) {
      const missing: string[] = [];
      if (!clientOk) missing.push("Cliente (nome/cognome o ragione sociale)");
      if (!classification.trim()) missing.push("Classificazione");
      if (clientType === "PRIVATO" && !fiscalCode.trim()) missing.push("Codice fiscale");
      if (clientType === "AZIENDA" && !vatNumber.trim() && !fiscalCode.trim()) {
        missing.push("Partita IVA o CF aziendale");
      }
      if (!phone.trim()) missing.push("Telefono");
      if (!addressOk) missing.push("Indirizzo completo (CAP, comune, provincia, via)");
      for (const [i, s] of services.entries()) {
        const n = i + 1;
        if (!s.supplierId && !s.supplierName?.trim()) missing.push(`Servizio ${n}: fornitore`);
        if (!s.paymentMethod) missing.push(`Servizio ${n}: metodo pagamento`);
        if ((s.service === "LUCE" || s.service === "DUAL") && !s.pod?.trim()) {
          missing.push(`Servizio ${n}: POD`);
        }
        if ((s.service === "GAS" || s.service === "DUAL") && !s.pdr?.trim()) {
          missing.push(`Servizio ${n}: PDR`);
        }
      }
      if (!identityOk) {
        missing.push(
          "Documento identità: carica documento unico OPPURE fronte + retro",
        );
      }
      if (!billOk) {
        missing.push("Almeno una fattura / bolletta");
      }
      if (missing.length) {
        setErrors([
          "Per inviare al BACK OFFICE completa i campi evidenziati in giallo:",
          ...missing,
        ]);
        return;
      }
      const ok = window.confirm(
        "CONFERMA CREAZIONE E INVIO AL BACK OFFICE\n\n" +
          "Il contratto verrà creato e inviato al back office per essere lavorato.\n\n" +
          "Confermi?",
      );
      if (!ok) return;
    } else if (!draft) {
      const ok = window.confirm(
        "Confermi la creazione del contratto?\n\n(Non verrà inviato al back office)",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const result = await createFullContractAction(buildPayload(draft));
        if (!result?.ok) {
          setErrors(result?.errors ?? ["Non è stato possibile salvare il contratto."]);
          return;
        }
        const contractIds = (result.contractIds ?? []).filter(Boolean);
        const contractId = contractIds[0];
        if (!contractId) {
          setErrors(["Contratto creato ma ID mancante. Controlla in Contratti / In lavorazione."]);
          return;
        }

        // Converte i File in base64 UNA volta (il File non si può riusare su più upload)
        const prepared: Array<{
          filename: string;
          mimeType: string;
          docType: string;
          contentBase64: string;
        }> = [];
        for (const a of attachments) {
          try {
            if (a.contentBase64) {
              prepared.push({
                filename: a.filename,
                mimeType: a.mimeType || "application/octet-stream",
                docType: a.docType,
                contentBase64: a.contentBase64,
              });
              continue;
            }
            if (a.file) {
              const contentBase64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const raw = String(reader.result || "");
                  resolve(raw.includes(",") ? raw.split(",")[1]! : raw);
                };
                reader.onerror = () => reject(new Error("Lettura file fallita"));
                reader.readAsDataURL(a.file!);
              });
              prepared.push({
                filename: a.filename,
                mimeType: a.mimeType || a.file.type || "application/octet-stream",
                docType: a.docType,
                contentBase64,
              });
            }
          } catch (err) {
            setErrors([
              `Allegato ${a.filename}: ${err instanceof Error ? err.message : "non leggibile"}`,
            ]);
            return;
          }
        }

        // Carica gli stessi allegati su TUTTI i contratti (Luce, Gas, …)
        if (prepared.length > 0) {
          let savedTotal = 0;
          const failReasons: string[] = [];
          for (const cid of contractIds) {
            for (const a of prepared) {
              try {
                const up = await fetch(`/api/contracts/${cid}/attachments`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(a),
                });
                const upJson = (await up.json().catch(() => null)) as {
                  success?: boolean;
                  message?: string;
                  saved?: number;
                } | null;
                if (!up.ok || !upJson?.success || !upJson.saved) {
                  failReasons.push(
                    `${a.filename}: ${upJson?.message ?? `HTTP ${up.status}`}`,
                  );
                } else {
                  savedTotal += upJson.saved;
                }
              } catch (err) {
                failReasons.push(
                  `${a.filename}: ${err instanceof Error ? err.message : "errore rete"}`,
                );
              }
            }
          }
          if (savedTotal === 0) {
            setErrors([
              `I contratti sono stati salvati, ma nessun allegato è stato caricato. ${failReasons.slice(0, 3).join(" · ")}. Apri le pratiche e allega di nuovo, poi usa «Reinvia».`,
            ]);
            setMessage(null);
            return;
          }
          if (failReasons.length > 0) {
            setErrors([
              `Contratti salvati. Allegati parziali (${savedTotal} upload): ${failReasons.slice(0, 2).join(" · ")}.`,
            ]);
          }
        }

        if (sendToMaster && !draft) {
          await new Promise((r) => setTimeout(r, 400));
          // UNA sola email con anagrafica + tutti i blocchi servizio (Luce, Gas, …)
          const mailRes = await fetch(`/api/contracts/notify-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contractIds }),
          });
          const mailJson = (await mailRes.json().catch(() => null)) as {
            success?: boolean;
            emailSent?: boolean;
            message?: string;
            contractCount?: number;
            recipients?: string;
          } | null;

          if (!mailRes.ok || !mailJson?.emailSent) {
            setErrors([
              mailJson?.message ||
                "I contratti sono stati salvati, ma l'email non è stata inviata. Usa «Reinvia» dalla scheda lavorazione.",
            ]);
            setMessage(`Pratiche create. Apri /lavorazione/${contractId} per reinviare l'email.`);
            return;
          }

          setMessage(
            mailJson.message ||
              (contractIds.length > 1
                ? `${contractIds.length} contratti inviati in un'unica email al back office.`
                : "Contratto creato e inviato al back office."),
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
      const okType =
        ["application/pdf", "image/jpeg", "image/png", "image/jpg"].includes(file.type) ||
        /\.(pdf|jpe?g|png)$/i.test(file.name);
      if (!okType) {
        setErrors((e) => [...e, `Formato non supportato: ${file.name}`]);
        continue;
      }
      if (file.size > 15 * 1024 * 1024) {
        setErrors((e) => [...e, `File troppo grande (max 15MB): ${file.name}`]);
        continue;
      }
      next.push({
        id: uid(),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        docType,
        file, // mantiene il File originale → upload affidabile
      });
    }
    setAttachments(next);
  }

  async function attachOcrFiles(
    items: Array<{ file: File; docType: string }>,
  ) {
    const next = [...attachments];
    for (const item of items) {
      const file = item.file;
      if (file.size > 5 * 1024 * 1024) continue;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      next.push({
        id: uid(),
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        docType: item.docType,
        contentBase64: btoa(binary),
      });
    }
    setAttachments(next);
  }

  function applyOcrPayload(payload: OcrApplyPayload) {
    setCreatingClient(true);
    setClientId(undefined);
    if (payload.clientType) setClientType(payload.clientType);
    if (payload.firstName != null) setFirstName(payload.firstName);
    if (payload.lastName != null) setLastName(payload.lastName);
    if (payload.companyName != null) setCompanyName(payload.companyName);
    if (payload.fiscalCode != null) setFiscalCode(payload.fiscalCode);
    if (payload.vatNumber != null) setVatNumber(payload.vatNumber);
    if (payload.phone != null) setPhone(payload.phone);
    if (payload.email != null) setEmail(payload.email);
    if (payload.pec != null) setPec(payload.pec);
    if (payload.iban != null) setIban(payload.iban);
    if (payload.street != null) setStreet(payload.street);
    if (payload.streetNumber != null) setStreetNumber(payload.streetNumber);
    if (payload.zipCode != null) setZipCode(payload.zipCode);
    if (payload.city != null) setCity(payload.city);
    if (payload.province != null) setProvince(payload.province);
    if (payload.region != null) setRegion(payload.region);
    if (payload.legalFirstName != null) setLegalFirstName(payload.legalFirstName);
    if (payload.legalLastName != null) setLegalLastName(payload.legalLastName);
    if (payload.classification != null) setClassification(payload.classification);

    const foundSupplier = payload.supplierName
      ? suppliers.find(
          (s) => s.name.toLowerCase() === payload.supplierName!.toLowerCase(),
        )
      : undefined;

    const basePatch: Partial<ContractServiceLine> = {
      productName: payload.productName ?? undefined,
      paymentMethod: payload.paymentMethod ?? undefined,
      supplySameAsResidence: payload.supplySame ?? true,
      supplyStreet: payload.supplyStreet ?? undefined,
      supplyStreetNumber: payload.supplyStreetNumber ?? undefined,
      supplyZipCode: payload.supplyZip ?? undefined,
      supplyCity: payload.supplyCity ?? undefined,
      supplyProvince: payload.supplyProvince ?? undefined,
      supplyRegion: payload.supplyRegion ?? undefined,
      supplierId: foundSupplier?.id,
      supplierName: foundSupplier ? undefined : payload.supplierName ?? undefined,
    };

    if (payload.services?.length) {
      setServices(
        payload.services.map((s) =>
          createEmptyServiceLine({
            ...basePatch,
            service: s.service,
            pod: s.pod ?? "",
            pdr: s.pdr ?? "",
            annualKwh: s.annualKwh ?? "",
            annualSmc: s.annualSmc ?? "",
            powerKw: s.powerKw ?? "",
          }),
        ),
      );
    } else {
      setServices((all) => {
        const first = all[0] ?? createEmptyServiceLine();
        return [{ ...first, ...basePatch }];
      });
    }
    setMessage(
      "Dati dai documenti applicati al modulo. Controlla tutto prima di creare il contratto.",
    );
    setErrors([]);
  }

  return (
    <div className="space-y-4 pb-24 sm:space-y-6 sm:pb-0">
      <DocumentAutoFillPanel
        canUseMistralOcr
        onApply={applyOcrPayload}
        onAttachFiles={(items) => {
          void attachOcrFiles(items);
        }}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
          <div className="flex flex-col justify-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
                Opzioni e stato
              </h2>
              <p className="text-sm text-slate-500">
                Salva in gestionale oppure invia al back office per la lavorazione
              </p>
            </div>
            {canPickCollaborator ? (
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
            ) : (
              <p className="text-sm text-slate-600">
                Collaboratore: <strong>{session.name}</strong> (assegnato automaticamente)
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSendToMaster((v) => !v)}
            aria-pressed={sendToMaster}
            className={[
              "flex min-h-[7.5rem] w-full flex-col items-start justify-center rounded-2xl border-4 px-5 py-5 text-left shadow-md transition sm:min-h-[9rem] sm:px-6",
              sendToMaster
                ? "border-emerald-700 bg-emerald-600 text-white ring-4 ring-emerald-300"
                : "border-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
            ].join(" ")}
          >
            <span className="text-xl font-black uppercase leading-tight tracking-wide sm:text-2xl md:text-3xl">
              Invia al BACKOFFICE
            </span>
            <span className="mt-2 text-base font-semibold sm:text-lg">
              per essere lavorato
            </span>
            <span
              className={[
                "mt-3 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider",
                sendToMaster
                  ? "bg-white/20 text-white"
                  : "bg-emerald-200 text-emerald-900",
              ].join(" ")}
            >
              {sendToMaster ? "Attivo — verrà inviato" : "Clicca per attivare"}
            </span>
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Dati cliente</h2>
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
            const parsed = splitItalianPersonName(q);
            setFirstName(parsed.firstName);
            setLastName(parsed.lastName);
          }}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tipologia cliente" fillStatus={fillStatus(req, true)}>
            <Select
              value={clientType}
              onChange={(e) => {
                const t = e.target.value as "PRIVATO" | "AZIENDA";
                setClientType(t);
                setClassification("");
                setServices((all) =>
                  all.map((s) => ({
                    ...s,
                    contractKind: t === "PRIVATO" ? "Domestico" : "Non domestico",
                  })),
                );
              }}
            >
              <option value="PRIVATO">Privato (domestico)</option>
              <option value="AZIENDA">Business</option>
            </Select>
          </Field>
          <Field
            label="Classificazione"
            fillStatus={fillStatus(req, Boolean(classification.trim()))}
          >
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
            <Field label="Cognome" fillStatus={fillStatus(req, Boolean(lastName.trim()))}>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Nome" fillStatus={fillStatus(req, Boolean(firstName.trim()))}>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field
              label="Codice fiscale"
              fillStatus={fillStatus(req, Boolean(fiscalCode.trim()))}
            >
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Telefono" fillStatus={fillStatus(req, Boolean(phone.trim()))}>
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
            <Field
              label="Ragione sociale"
              fillStatus={fillStatus(req, Boolean(companyName.trim()))}
            >
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field
              label="Partita IVA"
              fillStatus={fillStatus(req, Boolean(vatNumber.trim() || fiscalCode.trim()))}
            >
              <Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
            </Field>
            <Field
              label="CF aziendale"
              fillStatus={fillStatus(req, Boolean(vatNumber.trim() || fiscalCode.trim()))}
            >
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Telefono" fillStatus={fillStatus(req, Boolean(phone.trim()))}>
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
          highlightRequired={req}
        />
        <Field label="IBAN" fillStatus={fillStatus(req && services.some((s) => s.paymentMethod === "RID"), Boolean(iban.trim()))}>
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

      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Servizi del contratto</h2>
            <p className="text-sm text-slate-500">
              Ogni servizio ha 3 blocchi: Operazione · Fornitura · Fornitore. «Aggiungi servizio» ripete tutto.
            </p>
          </div>
          <AddServiceButton onClick={addService} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Data registrazione">
            <Input
              type="date"
              value={format(registrationDate, "yyyy-MM-dd")}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [y, m, d] = v.split("-").map(Number);
                if (!y || !m || !d) return;
                setRegistrationDate(new Date(y, m - 1, d));
              }}
            />
          </Field>
          <Field label="Ingresso fornitura (calcolato)">
            <Input value={formatItDate(computedSupplyStart)} readOnly className="bg-white" />
          </Field>
          <Field label="Durata (mesi)">
            <Input
              type="number"
              min={1}
              value={durationMonths}
              onChange={(e) => setDurationMonths(Number(e.target.value) || 12)}
            />
          </Field>
          <Field label="Scadenza (auto)">
            <Input value={expiryPreview} readOnly className="bg-white" />
          </Field>
        </div>
        {services.map((line, idx) => (
          <ServiceContractBlocks
            key={line.id}
            line={line}
            index={idx}
            canRemove={services.length > 1}
            onChange={(patch) => patchService(line.id, patch)}
            onRemove={() => setServices((s) => s.filter((x) => x.id !== line.id))}
            suppliers={suppliers}
            listinoRules={listinoRules}
            clientType={clientType}
            clientIban={iban}
            residence={{
              street,
              streetNumber,
              zipCode,
              city,
              province,
              region,
            }}
            highlightRequired={req}
          />
        ))}
        <div className="pt-1">
          <AddServiceButton onClick={addService} />
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Note</h2>
        <Field label="Note interne">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Note da inviare al back office">
          <Textarea
            rows={3}
            value={masterNotes}
            onChange={(e) => setMasterNotes(e.target.value)}
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Documenti / Allegati</h2>
        {req ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            Obbligatori per il back office:{" "}
            <strong>documento identità</strong> (unico <em>oppure</em> fronte + retro) e{" "}
            <strong>almeno una fattura/bolletta</strong> (anche più di una). Giallo = manca ·
            Verde = ok.
          </p>
        ) : null}

        <div
          className={[
            "space-y-3 rounded-xl p-3 ring-2 transition-colors",
            req
              ? identityOk
                ? "bg-emerald-50 ring-emerald-400"
                : "bg-amber-50 ring-amber-400"
              : "bg-slate-50 ring-slate-200",
          ].join(" ")}
        >
          <div>
            <p className="text-sm font-bold text-slate-900">
              Documento identità {req ? (identityOk ? "✓" : "*") : ""}
            </p>
            <p className="text-xs text-slate-600">
              Carica un <strong>documento unico</strong>, oppure <strong>fronte + retro</strong>.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <AttachmentDropZone
              title="Documento unico"
              hint="CI / passaporto in un solo file"
              fillStatus={fillStatus(
                req,
                attachments.some((a) => a.docType === "CI_UNICO"),
              )}
              onAdd={(files) => void onFilesSelected(files, "CI_UNICO")}
            />
            <AttachmentDropZone
              title="Fronte"
              hint="Solo se non usi documento unico"
              fillStatus={fillStatus(
                req && !attachments.some((a) => a.docType === "CI_UNICO"),
                attachments.some((a) => a.docType === "CI_FRONTE"),
              )}
              onAdd={(files) => void onFilesSelected(files, "CI_FRONTE")}
            />
            <AttachmentDropZone
              title="Retro"
              hint="Solo se non usi documento unico"
              fillStatus={fillStatus(
                req && !attachments.some((a) => a.docType === "CI_UNICO"),
                attachments.some((a) => a.docType === "CI_RETRO"),
              )}
              onAdd={(files) => void onFilesSelected(files, "CI_RETRO")}
            />
          </div>
        </div>

        <div
          className={[
            "space-y-3 rounded-xl p-3 ring-2 transition-colors",
            req
              ? billOk
                ? "bg-emerald-50 ring-emerald-400"
                : "bg-amber-50 ring-amber-400"
              : "bg-slate-50 ring-slate-200",
          ].join(" ")}
        >
          <div>
            <p className="text-sm font-bold text-slate-900">
              Fattura / bolletta {req ? (billOk ? "✓" : "*") : ""}
            </p>
            <p className="text-xs text-slate-600">
              Obbligatoria almeno una. Puoi caricare anche più fatture.
            </p>
          </div>
          <AttachmentDropZone
            title="Fattura / bolletta"
            hint="Trascina una o più fatture"
            fillStatus={fillStatus(req, billOk)}
            onAdd={(files) => void onFilesSelected(files, "BOLLETTA")}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Altri allegati (facoltativi)</p>
          <div className="grid gap-3 md:grid-cols-2">
            {DOC_TYPE_OPTIONS.filter(
              (d) =>
                !["CI_UNICO", "CI_FRONTE", "CI_RETRO", "BOLLETTA"].includes(d.value),
            ).map((doc) => (
              <AttachmentDropZone
                key={doc.value}
                title={doc.label}
                hint="1) Trascina · 2) Scegli file · 3) Foto (telefono)"
                onAdd={(files) => void onFilesSelected(files, doc.value)}
              />
            ))}
          </div>
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
                    {DOC_TYPE_OPTIONS.find((d) => d.value === a.docType)?.label ?? a.docType}
                    {a.mimeType ? ` · ${a.mimeType}` : ""}
                    {a.size
                      ? ` · ${Math.max(1, Math.round(a.size / 1024))} KB`
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

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Conferma</h2>
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
            {services
              .map((s) => {
                if (s.supplierId) {
                  return suppliers.find((x) => x.id === s.supplierId)?.name ?? s.supplierId;
                }
                return s.supplierName || "—";
              })
              .join(" · ")}
          </p>
          <p>
            <strong>Ingresso / scadenza:</strong> {formatItDate(computedSupplyStart)} →{" "}
            {expiryPreview}
          </p>
          <p>
            <strong>Invia al BACKOFFICE:</strong> {sendToMaster ? "Sì" : "No"}
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

        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur sm:static sm:z-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12 flex-1 sm:flex-none"
            disabled={pending}
            onClick={() => submit(true)}
          >
            Bozza
          </Button>
          <Button
            type="button"
            className="min-h-12 flex-[1.4] sm:min-h-14 sm:flex-none sm:px-8 sm:text-base sm:font-bold"
            disabled={pending}
            onClick={() => submit(false)}
          >
            {sendToMaster ? "Crea e invia al BACKOFFICE" : "Crea contratto"}
          </Button>
        </div>
      </section>
    </div>
  );
}
