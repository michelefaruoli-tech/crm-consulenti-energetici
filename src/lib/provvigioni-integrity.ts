/**
 * Controllo integrità provvigioni — Fase 1 (solo lettura).
 *
 * Regole di riferimento: docs/regole-provvigioni.md e docs/regola-helios-lag.md.
 * "Nessuna riga deve saltare: ogni contratto salvato deve avere le righe che
 * le regole prevedono, né più né meno."
 *
 * Questo file contiene solo funzioni pure (nessuna chiamata a Prisma): dato
 * un contratto già caricato, dicono se è in regola o no. Il caricamento dal
 * database vive in `provvigioni-integrity-scan.ts`. Le funzioni di
 * "missing rows" e "extra rows fuori intervallo" sono già corrette e testate
 * altrove (`recurring-backfill.ts`, `recurring-cleanup.ts`): qui si aggiunge
 * solo quello che manca — rate create in anticipo e repliche non archiviate.
 */
import {
  isRecurringAnnual,
  isRecurringMonthly,
  toPeriod,
} from "@/lib/recurring";
import {
  lastGeneratedPeriod,
  recurringWindow,
  type RecurringWindowContract,
} from "@/lib/recurring-window";
import { recurringGenerationLagMonths } from "@/lib/helios-contract-rules";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import {
  keepBothWhileInStorno,
  keepMonthlyRecurringUntilNewSupply,
} from "@/lib/contract-pod-archive";
import { normalizePodKey } from "@/lib/storno-status";

export type EarlyRecurringRow = {
  id: string;
  period: string;
  status: string;
};

type RecurringMonthLite = {
  id: string;
  period: string;
  status: string;
  paidAt?: Date | null;
  settledPeriod?: string | null;
  note?: string | null;
};

/**
 * Rate mensili (M) presenti a database più in là dell'ultimo mese generabile
 * (finestra fornitura + ritardo Helios M+2), ancora senza incasso. Regola:
 * "crea la riga solo nel mese in cui deve essere pagata, non prima".
 * Non segnala mai una rata con incasso/rendiconto: quella non si tocca.
 */
export function findEarlyMonthlyRows<
  T extends RecurringWindowContract & {
    recurrence: string | null;
    status: string | null;
    supplier: { name: string } | null;
    recurringMonths: RecurringMonthLite[];
  },
>(contract: T, now: Date = new Date()): EarlyRecurringRow[] {
  if (!isRecurringMonthly(contract.recurrence)) return [];
  if (contract.status === "ANNULLATO" || contract.status === "KO") return [];

  const window = recurringWindow(contract, now);
  const lastPeriod = lastGeneratedPeriod(
    window,
    now,
    recurringGenerationLagMonths(contract.supplier?.name),
  );

  return contract.recurringMonths
    .filter((row) => row.period > lastPeriod)
    .filter((row) => row.status === "PENDING" || row.status === "MISSING")
    .filter((row) => !row.paidAt && !row.settledPeriod)
    .map((row) => ({ id: row.id, period: row.period, status: row.status }));
}

/**
 * Riga annuale (R) della competenza successiva creata prima del 13° mese:
 * periodo futuro (non ancora arrivato), senza incasso. Prima di questo fix
 * PR #18 la creava subito all'incasso nascosta in storno — righe così
 * restano a database finché l'amministratore non le bonifica da Backup
 * (mai automaticamente, vedi `syncAnnualPeriods` in recurring-sync.ts).
 */
export function findEarlyAnnualRows<
  T extends {
    recurrence: string | null;
    recurringMonths: RecurringMonthLite[];
  },
>(contract: T, now: Date = new Date()): EarlyRecurringRow[] {
  if (!isRecurringAnnual(contract.recurrence)) return [];
  const nowPeriod = toPeriod(now);

  return contract.recurringMonths
    .filter((row) => row.period > nowPeriod)
    .filter((row) => row.status === "PENDING" || row.status === "MISSING")
    .filter((row) => !row.paidAt && !row.settledPeriod)
    .map((row) => ({ id: row.id, period: row.period, status: row.status }));
}

/**
 * Più righe `RecurringMonth` per lo stesso contratto+periodo. Il vincolo
 * `@@unique([contractId, period])` a schema dovrebbe impedirlo: controllo
 * difensivo per SQL grezzo storico o import diretti.
 */
export function findDuplicateRecurringPeriods(
  recurringMonths: Array<{ id: string; period: string }>,
): Array<{ period: string; ids: string[] }> {
  const byPeriod = new Map<string, string[]>();
  for (const row of recurringMonths) {
    const arr = byPeriod.get(row.period) ?? [];
    arr.push(row.id);
    byPeriod.set(row.period, arr);
  }
  return [...byPeriod.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([period, ids]) => ({ period, ids }));
}

const KO_LIKE = new Set(["KO", "ANNULLATO", "CHIUSO"]);

