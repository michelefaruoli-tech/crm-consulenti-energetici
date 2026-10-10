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
      check(
        "Dual Iren → 120",
        comparaRuleAmount({
          supplierHint: dual[0]!.supplierHint,
          collaboratorName: dual[0]!.collaboratorHint,
          units: 2,
          fileAmount: dual[0]!.amount,
        }).amount,
        120,
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
