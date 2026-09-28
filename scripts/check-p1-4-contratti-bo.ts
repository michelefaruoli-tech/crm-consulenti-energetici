/**
 * P1.4 — checklist documenti, completezza, flusso BO (mapping UI stati esistenti).
 * Uso: npx tsx scripts/check-p1-4-contratti-bo.ts
 *
 * Non tocca calcoli provvigioni / storno / switch.
 */
import {
  evaluateDocumentChecklist,
  getDocumentChecklist,
} from "../src/lib/document-checklist";
import { computeContractCompleteness } from "../src/lib/contract-completeness";
import {
  BACK_OFFICE_PHASE_LABELS,
  buildBackOfficeFlowSteps,
  mapStatusToBackOfficePhase,
  SEND_TO_BACKOFFICE_STATUS,
} from "../src/lib/contract-bo-flow";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `   ${ok ? "ok " : "KO "} ${label}: ${JSON.stringify(actual)} (atteso ${JSON.stringify(expected)})`,
  );
}

console.log("\n• Checklist PRIVATO energia");
const priv = getDocumentChecklist({
  clientType: "PRIVATO",
  service: "LUCE",
  paymentMethod: "RID",
});
check(
  "ha CI_UNICO required",
  priv.some((i) => i.docType === "CI_UNICO" && i.required),
  true,
);
check(
  "ha BOLLETTA required",
  priv.some((i) => i.docType === "BOLLETTA" && i.required),
  true,
);
check(
  "ha SEPA recommended",
  priv.some((i) => i.docType === "SEPA" && i.recommended),
  true,
);

console.log("\n• Checklist AZIENDA");
const az = getDocumentChecklist({ clientType: "AZIENDA", service: "GAS" });
check(
  "ha VISURA required",
  az.some((i) => i.docType === "VISURA" && i.required),
  true,
);

console.log("\n• Valutazione allegati");
const empty = evaluateDocumentChecklist(
  { clientType: "PRIVATO", service: "LUCE" },
  [],
);
check("senza allegati non completa", empty.requiredComplete, false);
check("missing CI e bolletta", empty.missingRequiredLabels.length >= 2, true);

const covered = evaluateDocumentChecklist(
  { clientType: "PRIVATO", service: "LUCE" },
  [
    { docType: "CI_UNICO", filename: "ci.pdf" },
    { docType: "BOLLETTA", filename: "bolletta.pdf" },
  ],
);
check("con CI+bolletta completa", covered.requiredComplete, true);

const fronteRetro = evaluateDocumentChecklist(
  { clientType: "PRIVATO", service: "LUCE" },
  [
    { docType: "CI_FRONTE", filename: "f.jpg" },
    { docType: "CI_RETRO", filename: "r.jpg" },
    { filename: "fattura-enel.pdf", docType: "ALTRO" },
  ],
);
check("fronte+retro+nome fattura", fronteRetro.requiredComplete, true);

console.log("\n• Completezza pratica");
const low = computeContractCompleteness({
  clientOk: false,
  addressOk: false,
  utenzaOk: false,
  supplierOk: false,
  operationOk: false,
  paymentOk: false,
  offerOk: false,
  datesOk: true,
  checklist: { clientType: "PRIVATO", service: "LUCE" },
  attachments: [],
});
check("percent bassa senza dati", low.percent < 40, true);
check("non può inviare BO", low.canSendToBackOffice, false);

const high = computeContractCompleteness({
  clientOk: true,
  addressOk: true,
  utenzaOk: true,
  supplierOk: true,
  operationOk: true,
  paymentOk: true,
  offerOk: true,
  datesOk: true,
  checklist: { clientType: "PRIVATO", service: "LUCE" },
  attachments: [
    { docType: "CI_UNICO", filename: "ci.pdf" },
    { docType: "BOLLETTA", filename: "b.pdf" },
  ],
});
check("percent 100 con tutto", high.percent, 100);
check("può inviare BO", high.canSendToBackOffice, true);

console.log("\n• Mapping flussi BO (stati esistenti)");
check(
  "BOZZA → bozza",
  mapStatusToBackOfficePhase("BOZZA"),
  "bozza",
);
check(
  "INSERITO → inserito",
  mapStatusToBackOfficePhase("INSERITO"),
  "inserito",
);
check(
  "DA_LAVORARE → inviato_bo",
  mapStatusToBackOfficePhase("DA_LAVORARE"),
  "inviato_bo",
);
check(
  "IN_LAVORAZIONE → in_lavorazione",
  mapStatusToBackOfficePhase("IN_LAVORAZIONE"),
  "in_lavorazione",
);
check(
  "DOCUMENTAZIONE_INCOMPLETA → integrazione",
  mapStatusToBackOfficePhase("DOCUMENTAZIONE_INCOMPLETA"),
  "richiesta_integrazione",
);
check(
  "IN_ATTESA_PAGAMENTO → conclusa",
  mapStatusToBackOfficePhase("IN_ATTESA_PAGAMENTO"),
  "conclusa",
);
check(
  "invio usa IN_LAVORAZIONE",
  SEND_TO_BACKOFFICE_STATUS,
  "IN_LAVORAZIONE",
);
check(
  "label Inviato al Back Office",
  BACK_OFFICE_PHASE_LABELS.inviato_bo,
  "Inviato al Back Office",
);

const steps = buildBackOfficeFlowSteps("IN_LAVORAZIONE");
const current = steps.find((s) => s.current);
check("step corrente in lavorazione", current?.id, "in_lavorazione");
check(
  "step conclusa non raggiunto",
  steps.find((s) => s.id === "conclusa")?.reached,
  false,
);

const integ = buildBackOfficeFlowSteps("DOCUMENTAZIONE_INCOMPLETA");
check(
  "integrazione corrente",
  integ.find((s) => s.current)?.id,
  "richiesta_integrazione",
);

if (failures > 0) {
  console.error(`\nP1.4 check FAILED: ${failures} asserzioni`);
  process.exit(1);
}
console.log("\nP1.4 check OK");
