import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Conteggio contratti inseriti per mese (Gen→Dic) di un anno.
 *
 * Usa lo stesso filtro (`where`, tipicamente scope visibilità +
 * `deletedAt: null`) e lo stesso campo data (`insertionDate`) delle card
 * "Inseriti" della Dashboard, così i numeri coincidono sempre con quelli.
 *
 * 12 `count()` indicizzati su range `[inizio mese, inizio mese successivo)`,
 * mai un fetch di righe: efficiente anche con molti contratti, e senza
 * bisogno di `$transaction` (non disponibile con l'adapter Neon HTTP) dato
 * che sono letture indipendenti eseguite in parallelo.
 */
export async function loadMonthlyContractCounts(params: {
  where: Prisma.ContractWhereInput;
  year: number;
}): Promise<number[]> {
  const { where, year } = params;
  return Promise.all(
    Array.from({ length: 12 }, (_, month) =>
      prisma.contract.count({
        where: {
          ...where,
          insertionDate: {
            gte: new Date(year, month, 1),
            lt: new Date(year, month + 1, 1),
          },
        },
      }),
    ),
  );
}
