/**
 * Classificazione riga anteprima Compara → azione UI/apply.
 *
 * «Da aggiornare» solo se serve davvero portare lo stato a Incassato da
 * liquidare o riempire un dato mancante (es. POD CRM vuoto).
 * Se la rata è già PAID/Incassato e il POD coincide (o non c’è nulla da
 * scrivere), → already_ok: checkbox spenta, nessuna sovrascrittura.
 * Una differenza di importo regola vs gettone file NON basta.
 */

import { isRecurringMonthly } from "@/lib/recurring";
import type { ComparaAgostoAction } from "@/lib/compara-agosto/view-types";

export type ComparaClassifyFinance = {
  recurrence: string | null;
  status: string;
  paymentStatus: string | null;
  commissionPaid: number;
  recurringByPeriod: Map<
    string,
    { id: string; status: string; amount: number | null }
  >;
};

export type ComparaClassifyInput = {
  hasContract: boolean;
  finance: ComparaClassifyFinance | undefined;
  competencePeriod: string;
  ambiguous: boolean;
  /** POD file ≠ CRM (o match ambiguo con scrittura POD). */
  podNeedsConfirm: boolean;
  /** File ha POD/PDR e CRM è vuoto → fill utile. */
  podNeedsFill: boolean;
  /**
   * POD ok per non toccare: uguale file/CRM, oppure file senza POD
   * (niente da scrivere) con CRM già valorizzato o irrilevante.
   */
  podAlreadyOk: boolean;
  amount: number | null;
};

export type ComparaClassifyResult = {
  action: ComparaAgostoAction;
  skipReason: string | null;
  existingLiquidatedAmount: number | null;
};

export function classifyComparaAgostoAction(
  params: ComparaClassifyInput,
): ComparaClassifyResult {
  if (!params.hasContract) {
    return {
      action: "unmatched",
      skipReason: "Nessun contratto per nominativo/POD",
      existingLiquidatedAmount: null,
    };
  }
  if (params.amount == null) {
    return {
      action: "confirm",
      skipReason: "Importo non determinabile",
      existingLiquidatedAmount: null,
    };
  }
  if (params.ambiguous || params.podNeedsConfirm) {
    return {
      action: "confirm",
      skipReason: params.podNeedsConfirm
        ? "POD/nominativo da confermare (Michele)"
        : "Match da confermare (Michele)",
      existingLiquidatedAmount: null,
    };
  }

  const fin = params.finance;
  if (!fin) {
    return {
      action: "create",
      skipReason: null,
      existingLiquidatedAmount: null,
    };
  }

  if (isRecurringMonthly(fin.recurrence)) {
    const month = fin.recurringByPeriod.get(params.competencePeriod);
    if (month?.status === "LIQUIDATED") {
      return {
        action: "skip_liquidated",
        skipReason: "Rata già liquidata: importo non sovrascritto",
        existingLiquidatedAmount: month.amount,
      };
    }
    if (!month) {
      return {
        action: "create",
        skipReason: null,
        existingLiquidatedAmount: null,
      };
    }
    if (month.status === "PAID") {
      // Già Incassato da liquidare: non sovrascrivere importo/etichetta/collab
      // solo perché la regola (es. 60) ≠ gettone file (es. 75).
      if (params.podNeedsFill) {
        return {
          action: "update",
          skipReason:
            "Già Incassato da liquidare: manca POD in CRM (proposta fill)",
          existingLiquidatedAmount: null,
        };
      }
      return {
        action: "already_ok",
        skipReason: params.podAlreadyOk
          ? "Già Incassato da liquidare e POD ok — nessuna sovrascrittura"
          : "Già Incassato da liquidare — nessuna sovrascrittura",
        existingLiquidatedAmount: month.amount,
      };
    }
    // Altro stato (es. EXPECTED / ACCRUED): va portata a Incassato da liquidare
    return {
      action: "update",
      skipReason: null,
      existingLiquidatedAmount: null,
    };
  }

  // Una tantum
  if (
    fin.status === "PROVVIGIONE_LIQUIDATA" ||
    (fin.commissionPaid > 0 && fin.paymentStatus === "Pagato")
  ) {
    return {
      action: "skip_liquidated",
      skipReason: "Provvigione già liquidata: non sovrascrivere",
      existingLiquidatedAmount: fin.commissionPaid,
    };
  }
  if (
    fin.paymentStatus === "Incassato" ||
    fin.status === "PAGATO_DAL_FORNITORE"
  ) {
    if (params.podNeedsFill) {
      return {
        action: "update",
        skipReason: "Già Incassato da liquidare: manca POD in CRM (proposta fill)",
        existingLiquidatedAmount: null,
      };
    }
    return {
      action: "already_ok",
      skipReason:
        "Già Incassato da liquidare e POD ok — nessuna sovrascrittura",
      existingLiquidatedAmount: null,
    };
  }
  return {
    action: "create",
    skipReason: null,
    existingLiquidatedAmount: null,
  };
}
