"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AutocompleteSearch,
  type AutocompleteItem,
} from "@/components/contracts/autocomplete-search";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createFullContractAction } from "@/lib/contract-create-action";
import {
  calcExpiryDate,
  createEmptyServiceLine,
  isValidIban,
  type ContractServiceLine,
  type NewContractPayload,
} from "@/lib/contract-form-types";
import { computeSupplyStartDate, describeSupplyStartRule, formatItDate } from "@/lib/supply-dates";
import { CapAddressFields } from "@/components/contracts/cap-address-fields";
import { ExistingClientHints } from "@/components/contracts/existing-client-hints";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { DocumentAutoFillPanel } from "@/components/contracts/ocr/document-auto-fill-panel";
import {
  AddServiceButton,
  ServiceContractBlocks,
} from "@/components/contracts/service-contract-blocks";
import type { OcrApplyPayload } from "@/lib/ocr/schema";
import { format } from "date-fns";
import { ContractAttachmentsPanel } from "@/components/contracts/contract-attachments-panel";
import { splitItalianPersonName } from "@/lib/italian-person-name";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fillStatus(active: boolean, filled: boolean): "off" | "empty" | "filled" {
  if (!active) return "off";
  return filled ? "filled" : "empty";
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{description}</p>
    </div>
  );
}

