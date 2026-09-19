import type { PrismaClient } from "@/generated/prisma/client";
import { allDolomitiListinoOffers } from "@/lib/cte-dolomiti-listino";

export async function upsertDolomitiListinoOffers(
  prisma: PrismaClient,
  supplierId: string,
): Promise<{ created: number; updated: number }> {
  const rows = allDolomitiListinoOffers();
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await prisma.cteOffer.findFirst({
      where: {
        supplierId,
        offerName: row.offerName,
        utility: row.utility,
        category: row.category,
      },
      select: { id: true },
    });
    const data = {
      supplierId,
      utility: row.utility,
      category: row.category,
      commercialSegment: row.commercialSegment,
      offerName: row.offerName,
      priceKind: row.priceKind,
      networkLosses: row.utility === "GAS" ? ("NOT_APPLICABLE" as const) : ("INCLUDED" as const),
      ccvAnnual: row.ccvAnnual,
      ccvMonthly: row.ccvMonthly,
      spread: row.spread,
      validTo: row.validTo ? new Date(`${row.validTo}T00:00:00.000Z`) : null,
      notes: row.notes,
      extractionStatus: "confirmed",
      active: true,
    };
    let offerId: string;
    if (existing) {
      await prisma.cteOffer.update({ where: { id: existing.id }, data });
      offerId = existing.id;
      updated += 1;
    } else {
      const createdRow = await prisma.cteOffer.create({ data });
      offerId = createdRow.id;
      created += 1;
    }
    const oldBands = await prisma.ctePriceBand.findMany({
      where: { cteOfferId: offerId },
      select: { id: true },
    });
    for (const band of oldBands) {
      await prisma.ctePriceBand.delete({ where: { id: band.id } });
    }
    for (let i = 0; i < row.bands.length; i++) {
      const band = row.bands[i]!;
      await prisma.ctePriceBand.create({
        data: {
          cteOfferId: offerId,
          timeBand: band.timeBand,
          energyPrice: band.energyPrice,
          sortOrder: i,
        },
      });
    }
  }
  return { created, updated };
}
