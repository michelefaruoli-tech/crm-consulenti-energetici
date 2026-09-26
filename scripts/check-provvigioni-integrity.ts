/**
 * Verifica del controllo integrità provvigioni (senza database): rate
 * mensili/annuali in anticipo, repliche POD non gestite, duplicati e
 * confronto totali. Vedi docs/regole-provvigioni.md.
 *
 * Uso: npx tsx scripts/check-provvigioni-integrity.ts
 */
import {
  compareTotals,
  findDuplicateRecurringPeriods,
  findEarlyAnnualRows,
  findEarlyMonthlyRows,
  findPodDuplicateAnomalies,
  sumRowsForStato,
  type PodDuplicateContract,
} from "../src/lib/provvigioni-integrity";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

const now = new Date(2026, 8, 15); // 15 settembre 2026

console.log("\n• Rate mensili (M) create in anticipo rispetto al mese dovuto");
{
  type Contract = Parameters<typeof findEarlyMonthlyRows>[0];
  const base: Omit<Contract, "recurringMonths"> = {
    recurrence: "M",
    status: "ATTIVATO",
    insertionDate: new Date(2026, 0, 1),
    supplyStartDate: new Date(2026, 0, 1),
    operationType: "CAMBIO",
    expiryDate: null,
    supplier: { name: "Sorgenia Business" },
    statusHistory: [],
  };
  const contract: Contract = {
    ...base,
    recurringMonths: [
      { id: "r1", period: "2026-07", status: "PAID" },
      { id: "r2", period: "2026-08", status: "PENDING" },
      // Ottobre non è ancora generabile a settembre (non Helios): è in anticipo.
      { id: "r3", period: "2026-10", status: "PENDING" },
    ],
  };
  check(
    "solo ottobre è in anticipo (agosto è il mese corrente, ammesso)",
    findEarlyMonthlyRows(contract, now).map((r) => r.period),
    ["2026-10"],
  );
}

console.log("\n• Helios: il ritardo M+2 resta, non è \"anticipo\"");
{
  type Contract = Parameters<typeof findEarlyMonthlyRows>[0];
  const contract: Contract = {
    recurrence: "M",
    status: "ATTIVATO",
    insertionDate: new Date(2026, 0, 1),
    supplyStartDate: new Date(2026, 0, 1),
    operationType: "CAMBIO",
    expiryDate: null,
    supplier: { name: "Helios" },
    statusHistory: [],
    recurringMonths: [
      { id: "r1", period: "2026-07", status: "PENDING" }, // ultimo generabile a settembre
    ],
  };
  check(
    "luglio è l'ultimo mese generabile (settembre − 2): non è in anticipo",
    findEarlyMonthlyRows(contract, now),
    [],
  );
}

console.log("\n• Rata mensile con incasso non è mai segnalata (anche se il periodo è futuro)");
{
  type Contract = Parameters<typeof findEarlyMonthlyRows>[0];
  const contract: Contract = {
    recurrence: "M",
    status: "ATTIVATO",
    insertionDate: new Date(2026, 0, 1),
    supplyStartDate: new Date(2026, 0, 1),
    operationType: "CAMBIO",
    expiryDate: null,
    supplier: { name: "Sorgenia Business" },
    statusHistory: [],
    recurringMonths: [
      { id: "r1", period: "2026-12", status: "PAID", paidAt: new Date(2026, 8, 1) },
    ],
  };
  check("rata PAID futura ignorata", findEarlyMonthlyRows(contract, now), []);
}

console.log("\n• Riga annuale (R) creata prima del 13° mese");
{
  type Contract = Parameters<typeof findEarlyAnnualRows>[0];
  const contract: Contract = {
    recurrence: "R",
    recurringMonths: [
      // Nota "legacy" PR #18: creata subito all'incasso, periodo futuro.
      { id: "a1", period: "2027-05", status: "PENDING", note: "Nascosta: in attesa di fine storno" },
    ],
  };
  check(
    "periodo futuro (2027-05, oggi settembre 2026): è in anticipo",
    findEarlyAnnualRows(contract, now).map((r) => r.id),
    ["a1"],
  );
}
{
  type Contract = Parameters<typeof findEarlyAnnualRows>[0];
  const contractDue: Contract = {
    recurrence: "R",
    recurringMonths: [{ id: "a2", period: "2026-09", status: "MISSING" }],
  };
  check(
    "periodo già arrivato (mese corrente): non è in anticipo",
    findEarlyAnnualRows(contractDue, now),
    [],
  );
}

console.log("\n• Righe duplicate stesso mese (difensivo, il DB dovrebbe impedirlo)");
check(
  "nessun duplicato",
  findDuplicateRecurringPeriods([
    { id: "1", period: "2026-07" },
    { id: "2", period: "2026-08" },
  ]),
  [],
);
check(
  "due righe sullo stesso periodo: segnalato",
  findDuplicateRecurringPeriods([
    { id: "1", period: "2026-07" },
    { id: "2", period: "2026-07" },
    { id: "3", period: "2026-08" },
  ]),
  [{ period: "2026-07", ids: ["1", "2"] }],
);