const CLASSIFICATION_BY_CLIENT_TYPE = {
  PRIVATO: [
    { value: "Residente", label: "Residente" },
    { value: "Non residente", label: "Non residente" },
    { value: "Altri usi", label: "Altri usi" },
  ],
  AZIENDA: [
    { value: "Business", label: "Business" },
    { value: "Condominio", label: "Condominio" },
    { value: "Altri usi", label: "Altri usi" },
    { value: "PA", label: "Pubblica amministrazione" },
  ],
} as const;

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
    paymentType?: string;
    gettoneMensile?: number;
    installments?: number | null;
    stornoMonths?: number | null;
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
  const [contractIban, setContractIban] = useState("");
  const contractIbanCustomized = useRef(false);
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
  const [invoiceMode, setInvoiceMode] = useState<"MAIL" | "POSTA">("MAIL");
  const [invoiceEmail, setInvoiceEmail] = useState("");

  const [durationMonths, setDurationMonths] = useState(12);
  const [notes, setNotes] = useState("");
  const [masterNotes, setMasterNotes] = useState("");

  const [services, setServices] = useState<ContractServiceLine[]>([
    createEmptyServiceLine({ service: "LUCE" }),
  ]);
  const [podMatches, setPodMatches] = useState<Array<{
    id: string;
    client: string;
    supplier: string;
    status: string;
    supplyStartDate: string | null;
    archived: boolean;
  }>>([]);
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
  const [customSupplyStart, setCustomSupplyStart] = useState("");
  const [showContractDates, setShowContractDates] = useState(false);
  const primary = services[0];
  const primaryOp = primary?.operationType ?? "SWITCH";
  const computedSupplyStart = useMemo(
    () => computeSupplyStartDate(registrationDate, primaryOp),
    [registrationDate, primaryOp],
  );
  const effectiveSupplyStart = useMemo(() => {
    if (!customSupplyStart) return computedSupplyStart;
    const [y, m, d] = customSupplyStart.split("-").map(Number);
    return y && m && d ? new Date(y, m - 1, d) : computedSupplyStart;
  }, [customSupplyStart, computedSupplyStart]);
  const expiryPreview = useMemo(
    () => format(calcExpiryDate(effectiveSupplyStart, durationMonths), "dd/MM/yyyy"),
    [effectiveSupplyStart, durationMonths],
  );
  const primaryRule = listinoRules.find((rule) => rule.id === primary?.commissionRuleId);
  const hasMonthlyRecurrence =
    primaryRule?.paymentType === "MENSILE" || Number(primaryRule?.gettoneMensile || 0) > 0;
  const firstRecurringLabel = format(effectiveSupplyStart, "MM/yyyy");
  const supplyStartBeforeRegistration =
    format(effectiveSupplyStart, "yyyy-MM-dd") < format(registrationDate, "yyyy-MM-dd");
  const selectedCollaboratorName =
    collaborators.find((collaborator) => collaborator.id === collaboratorId)?.name ?? session.name;

  function euro(value: string | number | null | undefined) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
  }

  const podValues = useMemo(
    () => [...new Set(services.flatMap((line) => [line.pod, line.pdr]).map((v) => v?.trim()).filter((v): v is string => Boolean(v && v.length >= 6)))],
    [services],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (podValues.length === 0) {
        setPodMatches([]);
        return;
      }
      try {
        const results = await Promise.all(
          podValues.map(async (value) => {
            const response = await fetch(`/api/contracts/pod-check?value=${encodeURIComponent(value)}`, {
              signal: controller.signal,
            });
            if (!response.ok) return [];
            const json = (await response.json()) as { matches?: typeof podMatches };
            return json.matches ?? [];
          }),
        );
        setPodMatches([...new Map(results.flat().map((row) => [row.id, row])).values()]);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setPodMatches([]);
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [podValues]);

  // Se arrivi da scheda cliente con id già noto, carica tutto in automatico
  useEffect(() => {
    if (!initialClientId) return;
    void fetch(`/api/clients/search?id=${encodeURIComponent(initialClientId)}`)
      .then((r) => r.json())
      .then((data: { item?: AutocompleteItem | null }) => {
        if (data.item) applyClientFromAnagrafica(data.item);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al mount / cambio id iniziale
  }, [initialClientId]);

  const req = sendToMaster;
  /** Evidenza campi minimi anche senza invio al Master. */
  const reqBase = true;
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

  /** Compila tutta la sezione “Dati cliente” da un record anagrafica. */
  function applyClientFromAnagrafica(item: AutocompleteItem) {
    const nextIban = String(item.iban ?? "");
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
    setIban(nextIban);
    contractIbanCustomized.current = false;
    setContractIban(nextIban);
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
    setInvoiceEmail(String(item.email ?? ""));
  }

  /** Seleziona cliente: usa i dati della ricerca e ricarica per id (sicurezza). */
  async function selectExistingClient(item: AutocompleteItem) {
    applyClientFromAnagrafica(item);
    try {
      const res = await fetch(
        `/api/clients/search?id=${encodeURIComponent(item.id)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { item?: AutocompleteItem | null };
      if (data.item) applyClientFromAnagrafica(data.item);
    } catch {
      // i dati della ricerca restano comunque applicati
    }
  }

  function clearSelectedClient() {
    setClientId(undefined);
    setClientLabel(undefined);
    setCreatingClient(true);
    contractIbanCustomized.current = false;
    setContractIban("");
  }

  function updateAnagraficaIban(value: string) {
    setIban(value);
    if (!contractIbanCustomized.current) {
      setContractIban(value);
    }
  }

  function updateContractIban(value: string, fromAnagrafica = false) {
    if (fromAnagrafica) {
      contractIbanCustomized.current = false;
    } else {
      contractIbanCustomized.current = true;
    }
    setContractIban(value);
  }

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
      supplyStartDate: customSupplyStart
        ? formatItDate(effectiveSupplyStart)
        : undefined,
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
      contractIban: contractIban.trim() || undefined,
      pricePerKwh: first?.pricePerKwh,
      pricePerSmc: first?.pricePerSmc,
      pcv: first?.pcv,
      spread: first?.spread,
      monthlyFee: first?.monthlyFee,
      invoiceMode: first?.invoiceMode || invoiceMode,
      invoiceEmail:
        (first?.invoiceMode || invoiceMode) === "MAIL"
          ? email
          : first?.invoiceEmail || invoiceEmail,
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
      if (!email.trim()) missing.push("Email");
      if (!addressOk) missing.push("Indirizzo completo (CAP, comune, provincia, via)");
      for (const [i, s] of services.entries()) {
        const n = i + 1;
        if (!s.operationType) missing.push(`Servizio ${n}: tipo operazione`);
        if (s.operationType === "ALTRO" && !s.operationOther?.trim()) {
          missing.push(`Servizio ${n}: specifica operazione`);
        }
        if (!s.supplierId && !s.supplierName?.trim()) missing.push(`Servizio ${n}: fornitore`);
        if (!s.paymentMethod) missing.push(`Servizio ${n}: metodo pagamento`);
        if (s.paymentMethod === "RID") {
          if (!contractIban.trim()) missing.push("IBAN contratto (RID)");
          else if (!isValidIban(contractIban)) missing.push("IBAN contratto non valido");
        }
        if ((s.service === "LUCE" || s.service === "DUAL") && !s.pod?.trim()) {
          missing.push(`Servizio ${n}: POD`);
        }
        if ((s.service === "GAS" || s.service === "DUAL") && !s.pdr?.trim()) {
          missing.push(`Servizio ${n}: PDR`);
        }
      }
      if (attachments.length === 0) {
        missing.push("Allega almeno un documento (qualsiasi tipo)");
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
      const missing: string[] = [];
      if (clientType === "PRIVATO") {
        if (!firstName.trim()) missing.push("Nome");
        if (!lastName.trim()) missing.push("Cognome");
        if (!fiscalCode.trim()) missing.push("Codice fiscale");
      } else {
        if (!companyName.trim()) missing.push("Ragione sociale");
        if (!fiscalCode.trim() && !vatNumber.trim()) {
          missing.push("Codice fiscale o Partita IVA");
        }
      }
      if (!clientOk && !creatingClient) missing.push("Cliente");
      for (const [i, s] of services.entries()) {
        const n = i + 1;
        if (!s.operationType) missing.push(`Servizio ${n}: tipo operazione`);
        if (s.operationType === "ALTRO" && !s.operationOther?.trim()) {
          missing.push(`Servizio ${n}: specifica operazione`);
        }
        if (!s.supplierId && !s.supplierName?.trim()) missing.push(`Servizio ${n}: fornitore`);
        if (!s.paymentMethod) missing.push(`Servizio ${n}: metodo pagamento`);
        if (s.paymentMethod === "RID") {
          if (!contractIban.trim()) missing.push("IBAN contratto (RID)");
          else if (!isValidIban(contractIban)) missing.push("IBAN contratto non valido");
        }
        if ((s.service === "LUCE" || s.service === "DUAL") && !s.pod?.trim()) {
          missing.push(`Servizio ${n}: POD`);
        }
        if ((s.service === "GAS" || s.service === "DUAL") && !s.pdr?.trim()) {
          missing.push(`Servizio ${n}: PDR`);
        }
      }
      if (missing.length) {
        setErrors([
          "Completa i campi evidenziati in giallo prima di salvare:",
          ...missing,
        ]);
        return;
      }
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

        // Carica gli stessi allegati su TUTTI i contratti (Luce, Gas, â€¦)
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
          // UNA sola email con anagrafica + tutti i blocchi servizio (Luce, Gas, â€¦)
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
        file,
        contentBase64: btoa(binary),
      });
    }
    setAttachments(next);
  }

  function applyOcrPayload(payload: OcrApplyPayload) {
    setCreatingClient(true);
    setClientId(undefined);
    setClientLabel(undefined);
    if (payload.clientType) setClientType(payload.clientType);
    if (payload.firstName != null) setFirstName(payload.firstName);
    if (payload.lastName != null) setLastName(payload.lastName);
    if (payload.companyName != null) setCompanyName(payload.companyName);
    if (payload.fiscalCode != null) setFiscalCode(payload.fiscalCode);
    if (payload.vatNumber != null) setVatNumber(payload.vatNumber);
    if (payload.phone != null) setPhone(payload.phone);
    if (payload.email != null) {
      setEmail(payload.email);
      setInvoiceEmail((prev) => prev || payload.email || "");
    }
    if (payload.pec != null) setPec(payload.pec);
    if (payload.iban != null) {
      setIban(payload.iban);
      contractIbanCustomized.current = false;
      setContractIban(payload.iban);
    }
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

  const clientIdentity =
    clientType === "AZIENDA"
      ? companyName.trim() || "Nuova azienda"
      : [lastName, firstName].filter((x) => x.trim()).join(" ") || "Nuovo cliente";
  const clientCf = (fiscalCode || vatNumber).trim();
  const classificationOptions = CLASSIFICATION_BY_CLIENT_TYPE[clientType];

  return (
    <div className="space-y-4 pb-24 sm:space-y-5 sm:pb-0">
      <DocumentAutoFillPanel
        canUseMistralOcr
        onApply={applyOcrPayload}
        onAttachFiles={(items) => {
          void attachOcrFiles(items);
        }}
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-end sm:p-4">
        {canPickCollaborator ? (
          <div className="min-w-0 flex-1">
            <Field label="Assegna a">
              <Select
                value={collaboratorId}
                onChange={(e) => setCollaboratorId(e.target.value)}
              >
                <option value={session.id}>{session.name} (tu)</option>
                {collaborators
                  .filter((u) => u.id !== session.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        ) : (
          <p className="flex-1 text-sm text-slate-600">
            Consulente: <strong>{session.name}</strong>
          </p>
        )}
        <button
          type="button"
          onClick={() => setSendToMaster((v) => !v)}
          aria-pressed={sendToMaster}
          className={[
            "flex min-h-14 w-full shrink-0 flex-col justify-center rounded-xl border-2 px-4 py-2 text-left transition sm:w-72",
            sendToMaster
              ? "border-emerald-700 bg-emerald-600 text-white"
              : "border-amber-400 bg-amber-300 text-amber-950 hover:bg-amber-200",
          ].join(" ")}
        >
          <span className="text-sm font-black uppercase tracking-wide">
            Invia al back office
          </span>
          <span className="text-xs font-semibold">
            {sendToMaster ? "Attivato" : "Clicca per attivare"}
          </span>
        </button>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <SectionTitle
          title="Anagrafica"
          description="Cerca un cliente già in archivio oppure compilane uno nuovo: resta salvato per le prossime ricontrattualizzazioni."
        />

        <div className="flex gap-2">
          {(["PRIVATO", "AZIENDA"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setClientType(type);
                setClassification("");
                setServices((all) =>
                  all.map((s) => ({
                    ...s,
                    contractKind: type === "PRIVATO" ? "Domestico" : "Non domestico",
                  })),
                );
              }}
              className={[
                "min-h-11 flex-1 rounded-xl border-2 px-3 text-sm font-bold",
                clientType === type
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {type === "PRIVATO" ? "Privato" : "Business"}
            </button>
          ))}
        </div>

        <AutocompleteSearch
          label="Cliente (cerca in anagrafica)"
          required
          placeholder="Scrivi cognome, nome o CF… es. Rossi Mario oppure RSSMRA…"
          endpoint="/api/clients/search"
          selectedLabel={clientLabel}
          createLabel="+ Crea nuovo cliente"
          helpText="Digita almeno 2 lettere: compare l’elenco Cognome Nome · CF. Seleziona una riga e i dati sotto si compilano da soli."
          onClear={() => {
            clearSelectedClient();
            setFirstName("");
            setLastName("");
            setCompanyName("");
            setFiscalCode("");
            setVatNumber("");
            setPhone("");
            setEmail("");
            setPec("");
            setIban("");
            setStreet("");
            setStreetNumber("");
            setZipCode("");
            setCity("");
            setProvince("");
            setRegion("");
            setLegalFirstName("");
            setLegalLastName("");
            setLegalFiscalCode("");
            setSdiCode("");
            setClassification("");
          }}
          onSelect={(item) => {
            void selectExistingClient(item);
          }}
          onCreate={(q) => {
            clearSelectedClient();
            const parsed = splitItalianPersonName(q);
            setFirstName(parsed.firstName);
            setLastName(parsed.lastName);
          }}
        />
        {clientId && !creatingClient ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
            Cliente già in anagrafica selezionato:{" "}
            <strong>nome, cognome, CF, telefono, email, indirizzo e IBAN</strong>{" "}
            sono stati caricati automaticamente. Controlla e completa solo ciò che
            manca (poi i servizi del contratto sotto).
          </p>
        ) : null}

        {clientId ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Anagrafica esistente caricata
            {clientCf ? <> · <span className="font-mono">{clientCf}</span></> : " · CF assente"}.
            Puoi usarla così com&apos;è o aggiornare i campi.
          </p>
        ) : creatingClient ? (
          <p className="text-xs text-slate-500">
            Verrà salvata in anagrafica al salvataggio del contratto.
          </p>
        ) : null}

        {clientType === "PRIVATO" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome" fillStatus={fillStatus(reqBase, Boolean(firstName.trim()))}>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Cognome" fillStatus={fillStatus(reqBase, Boolean(lastName.trim()))}>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Codice fiscale" fillStatus={fillStatus(reqBase, Boolean(fiscalCode.trim()))}>
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Cellulare" fillStatus={fillStatus(req, Boolean(phone.trim()))}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email" fillStatus={fillStatus(req, Boolean(email.trim()))}>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (!invoiceEmail || invoiceEmail === email) setInvoiceEmail(e.target.value);
                }}
              />
            </Field>
            <div className="md:col-span-2">
              <ExistingClientHints
                enabled={creatingClient && !clientId}
                query={
                  fiscalCode.trim().length >= 6
                    ? fiscalCode.trim()
                    : [lastName.trim(), firstName.trim()].filter(Boolean).join(" ")
                }
                onPick={(item) => {
                  void selectExistingClient(item);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Ragione sociale" fillStatus={fillStatus(reqBase, Boolean(companyName.trim()))}>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field
              label="Partita IVA"
              fillStatus={fillStatus(reqBase, Boolean(vatNumber.trim() || fiscalCode.trim()))}
            >
              <Input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
            </Field>
            <Field
              label="CF aziendale"
              fillStatus={fillStatus(reqBase, Boolean(vatNumber.trim() || fiscalCode.trim()))}
            >
              <Input value={fiscalCode} onChange={(e) => setFiscalCode(e.target.value)} />
            </Field>
            <Field label="Telefono" fillStatus={fillStatus(req, Boolean(phone.trim()))}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email" fillStatus={fillStatus(req, Boolean(email.trim()))}>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (!invoiceEmail || invoiceEmail === email) setInvoiceEmail(e.target.value);
                }}
              />
            </Field>
            <Field label="PEC">
              <Input value={pec} onChange={(e) => setPec(e.target.value)} />
            </Field>
            <Field
              label="Nome rappresentante"
              fillStatus={fillStatus(req, Boolean(legalFirstName.trim()))}
            >
              <Input value={legalFirstName} onChange={(e) => setLegalFirstName(e.target.value)} />
            </Field>
            <Field
              label="Cognome rappresentante"
              fillStatus={fillStatus(req, Boolean(legalLastName.trim()))}
            >
              <Input value={legalLastName} onChange={(e) => setLegalLastName(e.target.value)} />
            </Field>
            <Field label="CF rappresentante">
              <Input value={legalFiscalCode} onChange={(e) => setLegalFiscalCode(e.target.value)} />
            </Field>
            <Field label="Codice SDI">
              <Input value={sdiCode} onChange={(e) => setSdiCode(e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <ExistingClientHints
                enabled={creatingClient && !clientId}
                query={
                  (vatNumber.trim().length >= 5
                    ? vatNumber.trim()
                    : fiscalCode.trim().length >= 5
                      ? fiscalCode.trim()
                      : companyName.trim()) || ""
                }
                onPick={(item) => {
                  void selectExistingClient(item);
                }}
              />
            </div>
          </div>
        )}

        <CapAddressFields
          compact
          compactLabel={
            clientType === "AZIENDA" ? "Indirizzo sede legale" : "Indirizzo di residenza"
          }
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="IBAN (anagrafica)">
            <Input
              value={iban}
              onChange={(e) => updateAnagraficaIban(e.target.value)}
              placeholder="IT60X..."
            />
            <p className="mt-1 text-xs text-slate-500">
              Salvato in anagrafica cliente. Con RID, il contratto lo copia di default (modificabile
              sotto).
            </p>
          </Field>
          <Field label="Invio bolletta">
            <Select
              value={invoiceMode}
              onChange={(e) => setInvoiceMode(e.target.value as "MAIL" | "POSTA")}
            >
              <option value="MAIL">Mail</option>
              <option value="POSTA">Posta</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <SectionTitle
          title="Contratto"
          description="Solo i dati della pratica. Per un secondo servizio si ripetono questi campi, non l'anagrafica."
        />
        <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              Inserimento <strong>{formatItDate(registrationDate)}</strong>
              {" · "}
              ingresso <strong>{formatItDate(effectiveSupplyStart)}</strong>
              {" "}
              <span className="text-xs font-normal text-slate-500">(calcolato)</span>
            </p>
            <button
              type="button"
              className="text-xs font-semibold text-sky-800 hover:underline"
              onClick={() => setShowContractDates((v) => !v)}
            >
              {showContractDates ? "Nascondi date" : "Modifica date (opzionale)"}
            </button>
          </div>
          {showContractDates ? (
            <div className="mt-3 space-y-2">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Data inserimento">
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
                <Field label="Ingresso (calcolato)">
                  <Input
                    type="date"
                    value={customSupplyStart || format(computedSupplyStart, "yyyy-MM-dd")}
                    onChange={(e) => setCustomSupplyStart(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setCustomSupplyStart("")}
                    className="mt-1 text-xs font-semibold text-slate-600 hover:underline"
                  >
                    Ripristina calcolo automatico
                  </button>
                </Field>
                <Field label="Durata (mesi)">
                  <Input
                    type="number"
                    min={1}
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value) || 12)}
                  />
                </Field>
                <Field label="Scadenza">
                  <Input value={expiryPreview} readOnly className="bg-slate-50" />
                </Field>
              </div>
              <p className="text-xs text-slate-500">{describeSupplyStartRule(primaryOp)}</p>
            </div>
          ) : null}
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
            anagraficaIban={iban}
            contractIban={contractIban}
            onContractIbanChange={updateContractIban}
            clientEmail={email}
            residence={{
              street,
              streetNumber,
              zipCode,
              city,
              province,
              region,
            }}
            insertionDate={registrationDate}
            classification={idx === 0 ? classification : undefined}
            classificationOptions={idx === 0 ? classificationOptions : undefined}
            onClassificationChange={idx === 0 ? setClassification : undefined}
            highlightRequired={req}
            highlightBase={reqBase}
          />
        ))}
        <AddServiceButton onClick={addService} />

        {primaryRule ? (
          <p className="text-sm text-slate-600">
            Offerta listino: <strong>{primaryRule.name}</strong>
            {primaryRule.gettoneTotale ? ` · gettone ${euro(primaryRule.gettoneTotale)}` : ""}
            {hasMonthlyRecurrence ? ` · prima competenza ${firstRecurringLabel}` : ""}
            {" · "}
            {selectedCollaboratorName}
          </p>
        ) : null}

        {podMatches.length > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">POD/PDR già in archivio: ricontrattualizzazione</p>
            <ul className="mt-2 space-y-1">
              {podMatches.map((match) => (
                <li key={match.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {match.client} · {match.supplier} · {match.status}
                  </span>
                  <a href={`/contratti/${match.id}`} target="_blank" className="font-semibold text-sky-700 hover:underline">
                    Apri
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {supplyStartBeforeRegistration ? (
          <p className="text-sm font-medium text-amber-800">
            Attenzione: l&apos;ingresso è precedente alla data di inserimento.
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Note">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Note per il back office">
            <Textarea rows={3} value={masterNotes} onChange={(e) => setMasterNotes(e.target.value)} />
          </Field>
        </div>

        <ContractAttachmentsPanel
          attachments={attachments}
          onChange={setAttachments}
          requireDocs={req}
          clientType={clientType}
        />

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
            className="min-h-12 flex-[1.4] sm:min-h-12 sm:flex-none sm:px-8 sm:font-bold"
            disabled={pending}
            onClick={() => submit(false)}
          >
            {sendToMaster ? "Crea e invia al back office" : "Crea contratto"}
          </Button>
        </div>
      </section>
    </div>
  );
}
