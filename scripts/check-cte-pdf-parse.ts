/**
 * Verifica il mapper CTE sui 5 PDF di prova (livello testo, niente OCR).
 * Uso: npx tsx scripts/check-cte-pdf-parse.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCtePdfText } from "../src/lib/cte-pdf-parse";
import { extractCtePdfText } from "../src/lib/cte-pdf-text";

const SAMPLES_DIR =
  process.env.CTE_PDF_SAMPLES_DIR ||
  "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/internal/campioni-cte/prova-upload";

type Expect = {
  file: string;
  offerName: string;
  utility: "LUCE" | "GAS";
  category: "RESIDENZIALE" | "BUSINESS";
  priceKind: "FISSO";
  bands: Array<{ timeBand: string; energyPrice: number }>;
  ccvAnnual: number;
  validTo: string;
  validFrom: string | null;
  powerKwMin: number | null;
  powerKwMax: number | null;
  annualConsumptionMax: number | null;
  networkLosses: "INCLUDED" | "NOT_APPLICABLE";
};

const EXPECTED: Expect[] = [
  {
    file: "ENEL_FIX_BUSINESS_LUCE_v25.pdf",
    offerName: "Enel Fix Business Luce",
    utility: "LUCE",
    category: "BUSINESS",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.19 }],
    ccvAnnual: 168,
    validTo: "2026-10-01",
    validFrom: null,
    powerKwMin: 0,
    powerKwMax: 25,
    annualConsumptionMax: 1_000_000,
    networkLosses: "INCLUDED",
  },
  {
    file: "ENEL_FIX_BUSINESS_START_LUCE_v38.pdf",
    offerName: "Enel Fix Business Start Luce",
    utility: "LUCE",
    category: "BUSINESS",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.21 }],
    ccvAnnual: 192,
    validTo: "2026-10-01",
    validFrom: null,
    powerKwMin: null,
    powerKwMax: 25,
    annualConsumptionMax: 1_000_000,
    networkLosses: "INCLUDED",
  },
  {
    file: "ENEL_FIX_WOW_GAS_v31.pdf",
    offerName: "Enel Fix WOW Gas",
    utility: "GAS",
    category: "RESIDENZIALE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.69 }],
    ccvAnnual: 156,
    validTo: "2026-10-01",
    validFrom: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMax: null,
    networkLosses: "NOT_APPLICABLE",
  },
  {
    file: "ENEL_FIX_WOW_LUCE_v33.pdf",
    offerName: "Enel Fix WOW Luce",
    utility: "LUCE",
    category: "RESIDENZIALE",
    priceKind: "FISSO",
    bands: [{ timeBand: "MONO", energyPrice: 0.188 }],
    ccvAnnual: 156,
    validTo: "2026-10-01",
    validFrom: null,
    powerKwMin: null,
    powerKwMax: null,
    annualConsumptionMax: null,
    networkLosses: "INCLUDED",
  },
  {
    file: "SoluzioneEnergiaImpresaPmi.pdf",
    offerName: "Soluzione Energia Impresa Pmi",
    utility: "LUCE",
    category: "BUSINESS",
    priceKind: "FISSO",
    bands: [
      { timeBand: "F1", energyPrice: 0.20867 },
      { timeBand: "F2", energyPrice: 0.2244 },
      { timeBand: "F3", energyPrice: 0.1903 },
    ],
    ccvAnnual: 144,
    validTo: "2026-09-28",
    validFrom: "2026-09-15",
    powerKwMin: 25,
    powerKwMax: 50,
    annualConsumptionMax: 4_000_000,
    networkLosses: "INCLUDED",
  },
];

function almost(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

async function main() {
  if (!existsSync(SAMPLES_DIR)) {
    console.error(`❌ Cartella campioni assente: ${SAMPLES_DIR}`);
    process.exit(1);
  }

  let failed = 0;
  for (const exp of EXPECTED) {
    const path = join(SAMPLES_DIR, exp.file);
    if (!existsSync(path)) {
      console.error(`❌ File mancante: ${exp.file}`);
      failed++;
      continue;
    }
    const buf = readFileSync(path);
    const { text, totalPages } = await extractCtePdfText(new Uint8Array(buf));
    const parsed = parseCtePdfText(text);
    const problems: string[] = [];
    if (parsed.textChars < 400) problems.push(`testo troppo corto (${parsed.textChars})`);
    if (parsed.offerName !== exp.offerName) problems.push(`nome=${parsed.offerName}`);
    if (parsed.utility !== exp.utility) problems.push(`utility=${parsed.utility}`);
    if (parsed.category !== exp.category) problems.push(`category=${parsed.category}`);
    if (parsed.priceKind !== exp.priceKind) problems.push(`priceKind=${parsed.priceKind}`);
    if (parsed.ccvAnnual !== exp.ccvAnnual) problems.push(`ccv=${parsed.ccvAnnual}`);
    if (parsed.validTo !== exp.validTo) problems.push(`validTo=${parsed.validTo}`);
    if (parsed.validFrom !== exp.validFrom) problems.push(`validFrom=${parsed.validFrom}`);
    if (parsed.powerKwMin !== exp.powerKwMin) problems.push(`pMin=${parsed.powerKwMin}`);
    if (parsed.powerKwMax !== exp.powerKwMax) problems.push(`pMax=${parsed.powerKwMax}`);
    if (parsed.annualConsumptionMax !== exp.annualConsumptionMax) {
      problems.push(`consMax=${parsed.annualConsumptionMax}`);
    }
    if (parsed.networkLosses !== exp.networkLosses) {
      problems.push(`losses=${parsed.networkLosses}`);
    }
    if (parsed.bands.length !== exp.bands.length) {
      problems.push(`bands=${JSON.stringify(parsed.bands)}`);
    } else {
      for (let i = 0; i < exp.bands.length; i++) {
        const got = parsed.bands[i]!;
        const want = exp.bands[i]!;
        if (got.timeBand !== want.timeBand || !almost(got.energyPrice, want.energyPrice)) {
          problems.push(`band ${want.timeBand} got ${got.timeBand} ${got.energyPrice}`);
        }
      }
    }
    // Non inventare il consumo del cliente tipo ARERA
    if (exp.file.includes("WOW") && parsed.annualConsumptionMax != null) {
      problems.push("WOW non deve avere consumo vincolo dal cliente tipo");
    }

    if (problems.length) {
      failed++;
      console.error(`❌ ${exp.file} (p.${totalPages}, ${parsed.textChars} chars, ${parsed.layout})`);
      for (const p of problems) console.error(`   ${p}`);
    } else {
      console.log(`✅ ${exp.file} → ${parsed.offerName} (${parsed.layout}, ${totalPages} pag.)`);
    }
  }

  if (failed) {
    console.error(`\n❌ ${failed} PDF non allineati al mapper`);
    process.exit(1);
  }
  console.log("\n✅ Mapper CTE allineato ai 5 PDF di prova.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
