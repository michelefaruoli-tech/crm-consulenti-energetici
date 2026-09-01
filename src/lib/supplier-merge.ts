import { prisma } from "@/lib/prisma";
import {
  canonicalSupplierName,
  stripMergedSupplierLabel,
} from "@/lib/supplier-names";

export { canonicalSupplierName, stripMergedSupplierLabel };

export type MergeSuppliersResult = {
  groups: Array<{
    canonical: string;
    keptId: string;
    keptName: string;
    mergedIds: string[];
    contractsMoved: number;
    rulesMoved: number;
    deactivated: number;
  }>;
};

/**
 * Unisce in DB i fornitori con stesso nome canonico (Enel*, Edison*).
 * Tiene quello con più contratti (a parità, nome esatto «Enel»/«Edison»).
 */
export async function mergeDuplicateSuppliers(): Promise<MergeSuppliersResult> {
  const all = await prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
      stornoMonths: true,
      email: true,
      _count: { select: { contracts: true, commissionRules: true } },
    },
  });

  const byCanon = new Map<string, typeof all>();
  for (const s of all) {
    const canon = canonicalSupplierName(s.name);
    if (canon !== "Enel" && canon !== "Edison") continue;
    const list = byCanon.get(canon) ?? [];
    list.push(s);
    byCanon.set(canon, list);
  }

  const groups: MergeSuppliersResult["groups"] = [];

  for (const [canonical, list] of byCanon) {
    if (list.length < 2) {
      // Rinomina comunque se è una sola variante (es. solo «Enel Energia»)
      const only = list[0];
      if (only && only.name !== canonical) {
        await prisma.supplier.update({
          where: { id: only.id },
          data: { name: canonical },
        });
        groups.push({
          canonical,
          keptId: only.id,
          keptName: canonical,
          mergedIds: [],
          contractsMoved: 0,
          rulesMoved: 0,
          deactivated: 0,
        });
      }
      continue;
    }

    list.sort((a, b) => {
      const exactA = a.name === canonical ? 1 : 0;
      const exactB = b.name === canonical ? 1 : 0;
      if (exactB !== exactA) return exactB - exactA;
      if (b._count.contracts !== a._count.contracts) {
        return b._count.contracts - a._count.contracts;
      }
      return b._count.commissionRules - a._count.commissionRules;
    });

    const keep = list[0]!;
    const others = list.slice(1);
    let contractsMoved = 0;
    let rulesMoved = 0;

    for (const other of others) {
      // SQL grezzo: Prisma avvolge updateMany in una transazione, non supportata
      // dall'adapter Neon HTTP.
      contractsMoved += await prisma.$executeRawUnsafe(
        `UPDATE "Contract" SET "supplierId" = $1 WHERE "supplierId" = $2`,
        keep.id,
        other.id,
      );

      rulesMoved += await prisma.$executeRawUnsafe(
        `UPDATE "CommissionRule" SET "supplierId" = $1 WHERE "supplierId" = $2`,
        keep.id,
        other.id,
      );

      await prisma.$executeRawUnsafe(
        `UPDATE "Service" SET "supplierId" = $1 WHERE "supplierId" = $2`,
        keep.id,
        other.id,
      );

      // Disattiva con nome interno: niente «Enel (unito in…)» in filtri/ricerche
      const mergedCode = `${other.code}_MERGED_${Date.now()}`.slice(0, 60);
      await prisma.supplier.update({
        where: { id: other.id },
        data: {
          active: false,
          name: `_archivio_${canonical.toLowerCase()}_${other.id.slice(-6)}`,
          code: mergedCode,
        },
      });
    }

    if (keep.name !== canonical || !keep.active) {
      await prisma.supplier.update({
        where: { id: keep.id },
        data: {
          name: canonical,
          active: true,
          // Conserva storno se il keep non lo ha ma un duplicato sì
          ...(keep.stornoMonths == null
            ? {
                stornoMonths:
                  others.find((o) => o.stornoMonths != null)?.stornoMonths ??
                  undefined,
              }
            : {}),
        },
      });
    }

    groups.push({
      canonical,
      keptId: keep.id,
      keptName: canonical,
      mergedIds: others.map((o) => o.id),
      contractsMoved,
      rulesMoved,
      deactivated: others.length,
    });
  }

  return { groups };
}
