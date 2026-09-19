/**
 * Verifica listini CTE Enel Corporate, SEV Iren, Compara Semplice.
 * Uso: npx tsx scripts/check-cte-listini.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPARA_SEMPLICE_LISTINO, COMPARA_SKIPPED } from "../src/lib/cte-compara-listino";
import { detectListinoFromImageHash, detectListinoFromPdf } from "../src/lib/cte-listino-detect";
import { listinoOfferToParseResult } from "../src/lib/cte-listino-shared";
import { ENEL_CORPORATE_LISTINO } from "../src/lib/cte-enel-corporate-listino";
import { isSevIrenListinoText, SEV_IREN_LISTINO } from "../src/lib/cte-sev-iren-listino";
import { extractCtePdfText } from "../src/lib/cte-pdf-text";

const SAMPLES =
  process.env.CTE_PDF_SAMPLES_DIR ||
  "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/internal/campioni-cte/prova-upload";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(ENEL_CORPORATE_LISTINO.length === 7, "corporate 7");
assert(
  ENEL_CORPORATE_LISTINO.every((o) => o.priceKind === "FISSO" && o.bands.length === 3),
  "corporate F1/F2/F3",
);
const superLuce = ENEL_CORPORATE_LISTINO.find((o) => o.offerName === "ENEL BUSINESS SUPER LUCE");
assert(superLuce?.bands[0]?.energyPrice === 0.1845, "super F1 0.1845");
assert(superLuce?.networkLosses === "EXCLUDED", "perdite escluse");
assert(superLuce?.validTo === "2026-10-01", "super validTo 1 ott");
assert(superLuce?.ccvAnnual == null, "CCV corporate non inventata");

assert(SEV_IREN_LISTINO.length === 19, "sev 19");
const sevFix = SEV_IREN_LISTINO.find((o) => o.offerName === "SEV 13X24 PREZZO FISSO LUCE");
assert(sevFix?.bands[0]?.energyPrice === 0.13 && sevFix.ccvAnnual === 155.88, "13x24");
assert(sevFix?.networkLosses === "INCLUDED", "13x24 perdite incluse");
const summer = SEV_IREN_LISTINO.find((o) => o.offerName === "SEV SUMMER LUCE");
assert(summer?.spread === 0, "summer pun senza +X → 0");
const tutela = SEV_IREN_LISTINO.find((o) => o.offerName === "SEV GAS TUTELA VULNERABILITÀ");
assert(tutela?.spread == null, "cmamm non inventato come spread");
assert(
  SEV_IREN_LISTINO.every((o) => o.supplierName === "Iren"),
  "sev fornitore Iren",
);

assert(COMPARA_SEMPLICE_LISTINO.length === 15, "compara 15 energia");
assert(
  !COMPARA_SEMPLICE_LISTINO.some((o) => o.offerName.includes("BUSINESS SUPER LUCE")),
  "niente doppione Super Luce",
);
assert(
  COMPARA_SEMPLICE_LISTINO.every((o) => !/gett<|gettone|60 €|70 € per 10/i.test(o.notes)),
  "niente gettoni nei note",
);
const fixa = COMPARA_SEMPLICE_LISTINO.find(
  (o) => o.offerName === "FIXA TIME 24" && o.utility === "LUCE",
);
assert(fixa?.bands[0]?.energyPrice === 0.163 && fixa.ccvAnnual === 144, "fixa time luce");
const aceaLuce = COMPARA_SEMPLICE_LISTINO.find((o) => o.offerName === "ACEA FIX LUCE");
assert(aceaLuce?.ccvAnnual == null, "acea luce CCV assente");
assert(COMPARA_SKIPPED.length === 3, "3 skip compara");

const parsed = listinoOfferToParseResult(superLuce!, "enel-corporate-listino");
assert(parsed.layout === "enel-corporate-listino", "layout corporate");
assert(parsed.supplierName === "Enel", "fornitore enel");

async function main(): Promise<void> {
  const imgPath = join(SAMPLES, "enel-corporate-power.png");
  if (existsSync(imgPath)) {
    const h = createHash("sha256").update(readFileSync(imgPath)).digest("hex");
    const known = detectListinoFromImageHash(h);
    assert(known?.offers.length === 7, `hash corporate ${h}`);
    console.log("screenshot corporate hash: ok");
  } else {
    console.log("screenshot corporate assente, skip hash");
  }

  const sevPath = join(SAMPLES, "OFFERTE_SEV-9.pdf");
  if (existsSync(sevPath)) {
    const buf = readFileSync(sevPath);
    const hash = createHash("sha256").update(buf).digest("hex");
    const extracted = await extractCtePdfText(new Uint8Array(buf));
    assert(isSevIrenListinoText(extracted.text), "testo SEV riconosciuto");
    const known = detectListinoFromPdf(hash, extracted.text);
    assert(known?.offers.length === 19, "pdf SEV → 19");
    console.log("pdf SEV: ok");
  } else {
    console.log("pdf SEV assente, skip extract");
  }

  const comparaPath = join(SAMPLES, "Offerta-commerciale-9.pdf");
  if (existsSync(comparaPath)) {
    const buf = readFileSync(comparaPath);
    const hash = createHash("sha256").update(buf).digest("hex");
    const known = detectListinoFromPdf(hash, "");
    assert(known?.offers.length === 15, `hash compara ${hash}`);
    console.log("pdf Compara hash: ok");
  } else {
    console.log("pdf Compara assente, skip hash");
  }

  console.log("check-cte-listini: ok (7 corporate + 19 SEV + 15 Compara)");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
