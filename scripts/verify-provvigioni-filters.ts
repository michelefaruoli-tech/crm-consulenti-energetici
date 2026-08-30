/**
 * Verifica allineamento card vs filtri stato per un collaboratore.
 * Uso: npx tsx scripts/verify-provvigioni-filters.ts "Marco Fagiano"
 */
import { prisma } from "../src/lib/prisma";
import { buildProvvigioniContractWhere, buildProvvigioniListWhere } from "../src/lib/provvigioni-filters";
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

  const base = {
    canViewAll: true,
    sessionUserId: user.id,
    collab: user.id,
    recurrenceMode: "all" as const,
  };

  const summary = await loadProvvigioniFinancialSummary(base, "tutti", {
    applyCompetenceToList: false,
  });

  for (const stato of ["Incassato", "Da incassare", "Pagato"] as const) {
    const where = buildProvvigioniListWhere({
      filters: { ...base, stato },
      applyCompetenceToList: false,
    });
    const count = await prisma.contract.count({ where });
    const cardCount =
      stato === "Incassato"
        ? summary.incassatoCount
        : stato === "Da incassare"
          ? summary.daIncassareCount
          : summary.pagatoCount;
    const ok = count === cardCount ? "OK" : "MISMATCH";
    console.log(`${ok} ${user.name} · ${stato}: lista=${count} card=${cardCount}`);
  }

  console.log("Importi card:", {
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
