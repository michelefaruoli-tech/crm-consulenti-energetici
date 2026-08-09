import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { addMonths, toPeriod } from "@/lib/recurring";
import { recurringMonthlyWhereOr } from "@/lib/provvigioni-filters";
import { computeSupplyStartDate } from "@/lib/supply-dates";
import { clientDisplayName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!hasPermission(session.role, "commissions.view_all")) {
    return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }
  const period = addMonths(toPeriod(new Date()), -1);
  const contracts = await prisma.contract.findMany({
    where: {
      isHistorical: false,
      deletedAt: null,
      OR: recurringMonthlyWhereOr,
    },
    select: {
      id: true,
      status: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      client: { select: { type: true, firstName: true, lastName: true, companyName: true } },
      supplier: { select: { name: true } },
      recurringMonths: { where: { period }, select: { status: true } },
    },
  });
  const counts: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  for (const contract of contracts) {
    const start = toPeriod(
      contract.supplyStartDate ??
        computeSupplyStartDate(contract.insertionDate, contract.operationType),
    );
    const installment = contract.recurringMonths[0];
    const category = ["KO", "ANNULLATO", "CHIUSO"].includes(contract.status)
      ? `terminale:${contract.status}`
      : start > period
        ? "ingresso_successivo"
        : installment
          ? `rata:${installment.status}`
          : "rata_assente";
    counts[category] = (counts[category] ?? 0) + 1;
    (examples[category] ??= []);
    if (examples[category].length < 8) {
      examples[category].push(`${clientDisplayName(contract.client)} | ${contract.supplier.name} | ingresso ${start}`);
    }
  }
  return NextResponse.json({ period, total: contracts.length, counts, examples });
}
