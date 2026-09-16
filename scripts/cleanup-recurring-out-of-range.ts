/**
 * Bonifica dei mesi ricorrenti fuori intervallo di fornitura (riga di comando).
 *
 * Stessa logica del pulsante nel CRM (pagina «Backup e sicurezza» → «Bonifica
 * mesi ricorrenti fuori intervallo»): entrambi chiamano le funzioni di
 * `src/lib/recurring-cleanup.ts`, così i due percorsi non possono divergere.
 *
 * Regola applicata (vedi `src/lib/recurring-window.ts`):
 *   - nessuna rata prima del mese di inizio fornitura (mese di ingresso incluso
 *     anche se la fornitura parte a metà mese);
 *   - nessuna rata dopo il mese di chiusura/cessazione (mese di chiusura incluso;
 *     `expiryDate` = giorno di uscita, quindi ultimo mese = mese del giorno prima).
 *
 * Sicurezza:
 *   - MODALITÀ PREDEFINITA = SOLA ANTEPRIMA: non scrive nulla.
 *   - Elimina solo rate senza valore economico (PENDING / MISSING / CLOSED,
 *     senza `paidAt` né `settledPeriod`).
 *   - Le rate fuori intervallo già incassate (PAID), pagate (LIQUIDATED) o
 *     segnalate (ERROR_UNPAID) NON vengono toccate: sono elencate a parte come
 *     casi da decidere a mano.
 *   - Nessuna transazione (adapter Neon HTTP): solo `deleteMany` a lotti.
 *   - Idempotente: rieseguendolo, l'anteprima risulta vuota.
 *
 * Uso (DATABASE_URL va nell'ambiente, mai nel file):
 *   npx tsx scripts/cleanup-recurring-out-of-range.ts              # anteprima
 *   npx tsx scripts/cleanup-recurring-out-of-range.ts --apply      # esegue
 *   npx tsx scripts/cleanup-recurring-out-of-range.ts --contract=<id>
 *   npx tsx scripts/cleanup-recurring-out-of-range.ts --max-detail=50
 */
import "dotenv/config";
// Stesso client dell'app (adapter Neon HTTP, nessuna transazione disponibile).
import { prisma } from "../src/lib/prisma";
import {
  CLEANUP_APPLY_BATCH,
  cleanupRecurringOutOfRange,
  scanRecurringOutOfRange,
  type ContractCleanupFinding,
} from "../src/lib/recurring-cleanup";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante nell'ambiente.");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CONTRACT_ID =
  args.find((a) => a.startsWith("--contract="))?.split("=")[1] ?? null;
const MAX_DETAIL =
  Number(args.find((a) => a.startsWith("--max-detail="))?.split("=")[1]) || 40;

async function main() {
  const findings: ContractCleanupFinding[] = [];
  let scannedContracts = 0;
  let scannedMonths = 0;
  let removableTotal = 0;
  let manualTotal = 0;
  let cursor: string | null = null;

  do {
    const scan = await scanRecurringOutOfRange({
      cursor,
      contractId: CONTRACT_ID,
    });
    findings.push(...scan.findings);
    scannedContracts += scan.scannedContracts;
    scannedMonths += scan.scannedMonths;
    removableTotal += scan.removableCount;
    manualTotal += scan.manualCount;
    cursor = scan.nextCursor;
  } while (cursor);

  console.log("=== Bonifica mesi ricorrenti fuori intervallo ===");
  console.log(APPLY ? "MODALITÀ: ESECUZIONE (--apply)" : "MODALITÀ: SOLA ANTEPRIMA");
  if (CONTRACT_ID) console.log(`Filtro contratto: ${CONTRACT_ID}`);
  console.log(`Contratti con rate ricorrenti: ${scannedContracts}`);
  console.log(`Rate ricorrenti totali esaminate: ${scannedMonths}`);
  console.log(`Contratti con rate fuori intervallo: ${findings.length}`);
  console.log(`Rate da rimuovere (senza valore economico): ${removableTotal}`);
  console.log(`Rate fuori intervallo già incassate/pagate/segnalate: ${manualTotal}`);
  console.log("");

  const detail = [...findings].sort(
    (a, b) =>
      b.removable.length + b.manual.length - (a.removable.length + a.manual.length),
  );

  console.log(`--- Dettaglio per contratto (primi ${MAX_DETAIL}) ---`);
  for (const f of detail.slice(0, MAX_DETAIL)) {
    console.log(
      `${f.label}\n  contratto ${f.contractId} · intervallo ${f.windowLabel}` +
        ` · da rimuovere ${f.removable.length} · da decidere ${f.manual.length}`,
    );
    if (f.removable.length > 0) {
      console.log(
        `    rimuovibili: ${f.removable
          .map((r) => `${r.period} (${r.status}, ${r.reason})`)
          .join(", ")}`,
      );
    }
    for (const m of f.manual) {
      console.log(
        `    ⚠ DA DECIDERE: ${m.period} · ${m.status} · importo ${m.amount ?? "—"}` +
          ` · rendiconto ${m.settledPeriod ?? "—"} · ${m.reason}`,
      );
    }
  }
  if (detail.length > MAX_DETAIL) {
    console.log(`  … altri ${detail.length - MAX_DETAIL} contratti non mostrati.`);
  }
  console.log("");

  if (manualTotal > 0) {
    console.log(
      `⚠ ${manualTotal} rate fuori intervallo risultano incassate/pagate/segnalate:` +
        " non vengono toccate nemmeno con --apply. Vanno decise una a una.",
    );
  }

  if (!APPLY) {
    console.log(
      "Anteprima terminata: nessuna modifica scritta. Per eseguire: --apply",
    );
    await prisma.$disconnect();
    return;
  }

  const contractIds = findings
    .filter((f) => f.removable.length > 0)
    .map((f) => f.contractId);
  let deleted = 0;
  for (let offset = 0; offset < contractIds.length; offset += CLEANUP_APPLY_BATCH) {
    const chunk = contractIds.slice(offset, offset + CLEANUP_APPLY_BATCH);
    const res = await cleanupRecurringOutOfRange(chunk);
    deleted += res.deleted;
    console.log(
      `  bonificati ${Math.min(offset + chunk.length, contractIds.length)}/${contractIds.length} contratti · rate rimosse ${deleted}`,
    );
  }

  console.log(`Fatto: ${deleted} rate rimosse, ${manualTotal} lasciate da decidere.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
