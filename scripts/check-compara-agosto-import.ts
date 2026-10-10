/**
 * Import Compara Agosto — regole importo, periodi, POD fill Fagiano, parse file.
 * Uso: npx tsx scripts/check-compara-agosto-import.ts
 */
import { readFileSync, existsSync } from "node:fs";
import {
  comparaRuleAmount,
  isFagianoCollaborator,
  COMPARA_AMOUNT_FAGIANO_ENI,
  COMPARA_AMOUNT_FAGIANO_IREN,
  COMPARA_AMOUNT_OTHER_ENI,
  COMPARA_AMOUNT_OTHER_IREN,
} from "../src/lib/compara-agosto/amounts";
import { decidePodFill } from "../src/lib/compara-agosto/pod-fill";
import { deduceComparaPeriods } from "../src/lib/compara-agosto/periods";
import { comparaAgostoTemplateConfig } from "../src/lib/compara-agosto/template";
import { readComparaUnits } from "../src/lib/compara-agosto/units";
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
  "Altri Eni",
  comparaRuleAmount({
    supplierHint: "Eni",
    collaboratorName: "Laforgia Vito",
  }).amount,
  COMPARA_AMOUNT_OTHER_ENI,
);
check(
  "Altri Iren",
  comparaRuleAmount({
    supplierHint: "Iren",
    collaboratorName: "Michele Faruoli",
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
  console.log("\n• Parse COMPARA_AGOSTO.xlsx");
  const candidates = [
    "/cursor/stores/self/media/COMPARA_AGOSTO.xlsx",
    "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/docs/COMPARA_AGOSTO.xlsx",
  ];
  const filePath = candidates.find((p) => existsSync(p));
  if (!filePath) {
    failures++;
    console.log("   KO  file COMPARA_AGOSTO.xlsx non trovato");
  } else {
    const buffer = readFileSync(filePath);
    const parsed = await parsePayoutWorkbook(
      buffer,
      comparaAgostoTemplateConfig(),
    );
    check("parse ok", parsed.ok, true);
    if (parsed.ok) {
      check("141 righe OK", parsed.rows.length, 141);
      const eni = parsed.rows.filter((r) =>
        /eni/i.test(r.supplierHint),
      ).length;
      const iren = parsed.rows.filter((r) =>
        /iren/i.test(r.supplierHint),
      ).length;
      check("Eni 64", eni, 64);
      check("Iren 77", iren, 77);
      const noPod = parsed.rows.filter((r) => !r.podRaw.trim()).length;
      check("POD assenti in questo file", noPod, 0);
      const amountsOk = parsed.rows.every(
        (r) => r.amount != null && r.amount > 0,
      );
      check("gettoni leggibili (€)", amountsOk, true);
      const Augustish = parsed.rows.filter((r) => r.period === "2026-08").length;
      check("maggioranza competenza agosto da Data", Augustish >= 100, true);

      let ruleTotal = 0;
      for (const row of parsed.rows) {
        const units = readComparaUnits(row.raw);
        const { amount } = comparaRuleAmount({
          supplierHint: row.supplierHint,
          collaboratorName: row.collaboratorHint,
          units,
          fileAmount: row.amount,
        });
        ruleTotal += amount ?? 0;
      }
      // Shop file = MICHELE FARUOLI → regole «altri»: Eni70 / Iren60 (× Valore)
      console.log(`   .. totale regole (shop Faruoli): ${ruleTotal.toFixed(2)}`);
      check("totale regole > 0", ruleTotal > 0, true);
    }
  }

  console.log(
    failures === 0
      ? "\nOK check-compara-agosto-import\n"
      : `\nFAIL check-compara-agosto-import (${failures})\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
