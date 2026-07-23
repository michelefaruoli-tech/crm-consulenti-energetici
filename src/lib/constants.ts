export type AppRole = "ADMIN" | "SEGRETERIA" | "COLLABORATORE" | "COMMERCIALE";

export type AppContractStatus =
  | "BOZZA"
  | "INSERITO"
  | "DOCUMENTAZIONE_INCOMPLETA"
  | "DOCUMENTAZIONE_COMPLETA"
  | "INVIATO_AL_FORNITORE"
  | "DA_LAVORARE"
  | "INVIATO_AL_MASTER"
  | "ERRORE_INVIO"
  | "IN_LAVORAZIONE"
  | "ATTIVATO"
  | "IN_ATTESA_PAGAMENTO"
  | "PAGATO_DAL_FORNITORE"
  | "PROVVIGIONE_LIQUIDATA"
  | "COMPLETATO"
  | "CHIUSO"
  | "ANNULLATO";

export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Amministratore",
  SEGRETERIA: "Segreteria",
  COLLABORATORE: "Collaboratore",
  COMMERCIALE: "Commerciale",
};

export const CONTRACT_STATUS_LABELS: Record<AppContractStatus, string> = {
  BOZZA: "Bozza",
  INSERITO: "Salvato",
  DOCUMENTAZIONE_INCOMPLETA: "Documentazione incompleta",
  DOCUMENTAZIONE_COMPLETA: "Documentazione completa",
  INVIATO_AL_FORNITORE: "Inviato al fornitore",
  DA_LAVORARE: "Da lavorare",
  INVIATO_AL_MASTER: "Inviato al Master",
  ERRORE_INVIO: "Errore invio",
  IN_LAVORAZIONE: "In lavorazione",
  ATTIVATO: "Attivato",
  IN_ATTESA_PAGAMENTO: "In attesa di pagamento",
  PAGATO_DAL_FORNITORE: "Pagato dal fornitore",
  PROVVIGIONE_LIQUIDATA: "Provvigione liquidata",
  COMPLETATO: "Completato",
  CHIUSO: "Chiuso",
  ANNULLATO: "Annullato",
};

export const MASTER_EMAIL = "michele.faruoli@gmail.com";

export const SERVICE_OPTIONS = [
  { value: "LUCE", label: "Luce" },
  { value: "GAS", label: "Gas" },
  { value: "TELEFONIA", label: "Telefonia" },
  { value: "POS", label: "POS" },
  { value: "FOTOVOLTAICO", label: "Fotovoltaico" },
  { value: "ALTRO", label: "Altro" },
] as const;

export const OPERATION_OPTIONS = [
  { value: "SWITCH", label: "Switch / Cambio" },
  { value: "VOLTURA", label: "Voltura" },
  { value: "ATTIVAZIONE", label: "Attivazione" },
  { value: "SUBENTRO", label: "Subentro" },
  { value: "NUOVA_ATTIVAZIONE", label: "Nuova attivazione" },
  { value: "RINNOVO", label: "Rinnovo" },
  { value: "ALTRO", label: "Altro" },
] as const;

export const PAYMENT_METHOD_OPTIONS = [
  { value: "BOLLETTINO", label: "Bollettino" },
  { value: "RID", label: "RID / addebito diretto" },
  { value: "BONIFICO", label: "Bonifico" },
  { value: "CARTA", label: "Carta" },
  { value: "ALTRO", label: "Altro" },
] as const;

export const DOC_TYPE_OPTIONS = [
  { value: "CI_FRONTE", label: "Documento identità fronte" },
  { value: "CI_RETRO", label: "Documento identità retro" },
  { value: "CF_TS", label: "Codice fiscale / tessera sanitaria" },
  { value: "BOLLETTA", label: "Ultima fattura / bolletta" },
  { value: "VISURA", label: "Visura camerale" },
  { value: "DOC_AMM", label: "Documento amministratore" },
  { value: "MODULO", label: "Modulo firmato" },
  { value: "SEPA", label: "Mandato SEPA" },
  { value: "ALTRO", label: "Altro allegato" },
] as const;

export const CONTRACT_STATUS_FLOW: AppContractStatus[] = [
  "BOZZA",
  "INSERITO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "DOCUMENTAZIONE_COMPLETA",
  "INVIATO_AL_FORNITORE",
  "IN_LAVORAZIONE",
  "ATTIVATO",
  "IN_ATTESA_PAGAMENTO",
  "PAGATO_DAL_FORNITORE",
  "PROVVIGIONE_LIQUIDATA",
  "CHIUSO",
];

export const STATUS_COLORS: Record<AppContractStatus, string> = {
  BOZZA: "bg-slate-100 text-slate-700",
  INSERITO: "bg-blue-100 text-blue-800",
  DOCUMENTAZIONE_INCOMPLETA: "bg-amber-100 text-amber-800",
  DOCUMENTAZIONE_COMPLETA: "bg-teal-100 text-teal-800",
  INVIATO_AL_FORNITORE: "bg-indigo-100 text-indigo-800",
  DA_LAVORARE: "bg-amber-100 text-amber-900",
  INVIATO_AL_MASTER: "bg-sky-100 text-sky-900",
  ERRORE_INVIO: "bg-red-100 text-red-800",
  IN_LAVORAZIONE: "bg-purple-100 text-purple-800",
  ATTIVATO: "bg-green-100 text-green-800",
  IN_ATTESA_PAGAMENTO: "bg-orange-100 text-orange-800",
  PAGATO_DAL_FORNITORE: "bg-emerald-100 text-emerald-800",
  PROVVIGIONE_LIQUIDATA: "bg-cyan-100 text-cyan-800",
  COMPLETATO: "bg-emerald-100 text-emerald-900",
  CHIUSO: "bg-gray-100 text-gray-700",
  ANNULLATO: "bg-red-100 text-red-800",
};

export const PAYMENT_TYPE_LABELS = {
  MENSILE: "Pagamento mensile",
  UNA_TANTUM: "Una tantum",
  RATEIZZATO: "Rateizzato",
  BONUS: "Bonus",
  PREMIO: "Premio",
} as const;
