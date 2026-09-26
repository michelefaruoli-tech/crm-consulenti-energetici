/**
 * Verifica che ogni file "use server" esporti SOLO funzioni async (più
 * dichiarazioni di tipo, che vengono cancellate in compilazione).
 *
 * Next.js valida questa regola a runtime (module evaluation), non in build:
 * un export non conforme fa fallire l'intera route con
 * "An error occurred in the Server Components render" senza dettagli — e
 * porta con sé TUTTE le altre server action della stessa pagina, perché
 * Next raggruppa le action di una route in un unico chunk "actions loader":
 * se un modulo di quel chunk lancia un errore in fase di valutazione,
 * nessuna azione della pagina funziona più (verificato: bug PR #24).
 *
 * Caso specifico verificato: `export type { A, B };` SENZA `from "…"` in un
 * file "use server" causa `ReferenceError: A is not defined` a runtime,
 * anche se A/B sono stati importati con `import type` / `import { type A }`
 * (quindi già cancellati dalla compilazione TypeScript) — il plugin "use
 * server" di Next scansiona gli export prima che siano cancellati e prova a
 * generare un riferimento anche per un binding che non esiste più.
 * `export type { A, B } from "…"` (con `from`, puro passthrough) è invece
 * già usato altrove in produzione senza problemi: resta ammesso.
 *
 * Uso: npx tsx scripts/check-server-actions.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

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

/** Export ammessi in un file "use server": solo `export async function`. */
const ALLOWED = /^export\s+async\s+function\s/;
/** `export type Foo = …` / `export interface Foo {…}`: identificatore locale, sempre ammesso. */
const TYPE_ALIAS_OR_INTERFACE = /^export\s+(type\s+\w|interface\s+\w)/;

/** La direttiva sta in cima al file, ma può essere preceduta da commenti. */
function isUseServerFile(content: string): boolean {
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const first = withoutComments.split("\n").find((l) => l.trim());
  return /^["']use server["']/.test(first?.trim() ?? "");
}

type BraceTypeExport = {
  /** Riga (1-based) dove inizia lo statement `export type {`. */
  startLine: number;
  /** Riga (1-based) dove finisce (il `;` finale). */
  endLine: number;
  hasFrom: boolean;
};

/**
 * Trova tutti gli statement `export type { A, B, … } [from "…"];`, anche
 * multi-riga, e dice per ciascuno se ha la clausola `from` (ammessa) o no
 * (vietata: causa `ReferenceError` a runtime nel bundle Server Actions).
 */
function findBraceTypeExports(content: string): BraceTypeExport[] {
  const regex = /export\s+type\s*\{[\s\S]*?\}\s*(from\s*(["'])[^"']*\2)?\s*;/g;
  const results: BraceTypeExport[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content))) {
    const startLine = content.slice(0, m.index).split("\n").length;
    const endLine = startLine + m[0].split("\n").length - 1;
    results.push({ startLine, endLine, hasFrom: Boolean(m[1]) });
  }
  return results;
}

function main() {
  const problems: string[] = [];
  let scanned = 0;

  for (const file of walk(SRC)) {
    const content = readFileSync(file, "utf8");
    if (!isUseServerFile(content)) continue;
    scanned++;
    const relPath = relative(process.cwd(), file);

    const braceExports = findBraceTypeExports(content);
    const coveredLines = new Set<number>();
    for (const be of braceExports) {
      for (let l = be.startLine; l <= be.endLine; l++) coveredLines.add(l);
      if (!be.hasFrom) {
        problems.push(
          `${relPath}:${be.startLine}  export type { ... } senza "from" — VIETATO in file ` +
            `"use server": causa "X is not defined" a runtime (bug reale, vedi PR #24). ` +
            `Importa il tipo direttamente dal modulo originale nel file che lo usa, oppure ` +
            `usa "export type { X } from './modulo'" (con from, questo è ammesso).`,
        );
      }
    }

    content.split("\n").forEach((line, i) => {
      const lineNo = i + 1;
      if (coveredLines.has(lineNo)) return;
      const trimmed = line.trim();
      if (!trimmed.startsWith("export")) return;
      if (ALLOWED.test(trimmed) || TYPE_ALIAS_OR_INTERFACE.test(trimmed)) return;
      problems.push(`${relPath}:${lineNo}  ${trimmed.slice(0, 90)}`);
    });
  }

  if (problems.length > 0) {
    console.error(
      '\n❌ Export non validi in file "use server" (ammesse solo funzioni async):\n',
    );
    for (const p of problems) console.error(`   ${p}`);
    console.error(
      "\n   Sposta costanti e helper in un modulo separato senza \"use server\".\n",
    );
    process.exit(1);
  }

  console.log(
    `✅ ${scanned} file "use server" controllati: esportano solo funzioni async.`,
  );
}

main();
