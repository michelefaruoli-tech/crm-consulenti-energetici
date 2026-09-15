/**
 * Tipi condivisi (client + server) dell'import provvigioni guidato da mappatura.
 *
 * La mappatura è salvata a database su `ImportTemplate` come JSON: una nuova
 * fonte è una nuova mappatura, non un nuovo deploy.
 */

import type { PayoutDateFormat } from "@/lib/payout/normalize";

/** Campi riconosciuti dal motore. Il valore è una lettera di colonna o un'intestazione. */
export type PayoutColumnMap = {
  /** POD o PDR */
  pod?: string;
  /** Nome cliente in una sola colonna */
  clientName?: string;
  /** Nome e cognome su colonne separate (fogli compilati a mano) */
  clientFirstName?: string;
  clientLastName?: string;
  fiscalCode?: string;
  amount?: string;
  /** Colonne da sommare quando l'importo è una formula senza risultato */
  amountComponents?: string[];
  /** Colonna del mese di competenza */
  period?: string;
  /** Fornitore indicato nel file (fonti che ne mescolano diversi) */
  supplier?: string;
  /** Collaboratore indicato nel file: indizio, non verità */
  collaborator?: string;
  note?: string;
  /** Colonna di stato riga (es. «OK») */
  status?: string;
};

export type PayoutSheetMatch = {
  /** all = tutti i fogli · exact = un nome · regex = espressione sul nome */
  mode: "all" | "exact" | "regex";
  value?: string;
  /** Nomi (o frammenti) di fogli da ignorare, es. «riepilogo» */
  skip?: string[];
};

export type PayoutNumberFormat = {
  /**
   * Moltiplicatore di segno per foglio: gli storni arrivano positivi e vanno
   * invertiti. Il segno è dichiarato qui, mai dedotto dal codice.
   */
  sheetSign?: Record<string, number>;
  /** Inverte il segno di tutte le righe del file */
  invertAll?: boolean;
};

export type PayoutSkipRules = {
  /**
   * Alla prima riga di totale il foglio si chiude: risolve insieme i totali in
   * coda, quelli in mezzo ai dati e i blocchi compilati a mano sottostanti.
   */
  stopAtTotalRow?: boolean;
  /** Campi che devono essere valorizzati perché la riga sia un dato */
  requireColumns?: Array<keyof PayoutColumnMap>;
  /** Se valorizzato, la riga è valida solo con uno di questi stati */
  allowedStatus?: string[];
};

/** Da dove leggere il totale dichiarato dalla fonte, per la quadratura. */
export type PayoutDeclaredTotal = {
  mode: "none" | "label_lookup" | "sheet_cell" | "total_rows";
  sheet?: string;
  /** Etichetta da cercare in prima colonna (mode = label_lookup) */
  label?: string;
  /** Riferimento tipo «M5» (mode = sheet_cell) */
  cell?: string;
};

/** Mappatura completa, come vive dentro `ImportTemplate`. */
export type PayoutTemplateConfig = {
  sheetMatch: PayoutSheetMatch;
  /** 0 = rilevamento automatico nelle prime righe */
  headerRow: number;
  columnMap: PayoutColumnMap;
  numberFormat: PayoutNumberFormat;
  dateFormat: PayoutDateFormat;
  skipRules: PayoutSkipRules;
  declaredTotal: PayoutDeclaredTotal;
};

/** Riga letta dal file, prima del matching. */
export type ParsedPayoutRow = {
  sheetName: string;
  rowIndex: number;
  /** Riga originale: intestazione → valore testuale */
  raw: Record<string, string>;
  podRaw: string;
  podKeys: string[];
  podMaskedSuffix: string;
  clientNameRaw: string;
  personKeys: string[];
  fiscalKey: string;
  supplierHint: string;
  collaboratorHint: string;
  amount: number | null;
  period: string | null;
  note: string;
};

export type ParsePayoutResult =
  | {
      ok: true;
      rows: ParsedPayoutRow[];
      /** Somma degli importi letti */
      computedTotal: number;
      /** Totale dichiarato dalla fonte, se estraibile */
      declaredTotal: number | null;
      sheetsRead: string[];
      /** Righe scartate con il motivo, per capire una mappatura sbagliata */
      skipped: Array<{ sheetName: string; rowIndex: number; reason: string }>;
    }
  | { ok: false; error: string; missingColumns?: string[] };
