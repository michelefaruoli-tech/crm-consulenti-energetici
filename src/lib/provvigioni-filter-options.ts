/**
 * Valori disponibili nei menu dei filtri della tabella Provvigioni.
 *
 * Le opzioni arrivano dal database (non dalle righe caricate in pagina) e
 * rispettano gli altri filtri attivi e il perimetro di visibilità del ruolo:
 * un collaboratore non vede nei menu nomi, mesi o importi fuori dal suo scope.
 */
import "server-only";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveProvvigioniQuery,
  type ProvvigioniSearchParams,
} from "@/lib/provvigioni-query";
import {
  EMPTY_FILTER_VALUE,
  MONTH_FILTER_KEYS,
  type ProvvigioniColumnKey,
} from "@/lib/provvigioni-column-filters";
import {
  agencyFromSupplierName,
  effectiveGettone,
  operationTypeLabel,
} from "@/lib/provvigioni-stato";
import { rateStatusesForStatoFilter } from "@/lib/provvigioni-rows";
import { toPeriod } from "@/lib/recurring";

const MAX_OPTIONS = 400;
/** Tetto di sicurezza sulle scansioni per i valori derivati (gettone di listino). */
const DERIVED_SCAN_LIMIT = 3000;

function monthOf(date: Date | null | undefined): string | null {
  if (!date) return null;
  return toPeriod(date);
}

function sortValues(values: Set<string>, numeric: boolean): string[] {
  const list = [...values];
  list.sort((a, b) => {
    if (a === EMPTY_FILTER_VALUE) return 1;
    if (b === EMPTY_FILTER_VALUE) return -1;
    if (numeric) return Number(a) - Number(b);
    return a.localeCompare(b, "it", { numeric: true });
  });
  return list.slice(0, MAX_OPTIONS);
}

export type ProvvigioniFilterOptions = {
  col: ProvvigioniColumnKey;
  kind: "month" | "value";
  values: string[];
};

