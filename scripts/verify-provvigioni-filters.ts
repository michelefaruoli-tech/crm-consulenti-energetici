/**
 * Verifica allineamento card vs filtri stato per un collaboratore.
 * Uso: npx tsx scripts/verify-provvigioni-filters.ts "Marco Fagiano"
 */
import { prisma } from "../src/lib/prisma";
import {
  buildProvvigioniContractWhere,
} from "../src/lib/provvigioni-filters";
import { loadProvvigioniFinancialSummary } from "../src/lib/provvigioni-summary";

async function main() {
  const nameQuery = process.argv[2] ?? "Marco Fagiano";
  const user = await prisma.user.findFirst({
    where: { name: { contains: nameQuery, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!user) {
    console.error("Collaboratore non trovato:", nameQuery);
    process.exit(1);
  }

  const base = buildProvvigioniContractWhere({
    canViewAll: true,
    sessionUserId: user.id,
    collab: user.id,
    recurrenceMode: "all",
  });

  const summary = await loadProvvigioniFinancialSummary(base, "tutti", null);

  for (const stato of ["Incassato", "Da incassare", "Pagato"] as const) {
    const where = buildProvvigioniContractWhere({
      canViewAll: true,
      sessionUserId: user.id,
      collab: user.id,
      stato,
      recurrenceMode: "all",
    });
    const count = await prisma.contract.count({ where });
    console.log(`${user.name} · ${stato}: ${count} contratti (card: ${
      stato === "Incassato"
        ? summary.incassatoCount
        : stato === "Da incassare"
          ? summary.daIncassareCount
          : summary.pagatoCount
    })`);
  }

  console.log("Card importi:", {
    incassato: summary.incassatoAmount,
    daIncassare: summary.daIncassareAmount,
    pagato: summary.pagatoAmount,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
