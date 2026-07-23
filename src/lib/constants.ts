import { ContractStatus, Role } from "@/generated/prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Amministratore",
  SEGRETERIA: "Segreteria",
  COLLABORATORE: "Collaboratore",
  COMMERCIALE: "Commerciale",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  BOZZA: "Bozza",
  INSERITO: "Inserito",
  DOCUMENTAZIONE_INCOMPLETA: "Documentazione incompleta",
  DOCUMENTAZIONE_COMPLETA: "Documentazione completa",
  INVIATO_AL_FORNITORE: "Inviato al fornitore",
  IN_LAVORAZIONE: "In lavorazione",
  ATTIVATO: "Attivato",
  IN_ATTESA_PAGAMENTO: "In attesa di pagamento",
  PAGATO_DAL_FORNITORE: "Pagato dal fornitore",
  PROVVIGIONE_LIQUIDATA: "Provvigione liquidata",
  CHIUSO: "Chiuso",
  ANNULLATO: "Annullato",
};

export const CONTRACT_STATUS_FLOW: ContractStatus[] = [
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

export const STATUS_COLORS: Record<ContractStatus, string> = {
  BOZZA: "bg-slate-100 text-slate-700",
  INSERITO: "bg-blue-100 text-blue-800",
  DOCUMENTAZIONE_INCOMPLETA: "bg-amber-100 text-amber-800",
  DOCUMENTAZIONE_COMPLETA: "bg-teal-100 text-teal-800",
  INVIATO_AL_FORNITORE: "bg-indigo-100 text-indigo-800",
  IN_LAVORAZIONE: "bg-purple-100 text-purple-800",
  ATTIVATO: "bg-green-100 text-green-800",
  IN_ATTESA_PAGAMENTO: "bg-orange-100 text-orange-800",
  PAGATO_DAL_FORNITORE: "bg-emerald-100 text-emerald-800",
  PROVVIGIONE_LIQUIDATA: "bg-cyan-100 text-cyan-800",
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
