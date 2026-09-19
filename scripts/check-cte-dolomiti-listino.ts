/**
 * Verifica listino Dolomiti (screenshot settembre 2026).
 * Uso: npx tsx scripts/check-cte-dolomiti-listino.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allDolomitiListinoOffers,
  DOLOMITI_LISTINO_BUSINESS,
  DOLOMITI_LISTINO_RESIDENZIALE,
  dolomitiOfferToParseResult,
  dolomitiOffersForScreenshotHash,
} from "../src/lib/cte-dolomiti-listino";

const SAMPLES =
  process.env.CTE_PDF_SAMPLES_DIR ||
  "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/internal/campioni-cte/prova-upload";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const all = allDolomitiListinoOffers();
assert(DOLOMITI_LISTINO_RESIDENZIALE.length === 9, "residenziale 9 offerte con prezzo");
assert(DOLOMITI_LISTINO_BUSINESS.length === 7, "business/pertinenza 7 offerte con prezzo");
assert(all.length === 16, "16 offerte importabili");
assert(
  all.every((o) => o.offerName.startsWith("DOLOMITI") || o.offerName.includes("DOLOMITI")),
  "nomi Dolomiti",
);
assert(
  !all.some((o) => o.offerName.includes("FISSO LUCE 12") && !o.offerName.includes("36")),
  "non importare LUCE 12 senza prezzo",
);

const luce36 = all.find((o) => o.offerName === "DOLOMITI FISSO LUCE 36");
assert(luce36?.bands[0]?.energyPrice === 0.176, "luce 36 MONO 0.176");
assert(luce36?.ccvAnnual === 72, "luce 36 CCV 72");

const corp = all.find((o) => o.offerName === "DOLOMITI FISSO LUCE 36 CORPORATE");
assert(corp?.bands.length === 3 && corp.bands[0]?.energyPrice === 0.181, "corporate F1");
assert(corp?.category === "BUSINESS", "corporate business");

const flex = all.find((o) => o.offerName === "DOLOMITI FLEX 24 LUCE");
assert(flex?.priceKind === "VARIABILE" && flex.spread === 0.01, "flex spread PUN+0.01");
assert(flex?.bands.length === 0, "variabile senza fascia inventata");

const giorno = all.find((o) => o.offerName === "DOLOMITI LUCE GIORNO");
assert(giorno?.bands.length === 0, "giorno: niente MONO inventato");
assert(giorno?.notes.includes("0,128"), "giorno: prezzi in nota");

const parsed = dolomitiOfferToParseResult(luce36!);
assert(parsed.layout === "dolomiti-listino", "layout");
assert(parsed.supplierName === "Dolomiti", "fornitore");
assert(parsed.utility === "LUCE", "luce");

const resPath = join(SAMPLES, "dolomiti-listino-residenziale.png");
const busPath = join(SAMPLES, "dolomiti-listino-business.png");
if (existsSync(resPath) && existsSync(busPath)) {
  const h1 = createHash("sha256").update(readFileSync(resPath)).digest("hex");
  const h2 = createHash("sha256").update(readFileSync(busPath)).digest("hex");
  assert(dolomitiOffersForScreenshotHash(h1)?.length === 9, `hash residenziale ${h1}`);
  assert(dolomitiOffersForScreenshotHash(h2)?.length === 7, `hash business ${h2}`);
  console.log("screenshot hash: ok");
} else {
  console.log("screenshot campioni assenti, skip hash");
}

console.log("check-cte-dolomiti-listino: ok (16 offerte)");