/** Opzioni della colonna calcolate con gli ALTRI filtri attivi (comportamento Excel). */
export async function loadProvvigioniFilterOptions(
  session: { id: string; role: Role },
  sp: ProvvigioniSearchParams,
  col: ProvvigioniColumnKey,
): Promise<ProvvigioniFilterOptions> {
  const query = await resolveProvvigioniQuery(session, sp, { skipColumn: col });
  const where = query.contractWhere;
  const values = new Set<string>();
  let numeric = false;

  switch (col) {
    case "agency": {
      const [stored, bySupplier] = await Promise.all([
        prisma.contract.findMany({
          where,
          select: { agency: true },
          distinct: ["agency"],
          take: MAX_OPTIONS,
        }),
        prisma.contract.findMany({
          where: { AND: [where, { OR: [{ agency: null }, { agency: "" }] }] },
          select: { supplier: { select: { name: true } } },
          distinct: ["supplierId"],
          take: MAX_OPTIONS,
        }),
      ]);
      for (const row of stored) {
        const value = row.agency?.trim();
        if (value) values.add(value);
      }
      for (const row of bySupplier) {
        values.add(agencyFromSupplierName(row.supplier.name));
      }
      break;
    }
    case "operationType": {
      const rows = await prisma.contract.findMany({
        where,
        select: { operationType: true },
        distinct: ["operationType"],
        take: MAX_OPTIONS,
      });
      for (const row of rows) values.add(operationTypeLabel(row.operationType));
      break;
    }
    case "recurrence": {
      const rows = await prisma.contract.findMany({
        where,
        select: { recurrenceKind: true },
        distinct: ["recurrenceKind"],
        take: 10,
      });
      for (const row of rows) values.add(String(row.recurrenceKind));
      break;
    }
    case "stornoFlag": {
      const [conStorno, senzaStorno] = await Promise.all([
        prisma.contract.count({
          where: { AND: [where, { commission: { stornoDate: { not: null } } }] },
        }),
        prisma.contract.count({
          where: {
            AND: [
              where,
              {
                OR: [{ commission: null }, { commission: { stornoDate: null } }],
              },
            ],
          },
        }),
      ]);
      if (conStorno > 0) values.add("Sì");
      if (senzaStorno > 0) values.add("No");
      break;
    }
    case "meseRif": {
      const statuses = rateStatusesForStatoFilter(query.stato);
      const rows = await prisma.recurringMonth.findMany({
        where: {
          AND: [
            statuses.length > 0 ? { status: { in: statuses } } : {},
            { contract: where },
          ],
        },
        select: { period: true },
        distinct: ["period"],
        orderBy: { period: "desc" },
        take: MAX_OPTIONS,
      });
      for (const row of rows) values.add(row.period);
      break;
    }
    case "supplyStartDate":
    case "collectionMonth": {
      const field =
        col === "supplyStartDate" ? "supplyStartDate" : "collectionDate";
      const rows = await prisma.contract.findMany({
        where,
        select: { supplyStartDate: true, collectionDate: true },
        distinct: [field],
        take: DERIVED_SCAN_LIMIT,
      });
      for (const row of rows) {
        values.add(monthOf(row[field]) ?? EMPTY_FILTER_VALUE);
      }
      if (col === "collectionMonth" && query.expandMode) {
        const statuses = rateStatusesForStatoFilter(query.stato);
        const rates = await prisma.recurringMonth.findMany({
          where: {
            AND: [
              statuses.length > 0 ? { status: { in: statuses } } : {},
              { contract: where },
            ],
          },
          select: { period: true, settledPeriod: true },
          take: MAX_OPTIONS * 4,
        });
        for (const rate of rates) {
          values.add(
            rate.settledPeriod && /^\d{4}-\d{2}$/.test(rate.settledPeriod)
              ? rate.settledPeriod
              : rate.period,
          );
        }
      }
      break;
    }
    case "stornoMonth": {
      const rows = await prisma.commission.findMany({
        where: { contract: where },
        select: { stornoDate: true },
        distinct: ["stornoDate"],
        take: DERIVED_SCAN_LIMIT,
      });
      for (const row of rows) {
        values.add(monthOf(row.stornoDate) ?? EMPTY_FILTER_VALUE);
      }
      break;
    }
    case "amount": {
      numeric = true;
      const [expected, senzaGettone] = await Promise.all([
        prisma.commission.findMany({
          where: { contract: where, expected: { gt: 0 } },
          select: { expected: true },
          distinct: ["expected"],
          take: MAX_OPTIONS,
        }),
        prisma.contract.findMany({
          where: {
            AND: [
              where,
              { OR: [{ commission: null }, { commission: { expected: 0 } }] },
            ],
          },
          select: {
            client: { select: { type: true } },
            supplier: { select: { name: true } },
          },
          take: DERIVED_SCAN_LIMIT,
        }),
      ]);
      for (const row of expected) values.add(String(Number(row.expected)));
      for (const row of senzaGettone) {
        values.add(
          String(
            effectiveGettone({
              expected: 0,
              clientType: row.client.type,
              supplierName: row.supplier.name,
            }) || 0,
          ),
        );
      }
      break;
    }
    case "stornoAmount": {
      numeric = true;
      const rows = await prisma.commission.findMany({
        where: { contract: where },
        select: { stornoAmount: true },
        distinct: ["stornoAmount"],
        take: MAX_OPTIONS,
      });
      for (const row of rows) {
        values.add(
          row.stornoAmount == null
            ? EMPTY_FILTER_VALUE
            : String(Number(row.stornoAmount)),
        );
      }
      break;
    }
    default:
      break;
  }

  return {
    col,
    kind: MONTH_FILTER_KEYS.includes(col) ? "month" : "value",
    values: sortValues(values, numeric),
  };
}
