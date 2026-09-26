/**
 * Verifica seed + mapper Duferco Flex Condomini.
 * Uso: npx tsx scripts/check-cte-duferco-flex-condomini.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allDufercoFlexCondominiOffers } from "../src/lib/cte-duferco-flex-condomini";
import { listinoByKind } from "../src/lib/cte-listino-detect";
import { parseCtePdfText } from "../src/lib/cte-pdf-parse";
import { extractCtePdfText } from "../src/lib/cte-pdf-text";

const ROOT =
  process.env.CTE_FLEX_CONDOMINI_DIR ||
  "/cursor/stores/bc-13eb74be-095d-494b-8617-c7fbc59dbb56/internal/campioni-cte/flex-condomini";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const seed = allDufercoFlexCondominiOffers();
assert(seed.length === 18, `seed 18, got ${seed.length}`);
assert(seed.filter((o) => o.utility === "LUCE").length === 8, "8 luce");
assert(seed.filter((o) => o.utility === "GAS").length === 10, "10 gas");
assert(
  seed.every((o) => o.category === "CONDOMINI" && o.priceKind === "VARIABILE" && o.validTo == null),
  "condomini variabile senza scadenza",
);
assert(
  seed.every((o) => o.spread != null && o.bands.length === 0),
  "spread senza fasce inventate",
);

const nettunoLuce = seed.find((o) => o.offerName === "FLEX CONDOMINI NETTUNO" && o.utility === "LUCE");
assert(nettunoLuce?.spread === 0.044 && nettunoLuce.ccvAnnual === 420, "nettuno luce");
const soleGas = seed.find((o) => o.offerName === "FLEX CONDOMINI SOLE" && o.utility === "GAS");
assert(soleGas?.spread === 0.05 && soleGas.ccvAnnual === 108, "sole gas");

const pack = listinoByKind("duferco-flex-condomini");
assert(pack.offers.length === 18, "listinoByKind 18");

async function checkPdf(subdir: string, file: string, expect: {
  utility: "LUCE" | "GAS";
  planet: string;
  spread: number;
  ccv: number;
}): Promise<void> {
  const buf = new Uint8Array(readFileSync(join(ROOT, subdir, file)));
  const { text } = await extractCtePdfText(buf);
  const parsed = parseCtePdfText(text);
  assert(parsed.layout === "duferco-flex-condomini", `${file} layout`);
  assert(parsed.offerName === `FLEX CONDOMINI ${expect.planet}`, `${file} name`);
  assert(parsed.utility === expect.utility, `${file} utility`);
  assert(parsed.category === "CONDOMINI", `${file} category`);
  assert(parsed.priceKind === "VARIABILE", `${file} kind`);
  assert(parsed.spread === expect.spread, `${file} spread ${parsed.spread} != ${expect.spread}`);
  assert(parsed.ccvAnnual === expect.ccv, `${file} ccv`);
  assert(parsed.validTo == null && parsed.validFrom == null, `${file} no expiry`);
  assert(parsed.supplierName?.toLowerCase().includes("duferco"), `${file} supplier`);
}

async function main(): Promise<void> {
  await checkPdf("luce", "FLEX_CONDOMINI_NETTUNO_c3a6.pdf", {
    utility: "LUCE",
    planet: "NETTUNO",
    spread: 0.044,
    ccv: 420,
  });
  await checkPdf("luce", "FLEX_CONDOMINI_MERCURIO_2929.pdf", {
    utility: "LUCE",
    planet: "MERCURIO",
    spread: 0.0132,
    ccv: 120,
  });
  await checkPdf("gas", "FLEX_CONDOMINI_SOLE_d17b.pdf", {
    utility: "GAS",
    planet: "SOLE",
    spread: 0.05,
    ccv: 108,
  });
  await checkPdf("gas", "FLEX_CONDOMINI_NETTUNO_0064.pdf", {
    utility: "GAS",
    planet: "NETTUNO",
    spread: 0.23,
    ccv: 108,
  });

  const luceFiles = readdirSync(join(ROOT, "luce")).filter((f) => f.endsWith(".pdf"));
  const gasFiles = readdirSync(join(ROOT, "gas")).filter((f) => f.endsWith(".pdf"));
  assert(luceFiles.length === 8, "8 pdf luce");
  assert(gasFiles.length === 10, "10 pdf gas");

  console.log("check-cte-duferco-flex-condomini: ok", {
    seed: seed.length,
    lucePdf: luceFiles.length,
    gasPdf: gasFiles.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