console.log("\n• Repliche POD non gestite (in storno / fuori storno / mensile in attesa)");
{
  const client = { type: "PRIVATO", companyName: null, firstName: "Mario", lastName: "Rossi" };
  const collaborator = { name: "Collab" };
  const base: Omit<
    PodDuplicateContract,
    "id" | "contractNumber" | "supplyStartDate" | "insertionDate" | "createdAt" | "recurrence" | "status" | "isHistorical" | "archiveLabel" | "stornoEndDate"
  > = {
    clientId: "cl1",
    supplierId: "sup1",
    podPdr: "IT001E123456",
    pod: null,
    pdr: null,
    operationType: "CAMBIO",
    deletedAt: null,
    supplier: { stornoMonths: 12 },
    collaborator,
    client,
  };

  console.log("  - fuori storno, non archiviato: anomalia");
  {
    const older: PodDuplicateContract = {
      ...base,
      id: "old1",
      contractNumber: "1",
      supplyStartDate: new Date(2024, 0, 1),
      insertionDate: new Date(2024, 0, 1),
      createdAt: new Date(2024, 0, 1),
      recurrence: "Una tantum",
      status: "PAGATO_DAL_FORNITORE",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: new Date(2025, 0, 1), // storno finito da tempo
    };
    const latest: PodDuplicateContract = {
      ...base,
      id: "new1",
      contractNumber: "2",
      supplyStartDate: new Date(2026, 5, 1),
      insertionDate: new Date(2026, 5, 1),
      createdAt: new Date(2026, 5, 1),
      recurrence: "Una tantum",
      status: "ATTIVATO",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: null,
    };
    const findings = findPodDuplicateAnomalies([older, latest], now);
    check("una anomalia trovata", findings.length, 1);
    check("il vecchio è segnalato", findings[0]?.unhandled[0]?.contractId, "old1");
    check("motivo: fuori storno non archiviato", findings[0]?.unhandled[0]?.reason, "fuori_storno_non_archiviato");
  }

  console.log("  - in storno: NESSUNA anomalia (corretto lasciarlo così)");
  {
    const older: PodDuplicateContract = {
      ...base,
      id: "old2",
      contractNumber: "3",
      supplyStartDate: new Date(2026, 6, 1), // luglio 2026 + 12 mesi storno → luglio 2027
      insertionDate: new Date(2026, 6, 1),
      createdAt: new Date(2026, 6, 1),
      recurrence: "Una tantum",
      status: "PAGATO_DAL_FORNITORE",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: null,
    };
    const latest: PodDuplicateContract = {
      ...base,
      id: "new2",
      contractNumber: "4",
      supplyStartDate: new Date(2026, 7, 1),
      insertionDate: new Date(2026, 7, 1),
      createdAt: new Date(2026, 7, 1),
      recurrence: "Una tantum",
      status: "ATTIVATO",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: null,
    };
    check("nessuna anomalia: ancora in storno", findPodDuplicateAnomalies([older, latest], now), []);
  }

  console.log("  - già archiviato correttamente: NESSUNA anomalia");
  {
    const older: PodDuplicateContract = {
      ...base,
      id: "old3",
      contractNumber: "5",
      supplyStartDate: new Date(2024, 0, 1),
      insertionDate: new Date(2024, 0, 1),
      createdAt: new Date(2024, 0, 1),
      recurrence: "Una tantum",
      status: "KO",
      isHistorical: true,
      archiveLabel: "POD ricontrattualizzato",
      stornoEndDate: new Date(2025, 0, 1),
    };
    const latest: PodDuplicateContract = {
      ...base,
      id: "new3",
      contractNumber: "6",
      supplyStartDate: new Date(2026, 5, 1),
      insertionDate: new Date(2026, 5, 1),
      createdAt: new Date(2026, 5, 1),
      recurrence: "Una tantum",
      status: "ATTIVATO",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: null,
    };
    check(
      "nessuna anomalia: il vecchio è già isHistorical/archiveLabel",
      findPodDuplicateAnomalies([older, latest], now),
      [],
    );
  }

  console.log("  - mensile ricorrente in attesa del nuovo ingresso fornitura: NESSUNA anomalia");
  {
    const older: PodDuplicateContract = {
      ...base,
      id: "old4",
      contractNumber: "7",
      supplyStartDate: new Date(2024, 0, 1),
      insertionDate: new Date(2024, 0, 1),
      createdAt: new Date(2024, 0, 1),
      recurrence: "M",
      status: "ATTIVATO",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: new Date(2025, 0, 1),
    };
    const latest: PodDuplicateContract = {
      ...base,
      id: "new4",
      contractNumber: "8",
      supplyStartDate: new Date(2027, 0, 1), // ingresso nuovo ancora nel futuro
      insertionDate: new Date(2026, 5, 1),
      createdAt: new Date(2026, 5, 1),
      recurrence: "M",
      status: "ATTIVATO",
      isHistorical: false,
      archiveLabel: null,
      stornoEndDate: null,
    };
    check(
      "nessuna anomalia: mensile resta attivo fino al nuovo ingresso",
      findPodDuplicateAnomalies([older, latest], now),
      [],
    );
  }
}

console.log("\n• Confronto totali: card vs somma indipendente delle righe");
check(
  "somma righe corretta per stato",
  sumRowsForStato(
    [
      { stato: "Da incassare", amount: "32" },
      { stato: "Da incassare", amount: "32" },
      { stato: "Incassato", amount: "50" },
    ],
    "Da incassare",
  ),
  64,
);
check(
  "coincidono → ok",
  compareTotals("Da incassare", 64, 64).ok,
  true,
);
check(
  "non coincidono → segnalato (bug di codice, non dato da correggere)",
  compareTotals("Da incassare", 64, 0).ok,
  false,
);
check(
  "differenza calcolata correttamente",
  compareTotals("Da incassare", 64, 0).diff,
  64,
);

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} verifiche fallite.`);
  process.exit(1);
}
console.log("✅ Controllo integrità provvigioni: tutte le verifiche superate.");
