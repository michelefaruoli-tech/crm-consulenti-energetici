/**
 * Blocca le operazioni Prisma incompatibili con l'adapter Neon HTTP.
 *
 * `PrismaNeonHttp` non apre transazioni. Prisma pero' avvolge implicitamente
 * `updateMany` e `createMany` in una transazione, quindi falliscono SEMPRE a
 * runtime con "Transactions are not supported in HTTP mode" — senza che build
 * o type-check se ne accorgano.
 *
 * Verificato sul database reale (agosto 2026):
 *   updateMany  -> errore      createMany -> errore
 *   deleteMany  -> funziona    $executeRawUnsafe -> funziona
 *
 * Alternativa: una singola statement con `prisma.$executeRawUnsafe(...)`
 * e parametri posizionali ($1, $2, ...), oppure `update` uno-a-uno.
 *
 * Uso: npx tsx scripts/check-neon-http.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

const FORBIDDEN = [
  {
    pattern: /\.updateMany\s*\(/,
    what: "updateMany",
    fix: "usa $executeRawUnsafe con una sola UPDATE, oppure update uno-a-uno",
  },
  {
    pattern: /\.createMany\s*\(/,
    what: "createMany",
    fix: "usa create in ciclo, oppure una INSERT multipla con $executeRawUnsafe",
  },
  {
    pattern: /\$transaction\s*\(/,
    what: "$transaction",
    fix: "le transazioni con scritture non sono supportate: separa le operazioni",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const problems: string[] = [];

  for (const file of walk(SRC)) {
    // Il client generato contiene le definizioni dei metodi: non e' codice nostro.
    if (file.includes(join("src", "generated"))) continue;

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const trimmed = line.trim();
        // Righe di solo commento (`//`, `/* …`, `/** …`, `* …`): non sono codice.
        if (/^(\/\/|\/\*|\*)/.test(trimmed)) return;
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(line)) {
            problems.push(
              `${relative(process.cwd(), file)}:${i + 1}  ${rule.what} — ${rule.fix}`,
            );
          }
        }
      });
  }

  if (problems.length > 0) {
    console.error(
      "\n❌ Operazioni non supportate dall'adapter Neon HTTP (falliscono a runtime):\n",
    );
    for (const p of problems) console.error(`   ${p}`);
    console.error("");
    process.exit(1);
  }

  console.log("✅ Nessuna operazione Prisma incompatibile con Neon HTTP.");
}

main();