export type PodDuplicateContract = {
  id: string;
  contractNumber: string;
  clientId: string;
  supplierId: string;
  podPdr: string | null;
  pod: string | null;
  pdr: string | null;
  supplyStartDate: Date | null;
  insertionDate: Date | null;
  createdAt: Date;
  operationType: string | null;
  recurrence: string | null;
  status: string;
  isHistorical: boolean;
  deletedAt: Date | null;
  archiveLabel: string | null;
  stornoEndDate: Date | null;
  supplier: { stornoMonths: number | null };
  collaborator: { name: string };
  client: {
    type: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
};

export type PodDuplicateFinding = {
  podKey: string;
  latest: { contractId: string; contractNumber: string; label: string };
  /** Contratti "vecchi" sullo stesso POD non gestiti secondo la regola (né in storno, né archiviati, né mensile in attesa). */
  unhandled: Array<{
    contractId: string;
    contractNumber: string;
    label: string;
    reason: "fuori_storno_non_archiviato" | "mensile_da_chiudere";
  }>;
};

function contractLabelForPod(c: PodDuplicateContract): string {
  const name =
    c.client.type === "AZIENDA"
      ? c.client.companyName ?? "—"
      : [c.client.firstName, c.client.lastName].filter(Boolean).join(" ") || "—";
  return `${name} · ${c.collaborator.name} · #${c.contractNumber}`;
}

/**
 * Contratti replicati sullo stesso POD/PDR dove il/i contratto/i precedente/i
 * NON risultano gestiti secondo la regola "una tantum replicata": in storno
 * → resta così com'è (nessuna azione), fuori storno → va archiviato;
 * ricorrente mensile → resta attivo solo fino all'ingresso in fornitura del
 * nuovo, poi va chiuso.
 *
 * Raggruppa per POD/PDR da solo (non per cliente+fornitore): stessa chiave
 * usata davvero da `archiveSupersededPodContracts` / `archiveOlderForContractPods`
 * (un POD è un punto di fornitura fisico, può cambiare fornitore con uno
 * switch). Usa le stesse funzioni pure di `contract-pod-archive.ts` che
 * decidono l'esito reale, così l'anteprima non può divergere dall'applicazione.
 */
export function findPodDuplicateAnomalies(
  contracts: PodDuplicateContract[],
  now: Date = new Date(),
): PodDuplicateFinding[] {
  type Scored = PodDuplicateContract & {
    podKey: string;
    score: number;
    supplyResolved: Date;
  };
  const scored: Scored[] = [];
  for (const c of contracts) {
    if (c.deletedAt) continue;
    const podKey = normalizePodKey(c.podPdr || c.pod || c.pdr);
    if (!podKey || podKey.length < 6) continue;
    const supplyResolved =
      c.supplyStartDate ??
      computeSupplyStartDate(c.insertionDate ?? c.createdAt, c.operationType);
    const supply = supplyResolved.getTime();
    const insert = c.insertionDate?.getTime() ?? 0;
    const created = c.createdAt.getTime();
    scored.push({
      ...c,
      podKey,
      score: supply * 1e6 + insert * 1e3 + created,
      supplyResolved,
    });
  }

  const byKey = new Map<string, Scored[]>();
  for (const s of scored) {
    const list = byKey.get(s.podKey) ?? [];
    list.push(s);
    byKey.set(s.podKey, list);
  }

  const findings: PodDuplicateFinding[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const latest = sorted[0]!;
    const unhandled: PodDuplicateFinding["unhandled"] = [];

    for (const older of sorted.slice(1)) {
      if (older.id === latest.id) continue;
      if (older.isHistorical) continue; // già archiviato (o comunque fuori vista attiva)
      if (KO_LIKE.has(older.status)) continue; // già chiuso: gestito

      if (
        keepBothWhileInStorno({
          supplyStartDate: older.supplyStartDate ?? older.supplyResolved,
          stornoEndDate: older.stornoEndDate,
          stornoMonths: older.supplier.stornoMonths,
          now,
        })
      ) {
        continue; // in storno: corretto lasciarlo così
      }

      if (
        keepMonthlyRecurringUntilNewSupply({
          olderRecurrence: older.recurrence,
          newerSupplyStart: latest.supplyResolved,
          now,
        })
      ) {
        continue; // mensile in attesa dell'ingresso fornitura del nuovo: corretto
      }

      unhandled.push({
        contractId: older.id,
        contractNumber: older.contractNumber,
        label: contractLabelForPod(older),
        reason: isRecurringMonthly(older.recurrence)
          ? "mensile_da_chiudere"
          : "fuori_storno_non_archiviato",
      });
    }

    if (unhandled.length > 0) {
      findings.push({
        podKey: key,
        latest: {
          contractId: latest.id,
          contractNumber: latest.contractNumber,
          label: contractLabelForPod(latest),
        },
        unhandled,
      });
    }
  }
  return findings;
}

/** Somma `amount` delle righe con lo stato indicato (confronto totali). */
export function sumRowsForStato(
  rows: Array<{ stato: string; amount: string }>,
  stato: string,
): number {
  return rows
    .filter((r) => r.stato === stato)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

export type TotalsConsistencyResult = {
  stato: string;
  declaredAmount: number;
  rowsAmount: number;
  diff: number;
  ok: boolean;
};

/**
 * Confronta il totale "dichiarato" (card / dashboard, via
 * `sumExpandedAmountForStato`) con la somma indipendente delle righe visibili
 * (via `expandContractsToProvvigioneRows`). Devono coincidere: se non
 * coincidono c'è un bug nel codice, non un dato da correggere.
 */
export function compareTotals(
  stato: string,
  declaredAmount: number,
  rowsAmount: number,
  toleranceEuro = 0.01,
): TotalsConsistencyResult {
  const diff = Math.round((declaredAmount - rowsAmount) * 100) / 100;
  return {
    stato,
    declaredAmount,
    rowsAmount,
    diff,
    ok: Math.abs(diff) <= toleranceEuro,
  };
}
