/**
 * Check statico P0.3 — sicurezza Fase 0 residua.
 * Nessun DB richiesto.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validatePassword, PASSWORD_MIN_LENGTH } from "../src/lib/password-policy";

let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTs(p, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const apiFiles = walkTs("src/app/api");
const cronFiles = apiFiles.filter((f) => f.includes("/cron/"));
const nonCronApi = apiFiles.filter((f) => !f.includes("/cron/") && !f.includes("/health/") && !f.includes("/cap/"));

for (const f of cronFiles) {
  const src = readFileSync(f, "utf8");
  assert(!src.includes('searchParams.get("secret")'), `${f}: niente ?secret=`);
  assert(
    src.includes("authorizeCronRequest") || src.includes("Bearer"),
    `${f}: usa authorizeCronRequest / Bearer`,
  );
}

for (const f of nonCronApi) {
  const src = readFileSync(f, "utf8");
  if (!src.includes("export async function")) continue;
  // Route autenticate: devono usare requireApiSession, non getSession JWT-only
  if (src.includes('from "@/lib/auth"')) {
    assert(
      src.includes("requireApiSession") || src.includes("requireSession"),
      `${f}: sessione API con requireApiSession`,
    );
    assert(!/\bgetSession\b/.test(src), `${f}: non usare getSession nelle API`);
  }
}

const ocr = readFileSync("src/lib/ocr/analyze.ts", "utf8");
assert(!ocr.includes("K87899142388957"), "OCR: niente chiave demo OCR.space");
assert(
  ocr.includes("OCRSPACE_API_KEY") && ocr.includes("non configurato"),
  "OCR: richiede OCRSPACE_API_KEY esplicita",
);

assert(PASSWORD_MIN_LENGTH >= 12, `PASSWORD_MIN_LENGTH default >= 12 (got ${PASSWORD_MIN_LENGTH})`);
assert(!validatePassword("Admin123!").ok, "block password corta Admin123!");
assert(!validatePassword("password12345").ok, "block password comune");
assert(validatePassword("AdminSecure123!").ok, "accetta password conforme");

const auth = readFileSync("src/lib/auth.ts", "utf8");
assert(auth.includes("requireApiSession"), "auth.ts espone requireApiSession");

const security = readFileSync("src/lib/security-log.ts", "utf8");
assert(security.includes("Fail-closed") || security.includes("blocked: true"), "rate limit fail-closed");

if (failed > 0) {
  console.error(`\n${failed} check falliti`);
  process.exit(1);
}
console.log("\nTutti i check P0.3 ok");
