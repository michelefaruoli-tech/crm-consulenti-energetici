/**
 * Verifica che ogni file "use server" esporti SOLO funzioni async.
 *
 * Next.js valida questa regola a runtime (module evaluation), non in build:
 * un export non conforme fa fallire l'intera route con
 * "An error occurred in the Server Components render" senza dettagli.
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
/** I tipi vengono cancellati in compilazione: sempre ammessi. */
const TYPE_ONLY = /^export\s+(type|interface)\s/;

/** La direttiva sta in cima al file, ma può essere preceduta da commenti. */
function isUseServerFile(content: string): boolean {
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const first = withoutComments.split("\n").find((l) => l.trim());
  return /^["']use server["']/.test(first?.trim() ?? "");
}

function main() {
  const problems: string[] = [];
  let scanned = 0;

  for (const file of walk(SRC)) {
    const content = readFileSync(file, "utf8");
    if (!isUseServerFile(content)) continue;
    scanned++;

    content.split("\n").forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("export")) return;
      if (ALLOWED.test(trimmed) || TYPE_ONLY.test(trimmed)) return;
      problems.push(
        `${relative(process.cwd(), file)}:${i + 1}  ${trimmed.slice(0, 90)}`,
      );
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
