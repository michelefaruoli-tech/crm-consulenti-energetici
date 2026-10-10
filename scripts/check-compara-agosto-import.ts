/**
 * Import Compara Agosto — regole importo, periodi, POD fill Fagiano, parse file.
 * Uso: npx tsx scripts/check-compara-agosto-import.ts
 *
 * Il fixture in `scripts/fixtures/` è la fonte obbligatoria per CI/Vercel.
 * Se è presente anche COMPARA_AGOSTO.xlsx nello store, si fanno controlli extra.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  comparaRuleAmount,
  isFagianoCollaborator,
  isMasterRateCollaborator,
  COMPARA_AMOUNT_MASTER_ENI,
  COMPARA_AMOUNT_MASTER_IREN,
  COMPARA_AMOUNT_FAGIANO_ENI,
  COMPARA_AMOUNT_FAGIANO_IREN,
  COMPARA_AMOUNT_OTHER_ENI,
  COMPARA_AMOUNT_OTHER_IREN,
} from "../src/lib/compara-agosto/amounts";
import { classifyComparaAgostoAction } from "../src/lib/compara-agosto/classify";
import { decidePodFill } from "../src/lib/compara-agosto/pod-fill";
import {
  comparaSupplierDisplayLabel,
  comparaSuppliersCompatible,
  resolveComparaSupplierMatch,
} from "../src/lib/compara-agosto/supplier-match";
import {
  comparaSuggestionForRow,
  parseComparaRowEditsJson,
} from "../src/lib/compara-agosto/view-types";
import type { PayoutCandidate, PayoutContractIndex } from "../src/lib/payout/match";
import type { ParsedPayoutRow } from "../src/lib/payout/types";
import { deduceComparaPeriods } from "../src/lib/compara-agosto/periods";
import { comparaAgostoTemplateConfig } from "../src/lib/compara-agosto/template";
import { readComparaUnits } from "../src/lib/compara-agosto/units";
import {
  cellPodText,
  isPlaceholderPod,
  personKeyVariants,
  podsEquivalent,
  restorePdrLeadingZeros,
  shouldWritePodFromFile,
} from "../src/lib/payout/normalize";
import { parsePayoutWorkbook } from "../src/lib/payout/parse";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Regole importo");
check("fagiano?", isFagianoCollaborator("Fagiano Marco"), true);
check("non fagiano", isFagianoCollaborator("Laforgia Vito"), false);
check("master Faruoli?", isMasterRateCollaborator("Michele Faruoli"), true);
check("master Lucio?", isMasterRateCollaborator("Lucio Rossi"), true);
check("master Lucius?", isMasterRateCollaborator("Lucius"), true);
check("non master Laforgia", isMasterRateCollaborator("Laforgia Vito"), false);
check(
  "Faruoli Eni 80",
  comparaRuleAmount({
    supplierHint: "Eni",
    collaboratorName: "Michele Faruoli",
  }).amount,
  COMPARA_AMOUNT_MASTER_ENI,
);
check(
  "Faruoli Iren 80",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Michele Faruoli",
  }).amount,
  COMPARA_AMOUNT_MASTER_IREN,
);
check(
  "Lucio Eni 80",
  comparaRuleAmount({
    supplierHint: "Eni plenitude",
    collaboratorName: "Lucio",
  }).amount,
  COMPARA_AMOUNT_MASTER_ENI,
);
check(
  "Lucius Iren Dual 160",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Lucius Bianchi",
    units: 2,
  }).amount,
  COMPARA_AMOUNT_MASTER_IREN * 2,
);
check(
  "Fagiano Eni",
  comparaRuleAmount({
    supplierHint: "Eni",
    collaboratorName: "Fagiano Marco",
  }).amount,
  COMPARA_AMOUNT_FAGIANO_ENI,
);
check(
  "Fagiano Iren",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Marco Fagiano",
  }).amount,
  COMPARA_AMOUNT_FAGIANO_IREN,
);
check(
  "Altri Eni (Laforgia)",
  comparaRuleAmount({
    supplierHint: "Eni",
    collaboratorName: "Laforgia Vito",
  }).amount,
  COMPARA_AMOUNT_OTHER_ENI,
);
check(
  "Altri Iren (Laforgia)",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Laforgia Vito",
  }).amount,
  COMPARA_AMOUNT_OTHER_IREN,
);
check(
  "Dual Iren altri ×2",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Laforgia",
    units: 2,
  }).amount,
  COMPARA_AMOUNT_OTHER_IREN * 2,
);
check(
  "Engie tiene file",
  comparaRuleAmount({
    supplierHint: "Engie",
    collaboratorName: "X",
    fileAmount: 55,
  }).amount,
  55,
);

console.log("\n• PDR zeri iniziali (Excel numerico)");
check(
  "restore 12 cifre → 00…",
  restorePdrLeadingZeros("882602663573"),
  "00882602663573",
);
check(
  "restore 13 cifre → 0…",
  restorePdrLeadingZeros("3370000031038"),
  "03370000031038",
);
check(
  "già 14 con 00 invariato",
  restorePdrLeadingZeros("00882602663573"),
  "00882602663573",
);
check(
  "cellPodText number 12 cifre",
  cellPodText(882602663573),
  "00882602663573",
);
check(
  "equivalenti senza/con 00",
  podsEquivalent("882602663573", "00882602663573"),
  true,
);
check(
  "equivalenti dopo restore",
  podsEquivalent(
    restorePdrLeadingZeros("882602663573"),
    "00882602663573",
  ),
  true,
);
check(
  "fill: file senza 00 + CRM con 00 → none",
  decidePodFill({
    filePodRaw: restorePdrLeadingZeros("882602663573"),
    contract: {
      podPdr: "00882602663573",
      pod: null,
      pdr: "00882602663573",
    },
    isFagiano: false,
    ambiguousMatch: false,
  }).mode,
  "none",
);
check(
  "IT POD non paddato",
  restorePdrLeadingZeros("IT001E80700344"),
  "IT001E80700344",
);
check("XXXX è segnaposto", isPlaceholderPod("XXXX"), true);
check("ZXXXX è segnaposto", isPlaceholderPod("ZXXXX"), true);
check("PDR reale non segnaposto", isPlaceholderPod("00882602663573"), false);
check(
  "write: file reale + CRM XXXX → sì (Maruccia)",
  shouldWritePodFromFile("00882602663573", "XXXX"),
  true,
);
check(
  "write: file reale + CRM ZXXXX → sì",
  shouldWritePodFromFile("IT001E123456789012", "ZXXXX"),
  true,
);
check(
  "write: file = CRM con 00 → no",
  shouldWritePodFromFile("00882602663573", "00882602663573"),
  false,
);
check(
  "write: file senza 00 + CRM con 00 → no",
  shouldWritePodFromFile("882602663573", "00882602663573"),
  false,
);
check(
  "fill: CRM XXXX + file PDR → safe_prefill",
  decidePodFill({
    filePodRaw: restorePdrLeadingZeros("882602663573"),
    contract: { podPdr: "XXXX", pod: null, pdr: "XXXX" },
    isFagiano: true,
    ambiguousMatch: false,
  }).mode,
  "safe_prefill",
);
check(
  "suggestion insert_pod se CRM XXXX",
  comparaSuggestionForRow({
    action: "update",
    podNeedsFill: true,
  }),
  "insert_pod",
);

console.log("\n• POD fill Fagiano");
check(
  "file senza POD → display CRM",
  decidePodFill({
    filePodRaw: "",
    contract: { podPdr: "IT001E123", pod: "IT001E123", pdr: null },
    isFagiano: true,
    ambiguousMatch: false,
  }).mode,
  "display_from_crm",
);
check(
  "file POD + CRM vuoto → safe_prefill",
  decidePodFill({
    filePodRaw: "IT001E999",
    contract: { podPdr: null, pod: null, pdr: null },
    isFagiano: true,
    ambiguousMatch: false,
  }).mode,
  "safe_prefill",
);
check(
  "POD uguale → none (niente scrittura)",
  decidePodFill({
    filePodRaw: "IT001E80700344",
    contract: {
      podPdr: "IT001E80700344",
      pod: "IT001E80700344",
      pdr: null,
    },
    isFagiano: false,
    ambiguousMatch: false,
  }).mode,
  "none",
);
check(
  "POD diverso → needs_confirm",
  decidePodFill({
    filePodRaw: "IT001E111",
    contract: { podPdr: "IT001E222", pod: "IT001E222", pdr: null },
    isFagiano: false,
    ambiguousMatch: false,
  }).mode,
  "needs_confirm",
);
check(
  "ambiguo + POD file → needs_confirm",
  decidePodFill({
    filePodRaw: "05780000135704",
    contract: { podPdr: null, pod: null, pdr: null },
    isFagiano: true,
    ambiguousMatch: true,
  }).mode,
  "needs_confirm",
);

console.log("\n• Classificazione già in liquidazione (caso Delli Gatti)");
const paidMonth = new Map([
  ["2026-08", { id: "m1", status: "PAID", amount: 75 }],
]);
const paidFinance = {
  recurrence: "MENSILE",
  status: "ATTIVATO",
  paymentStatus: "Incassato",
  commissionPaid: 0,
  recurringByPeriod: paidMonth,
};
check(
  "PAID + POD uguale + regola≠file → already_ok",
  classifyComparaAgostoAction({
    hasContract: true,
    finance: paidFinance,
    competencePeriod: "2026-08",
    ambiguous: false,
    podNeedsConfirm: false,
    podNeedsFill: false,
    podAlreadyOk: true,
    amount: 60, // regola Laforgia Iren; file 75
  }).action,
  "already_ok",
);
check(
  "PAID + POD da riempire → update (fill)",
  classifyComparaAgostoAction({
    hasContract: true,
    finance: paidFinance,
    competencePeriod: "2026-08",
    ambiguous: false,
    podNeedsConfirm: false,
    podNeedsFill: true,
    podAlreadyOk: false,
    amount: 60,
  }).action,
  "update",
);
check(
  "EXPECTED → update (portare a Incassato)",
  classifyComparaAgostoAction({
    hasContract: true,
    finance: {
      ...paidFinance,
      recurringByPeriod: new Map([
        ["2026-08", { id: "m1", status: "EXPECTED", amount: null }],
      ]),
    },
    competencePeriod: "2026-08",
    ambiguous: false,
    podNeedsConfirm: false,
    podNeedsFill: false,
    podAlreadyOk: true,
    amount: 60,
  }).action,
  "update",
);
check(
  "LIQUIDATED → skip_liquidated",
  classifyComparaAgostoAction({
    hasContract: true,
    finance: {
      ...paidFinance,
      recurringByPeriod: new Map([
        ["2026-08", { id: "m1", status: "LIQUIDATED", amount: 60 }],
      ]),
    },
    competencePeriod: "2026-08",
    ambiguous: false,
    podNeedsConfirm: false,
    podNeedsFill: false,
    podAlreadyOk: true,
    amount: 60,
  }).action,
  "skip_liquidated",
);
check(
  "suggestion already_ok",
  comparaSuggestionForRow({ action: "already_ok" }),
  "already_ok",
);
check(
  "suggestion insert_pod",
  comparaSuggestionForRow({ action: "update", podNeedsFill: true }),
  "insert_pod",
);
check(
  "suggestion create_row",
  comparaSuggestionForRow({ action: "unmatched" }),
  "create_row",
);

console.log("\n• Nome ordine invertito (Maruccia)");
const marucciaKeys = personKeyVariants({ full: "Alberto Maruccia" });
check(
  "include ordine CRM cognome-nome",
  marucciaKeys.includes("MARUCCIA ALBERTO"),
  true,
);
check(
  "include ordine file nome-cognome",
  marucciaKeys.includes("ALBERTO MARUCCIA"),
  true,
);

console.log("\n• Fornitore file ≠ Liquidata (Lepore)");
check("Eni≡Plenitude", comparaSuppliersCompatible("Iren", "Plenitude"), false);
check("Iren≡Iren", comparaSuppliersCompatible("IREN", "Iren Energia"), true);
check("Eni≡Plenitude ok", comparaSuppliersCompatible("Eni", "Plenitude"), true);
check(
  "label Nuova Iren",
  comparaSupplierDisplayLabel("IREN LUCE"),
  "Iren",
);
const emptyIndex: PayoutContractIndex = {
  byPod: new Map(),
  byPodSuffix: new Map(),
  byFiscal: new Map(),
  byName: new Map(),
  size: 0,
};
const plenitude: PayoutCandidate = {
  id: "c-plen",
  contractNumber: "X1",
  podPdr: "00882602701365",
  pod: null,
  pdr: "00882602701365",
  supplierId: "s1",
  collaboratorId: "u1",
  recurrence: "UT",
  status: "PROVVIGIONE_LIQUIDATA",
  supplyStartDate: null,
  insertionDate: new Date("2025-01-01"),
  operationType: null,
  expiryDate: null,
  supplierName: "Plenitude",
  collaboratorName: "Michele Faruoli",
  clientName: "ANTONIO LEPORE",
};
emptyIndex.byPod.set("00882602701365", [plenitude]);
const leporeRow: ParsedPayoutRow = {
  sheetName: "Sheet",
  rowIndex: 2,
  raw: {},
  clientNameRaw: "ANTONIO LEPORE",
  supplierHint: "Iren",
  collaboratorHint: "Michele",
  podRaw: "00882602701365",
  podKeys: ["00882602701365"],
  podMaskedSuffix: "",
  personKeys: personKeyVariants({ full: "ANTONIO LEPORE" }),
  fiscalKey: "",
  amount: 60,
  period: "2026-08",
  note: "",
};
const leporeResolved = resolveComparaSupplierMatch({
  index: emptyIndex,
  row: leporeRow,
  matched: plenitude,
  ambiguous: false,
  matchReason: "pod_exact",
  matchScore: 100,
  candidateIds: [plenitude.id],
});
check(
  "Lepore Iren vs Plenitude senza Iren → needs create",
  leporeResolved.contract == null && leporeResolved.supplierMismatchCreate,
  true,
);
check(
  "Lepore mismatched supplier name",
  leporeResolved.mismatchedSupplierName,
  "Plenitude",
);
const irenAlt: PayoutCandidate = {
  ...plenitude,
  id: "c-iren",
  contractNumber: "X2",
  supplierName: "Iren",
  status: "PAGATO_DAL_FORNITORE",
  podPdr: "XXXX",
  pdr: "XXXX",
};
// Iren già Incassato ma POD segnaposto: recuperabile per nome+fornitore
emptyIndex.byName.set("ANTONIO LEPORE", [plenitude, irenAlt]);
emptyIndex.byName.set("LEPORE ANTONIO", [plenitude, irenAlt]);
const leporeName = {
  ...leporeRow,
  personKeys: personKeyVariants({ full: "ANTONIO LEPORE" }),
};
const leporeAlt = resolveComparaSupplierMatch({
  index: emptyIndex,
  row: leporeName,
  matched: plenitude,
  ambiguous: false,
  matchReason: "pod_exact",
  matchScore: 100,
  candidateIds: [plenitude.id],
});
check(
  "Lepore: Iren Incassato per nome (POD XXXX) → usa Iren",
  leporeAlt.contract?.id,
  "c-iren",
);
const marucciaIren: PayoutCandidate = {
  ...irenAlt,
  id: "c-maruccia-iren",
  clientName: "MARUCCIA ALBERTO",
  supplierName: "Iren",
  status: "PAGATO_DAL_FORNITORE",
  podPdr: "ZXXXX",
  pod: "ZXXXX",
  pdr: null,
};
const marucciaIndex: PayoutContractIndex = {
  byPod: new Map([["ZXXXX", [marucciaIren]]]),
  byPodSuffix: new Map(),
  byFiscal: new Map(),
  byName: new Map([
    ["MARUCCIA ALBERTO", [marucciaIren]],
    ["ALBERTO MARUCCIA", [marucciaIren]],
  ]),
  size: 1,
};
const marucciaFile: ParsedPayoutRow = {
  sheetName: "Sheet",
  rowIndex: 3,
  raw: {},
  clientNameRaw: "Alberto Maruccia",
  supplierHint: "Iren",
  collaboratorHint: "Fagiano",
  podRaw: "01613893005447",
  podKeys: ["01613893005447", "1613893005447"],
  podMaskedSuffix: "",
  personKeys: personKeyVariants({ full: "Alberto Maruccia" }),
  fiscalKey: "",
  amount: 65,
  period: "2026-08",
  note: "",
};
const marucciaResolved = resolveComparaSupplierMatch({
  index: marucciaIndex,
  row: marucciaFile,
  matched: null,
  ambiguous: false,
  matchReason: null,
  matchScore: null,
  candidateIds: [],
});
check(
  "Maruccia unmatched POD + Iren per nome → present",
  marucciaResolved.contract?.id,
  "c-maruccia-iren",
);

console.log("\n• rowEdits payload (Maruccia: conferma + Fagiano)");
const marucciaKey = "Compara:12";
const marucciaPayload = JSON.stringify({
  [marucciaKey]: {
    nominativo: "Alberto Maruccia",
    supplier: "Iren",
    amount: 65,
    pod: "01613893005447",
    stato: "Incassato da liquidare",
    collaboratorId: "user-fagiano-id",
    collaboratorName: "Fagiano Marco",
    rowLabel: "Compara Agosto 2026",
    createConfirmed: true,
  },
});
const marucciaEdits = parseComparaRowEditsJson(marucciaPayload);
const marucciaEdit = marucciaEdits.get(marucciaKey);
check(
  "createConfirmed preservato dal JSON",
  marucciaEdit?.createConfirmed === true,
  true,
);
check(
  "collaboratorId Fagiano preservato",
  marucciaEdit?.collaboratorId,
  "user-fagiano-id",
);
check(
  "POD Maruccia preservato",
  marucciaEdit?.pod,
  "01613893005447",
);
check(
  "senza createConfirmed → false",
  parseComparaRowEditsJson(
    JSON.stringify({
      [marucciaKey]: {
        nominativo: "X",
        supplier: "Iren",
        amount: 65,
        pod: "",
        stato: "Incassato da liquidare",
        collaboratorId: "u1",
        collaboratorName: "Fagiano",
        rowLabel: "",
      },
    }),
  ).get(marucciaKey)?.createConfirmed,
  false,
);

console.log("\n• Units / periodi");
check("valore 2", readComparaUnits({ Valore: "2" }), 2);
check("valore assente", readComparaUnits({}), 1);
const periods = deduceComparaPeriods({
  meseInvitoSamples: [202609],
  dataPeriods: ["2026-08", "2026-08", "2026-07"],
  fallbackCompetence: "2026-01",
  fallbackSettled: "2026-02",
});
check("settled da Mese Invito", periods.settledPeriod, "2026-09");
check("competence moda Data", periods.competencePeriod, "2026-08");

async function main() {
  console.log("\n• Parse fixture CI (scripts/fixtures/compara-agosto-sample.xlsx)");
  const fixturePath = join(
    process.cwd(),
    "scripts/fixtures/compara-agosto-sample.xlsx",
  );
  if (!existsSync(fixturePath)) {
    failures++;
    console.log("   KO  fixture Compara non trovato in repo");
  } else {
    const parsed = await parsePayoutWorkbook(
      readFileSync(fixturePath),
      comparaAgostoTemplateConfig(),
    );
    check("parse ok", parsed.ok, true);
    if (parsed.ok) {
      // 4 OK + 1 KO saltata dal template
      check("4 righe OK (KO esclusa)", parsed.rows.length, 4);
      const noPod = parsed.rows.filter((r) => !r.podRaw.trim()).length;
      check("1 riga senza POD (Fagiano)", noPod, 1);
      const fagiano = parsed.rows.filter((r) =>
        /fagiano/i.test(r.collaboratorHint),
      ).length;
      check("1 shop Fagiano", fagiano, 1);
      const dual = parsed.rows.filter((r) => readComparaUnits(r.raw) === 2);
      check("1 Dual", dual.length, 1);
      // Dual nel fixture ha Shop Faruoli → quota master 80 × 2
      check(
        "Dual Iren Faruoli → 160",
        comparaRuleAmount({
          supplierHint: dual[0]!.supplierHint,
          collaboratorName: dual[0]!.collaboratorHint,
          units: 2,
          fileAmount: dual[0]!.amount,
        }).amount,
        160,
      );
      const fagianoRow = parsed.rows.find((r) =>
        /fagiano/i.test(r.collaboratorHint),
      );
      check(
        "Fagiano Iren senza POD → 65",
        comparaRuleAmount({
          supplierHint: fagianoRow?.supplierHint,
          collaboratorName: fagianoRow?.collaboratorHint,
          units: 1,
          fileAmount: fagianoRow?.amount,
        }).amount,
        65,
      );
      const Augustish = parsed.rows.filter((r) => r.period === "2026-08").length;
      check("competenza agosto da Data", Augustish, 4);
    }
  }

  // Controlli extra sul file reale (opzionali: assenti su Vercel)
  const realCandidates = [
    join(process.cwd(), "scripts/fixtures/COMPARA_AGOSTO.xlsx"),
    "/cursor/stores/self/media/COMPARA_AGOSTO.xlsx",
    "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/docs/COMPARA_AGOSTO.xlsx",
  ];
  const realPath = realCandidates.find((p) => existsSync(p));
  if (realPath) {
    console.log("\n• Parse COMPARA_AGOSTO.xlsx (opzionale, store locale)");
    const parsed = await parsePayoutWorkbook(
      readFileSync(realPath),
      comparaAgostoTemplateConfig(),
    );
    check("parse reale ok", parsed.ok, true);
    if (parsed.ok) {
      check("141 righe OK", parsed.rows.length, 141);
      const eni = parsed.rows.filter((r) => /eni/i.test(r.supplierHint)).length;
      const iren = parsed.rows.filter((r) =>
        /iren/i.test(r.supplierHint),
      ).length;
      check("Eni 64", eni, 64);
      check("Iren 77", iren, 77);
      // Excel numerico: dopo cellPodText i PDR gas hanno di nuovo 00/0
      const pdr00 = parsed.rows.filter((r) =>
        /^00\d{12}$/.test(r.podRaw),
      ).length;
      const pdr14 = parsed.rows.filter((r) => /^\d{14}$/.test(r.podRaw)).length;
      check("PDR con prefisso 00 (≥40)", pdr00 >= 40, true);
      check("PDR 14 cifre (≥60)", pdr14 >= 60, true);
      console.log(`   info PDR 00…=${pdr00} · 14 cifre=${pdr14}`);
    }
  } else {
    console.log(
      "\n• COMPARA_AGOSTO.xlsx assente (normale in CI): skip controlli volume reale",
    );
  }

  console.log(
    failures === 0
      ? "\nOK check-compara-agosto-import\n"
      : `\nFAIL check-compara-agosto-import (${failures})\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
