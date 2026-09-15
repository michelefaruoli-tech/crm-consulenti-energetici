/**
 * Bonifica dei mesi ricorrenti fuori intervallo di fornitura.
 *
 * Regola applicata (identica a `src/lib/recurring-window.ts`):
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
  isDisposableRecurringMonth,
  isPeriodInRecurringWindow,
  outOfWindowReason,
  recurringWindow,
} from "../src/lib/recurring-window";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante nell'ambiente.");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CONTRACT_ID =
  args.find((a) => a.startsWith("--contract="))?.split("=")[1] ?? null;
const MAX_DETAIL = Number(
  args.find((a) => a.startsWith("--max-detail="))?.split("=")[1] ?? 40,
);

type Finding = {
  contractId: string;
  label: string;
  window: string;
  removable: Array<{ id: string; period: string; reason: string; status: string }>;
  manual: Array<{
    id: string;
    period: string;
    reason: string;
    status: string;
    amount: string;
    settledPeriod: string | null;
  }>;
};

function contractLabel(c: {
  podPdr: string | null;
  supplier: { name: string } | null;
  client: {
    type: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
}): string {
  const name =
    c.client?.type === "AZIENDA"
      ? (c.client?.companyName ?? "—")
      : [c.client?.firstName, c.client?.lastName].filter(Boolean).join(" ") || "—";
  return `${name} · ${c.supplier?.name ?? "—"} · POD ${c.podPdr ?? "—"}`;
}

async function main() {
  const contracts = await prisma.contract.findMany({
    where: {
      ...(CONTRACT_ID ? { id: CONTRACT_ID } : {}),
      deletedAt: null,
      recurringMonths: { some: {} },
    },
    select: {
      id: true,
      podPdr: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      status: true,
      expiryDate: true,
      supplier: { select: { name: true } },
      client: {
        select: {
          type: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
      },
      statusHistory: {
        where: { toStatus: "CHIUSO" },
        select: { changedAt: true },
        orderBy: { changedAt: "desc" },
        take: 1,
      },
      recurringMonths: {
        select: {
          id: true,
          period: true,
          status: true,
          amount: true,
          paidAt: true,
          settledPeriod: true,
        },
        orderBy: { period: "asc" },
      },
    },
  });

  const findings: Finding[] = [];
  let totalMonths = 0;

  for (const contract of contracts) {
    totalMonths += contract.recurringMonths.length;
    const window = recurringWindow(contract);
    const finding: Finding = {
      contractId: contract.id,
      label: contractLabel(contract),
      window: `${window.start} → ${window.end ?? "aperto"}`,
      removable: [],
      manual: [],
    };

    for (const month of contract.recurringMonths) {
      if (isPeriodInRecurringWindow(window, month.period)) continue;
      const reason = outOfWindowReason(window, month.period) ?? "fuori intervallo";
      if (isDisposableRecurringMonth(month)) {
        finding.removable.push({
          id: month.id,
          period: month.period,
          reason,
          status: month.status,
        });
      } else {
        finding.manual.push({
          id: month.id,
          period: month.period,
          reason,
          status: month.status,
          amount: month.amount == null ? "—" : String(month.amount),
          settledPeriod: month.settledPeriod,
        });
      }
    }

    if (finding.removable.length > 0 || finding.manual.length > 0) {
      findings.push(finding);
    }
  }

  const removableTotal = findings.reduce((s, f) => s + f.removable.length, 0);
  const manualTotal = findings.reduce((s, f) => s + f.manual.length, 0);

  console.log("=== Bonifica mesi ricorrenti fuori intervallo ===");
  console.log(APPLY ? "MODALITÀ: ESECUZIONE (--apply)" : "MODALITÀ: SOLA ANTEPRIMA");
  if (CONTRACT_ID) console.log(`Filtro contratto: ${CONTRACT_ID}`);
  console.log(`Contratti con rate ricorrenti: ${contracts.length}`);
  console.log(`Rate ricorrenti totali esaminate: ${totalMonths}`);
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
      `${f.label}\n  contratto ${f.contractId} · intervallo ${f.window}` +
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
        `    ⚠ DA DECIDERE: ${m.period} · ${m.status} · importo ${m.amount}` +
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

  const ids = findings.flatMap((f) => f.removable.map((r) => r.id));
  let deleted = 0;
  // Niente transazioni con l'adapter Neon HTTP: deleteMany a lotti.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const res = await prisma.recurringMonth.deleteMany({
      where: { id: { in: batch } },
    });
    deleted += res.count;
    console.log(`  eliminate ${deleted}/${ids.length}`);
  }

  console.log(`Fatto: ${deleted} rate rimosse, ${manualTotal} lasciate da decidere.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
