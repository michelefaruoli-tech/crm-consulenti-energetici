/**
 * Crea/riapre le rate annuali R dovute (+12) anche oltre expiry formale.
 *
 * Uso:
 *   DATABASE_URL=… npx tsx scripts/apply-annual-r-due.ts --dry
 *   DATABASE_URL=… npx tsx scripts/apply-annual-r-due.ts --apply
 *   (build Vercel production) npm run db:annual-r-due:prod
 *
 * Neon HTTP: loop find + create/update (niente $transaction / createMany / updateMany).
 * Idempotente.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  isAnnualNextHidden,
  listAnnualDuePeriodsThrough,
  toPeriod,
} from "../src/lib/recurring";
import { computeSupplyStartDate } from "../src/lib/supply-dates";

/** Allineato a `RECURRING_AUTO_CLOSED_NOTE` in recurring-window.ts (evita import @/). */
const AUTO_CLOSED_NOTES = new Set([
  "Esclusa: precedente all'ingresso in fornitura",
  "Esclusa: successiva alla chiusura del contratto",
  "Esclusa: Helios non ha ancora pagato questa competenza (lag 2 mesi)",
]);

const APPLY_FLAG = process.argv.includes("--apply");
const APPLY_IF_PROD = process.argv.includes("--apply-if-production");
const APPLY =
  APPLY_FLAG ||
  (APPLY_IF_PROD && process.env.VERCEL_ENV === "production");
const DRY = !APPLY || process.argv.includes("--dry");

/** POD segnalati da Michele (Vitucci + Quadrifoglio). */
const FOCUS_PODS = new Set([
  "IT001E893331336",
  "IT001E11522524",
  "IT001E11522519",
  "IT001E11522516",
  "IT001E11522523",
  "IT001E11522521",
]);

const OPEN_STATUSES = new Set(["PENDING", "MISSING"]);
const PRESERVED = new Set([
  "PAID",
  "LIQUIDATED",
  "ERROR_UNPAID",
]);

if (APPLY_IF_PROD && process.env.VERCEL_ENV !== "production") {
  console.log(
    `[skip] VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} — apply annuali R dovute solo in production build`,
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante (.env.local o env)");
  process.exit(APPLY_IF_PROD ? 0 : 1);
}

const prisma = new PrismaClient({
  adapter: new PrismaNeonHttp(process.env.DATABASE_URL, {
    arrayMode: false,
    fullResults: true,
  }),
});

type MonthRow = {
  id: string;
  period: string;
  status: string;
  note: string | null;
  amount: unknown;
};

function normalizePod(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function supplyStartPeriod(contract: {
  insertionDate: Date | null;
  supplyStartDate: Date | null;
  operationType: string | null;
}): string {
  const start =
    contract.supplyStartDate ??
    computeSupplyStartDate(contract.insertionDate ?? new Date(), contract.operationType);
  return toPeriod(start);
}

function isAutoClosed(row: MonthRow): boolean {
  if (row.status !== "CLOSED") return false;
  return AUTO_CLOSED_NOTES.has(row.note ?? "") || isAnnualNextHidden(row.note);
}

async function upsertDuePeriod(args: {
  contractId: string;
  period: string;
  amount: number | null;
  nowPeriod: string;
  existing: MonthRow | null;
}): Promise<"created" | "reopened" | "already_ok" | "skipped"> {
  const { contractId, period, amount, nowPeriod, existing } = args;
  const status = period < nowPeriod ? "MISSING" : "PENDING";

  if (!existing) {
    if (DRY) return "created";
    try {
      await prisma.recurringMonth.create({
        data: {
          contractId,
          period,
          status,
          amount,
          paidAt: null,
        },
      });
      return "created";
    } catch (e) {
      // Race / riga già presente: verifica e eventuale riapertura.
      const again = await prisma.recurringMonth.findFirst({
        where: { contractId, period },
        select: {
          id: true,
          period: true,
          status: true,
          note: true,
          amount: true,
        },
      });
      if (!again) throw e;
      if (OPEN_STATUSES.has(again.status) || PRESERVED.has(again.status)) {
        return "already_ok";
      }
      await prisma.recurringMonth.update({
        where: { id: again.id },
        data: {
          status,
          amount: amount ?? (again.amount == null ? null : Number(again.amount)),
          paidAt: null,
          settledPeriod: null,
          note: isAnnualNextHidden(again.note) ? null : again.note,
        },
      });
      return "reopened";
    }
  }

  if (PRESERVED.has(existing.status)) return "already_ok";
  if (OPEN_STATUSES.has(existing.status)) return "already_ok";

  const reopen =
    existing.status === "CLOSED" || isAnnualNextHidden(existing.note);
  if (!reopen && !isAutoClosed(existing)) return "skipped";

  if (DRY) return "reopened";
  await prisma.recurringMonth.update({
    where: { id: existing.id },
    data: {
      status,
      amount: amount ?? (existing.amount == null ? null : Number(existing.amount)),
      paidAt: null,
      settledPeriod: null,
      note: isAnnualNextHidden(existing.note) ? null : existing.note,
    },
  });
  return "reopened";
}

async function main() {
  const nowDate = new Date();
  const nowPeriod = toPeriod(nowDate);

  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      isHistorical: false,
      recurrenceKind: "R",
      status: { notIn: ["ANNULLATO", "KO"] },
    },
    select: {
      id: true,
      insertionDate: true,
      supplyStartDate: true,
      operationType: true,
      collectionDate: true,
      pod: true,
      podPdr: true,
      client: { select: { name: true } },
      supplier: { select: { name: true } },
      commission: { select: { expected: true } },
      recurringMonths: {
        select: {
          id: true,
          period: true,
          status: true,
          note: true,
          amount: true,
        },
      },
    },
    orderBy: { insertionDate: "asc" },
  });

  console.log(`[annual-r-due] contratti R attivi: ${contracts.length}`);
  console.log(`[annual-r-due] nowPeriod=${nowPeriod} dry=${DRY}`);

  let candidates = 0;
  let created = 0;
  let reopened = 0;
  let alreadyOk = 0;
  let skippedNotDue = 0;
  let skippedOther = 0;
  let errors = 0;

  const focusResults: Array<{
    pod: string;
    client: string;
    supplier: string;
    period: string | null;
    status: string | null;
    action: string;
  }> = [];

  for (const contract of contracts) {
    const paidPeriods = contract.recurringMonths
      .filter((r) => r.status === "PAID" || r.status === "LIQUIDATED")
      .map((r) => r.period);
    const firstYearCollected =
      Boolean(contract.collectionDate) || paidPeriods.length > 0;
    if (!firstYearCollected) {
      skippedNotDue++;
      continue;
    }

    const start = supplyStartPeriod(contract);
    const duePeriods = listAnnualDuePeriodsThrough(start, paidPeriods, nowPeriod);
    if (duePeriods.length === 0) {
      skippedNotDue++;
      continue;
    }

    candidates++;
    const amount = Number(contract.commission?.expected ?? 0) || null;
    const byPeriod = new Map(
      contract.recurringMonths.map((r) => [r.period, r] as const),
    );
    const pod = normalizePod(contract.pod || contract.podPdr);

    for (const period of duePeriods) {
      const existing = byPeriod.get(period) ?? null;
      try {
        const action = await upsertDuePeriod({
          contractId: contract.id,
          period,
          amount,
          nowPeriod,
          existing,
        });
        if (action === "created") {
          created++;
          console.log(
            `[ok] CREATA ${contract.client.name} ${pod} ${period} (${contract.supplier.name})`,
          );
        } else if (action === "reopened") {
          reopened++;
          console.log(
            `[ok] RIAPERTA ${contract.client.name} ${pod} ${period} (${contract.supplier.name})`,
          );
        } else if (action === "already_ok") {
          alreadyOk++;
        } else {
          skippedOther++;
        }

        if (FOCUS_PODS.has(pod)) {
          focusResults.push({
            pod,
            client: contract.client.name,
            supplier: contract.supplier.name,
            period,
            status:
              action === "created" || action === "reopened"
                ? period < nowPeriod
                  ? "MISSING"
                  : "PENDING"
                : existing?.status ?? null,
            action,
          });
        }
      } catch (e) {
        errors++;
        console.error(
          `[err] ${contract.id} ${pod} ${period}`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  // Verifica finale focus POD da DB (anche dry: solo lettura stato attuale).
  console.log("[focus] verifica POD segnalati");
  for (const pod of FOCUS_PODS) {
    const row = await prisma.contract.findFirst({
      where: {
        deletedAt: null,
        isHistorical: false,
        recurrenceKind: "R",
        OR: [
          { pod: { equals: pod, mode: "insensitive" } },
          { podPdr: { equals: pod, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        insertionDate: true,
        supplyStartDate: true,
        operationType: true,
        collectionDate: true,
        client: { select: { name: true } },
        supplier: { select: { name: true } },
        recurringMonths: {
          select: { period: true, status: true },
          orderBy: { period: "asc" },
        },
      },
    });
    if (!row) {
      console.warn(`[focus] POD ${pod}: contratto R non trovato`);
      continue;
    }
    const paidPeriods = row.recurringMonths
      .filter((r) => r.status === "PAID" || r.status === "LIQUIDATED")
      .map((r) => r.period);
    const start = supplyStartPeriod(row);
    const due = listAnnualDuePeriodsThrough(start, paidPeriods, nowPeriod);
    const target = due[0] ?? null;
    const month = target
      ? row.recurringMonths.find((r) => r.period === target) ?? null
      : null;
    const operational =
      month &&
      (OPEN_STATUSES.has(month.status) ||
        month.status === "PAID" ||
        month.status === "LIQUIDATED");
    console.log(
      `[focus] ${row.client.name} | ${pod} | ${row.supplier.name} | due=${target ?? "-"} | status=${month?.status ?? "ASSENTE"} | ${operational ? "OK" : "MANCANTE"}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: DRY ? "dry" : "apply",
        nowPeriod,
        contracts: contracts.length,
        candidates,
        created,
        reopened,
        alreadyOk,
        skippedNotDue,
        skippedOther,
        errors,
        focusActions: focusResults,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  // In production build non far fallire il deploy (come annual-past-years).
  if (errors > 0 && !APPLY_IF_PROD) process.exit(1);
  if (errors > 0 && APPLY_IF_PROD) {
    console.error(
      `[annual-r-due] ${errors} errori durante apply — continuo il build; sync/cron o rilancio possono completare`,
    );
  }
}

main().catch(async (e) => {
  console.error("[annual-r-due]", e);
  await prisma.$disconnect().catch(() => undefined);
  if (APPLY_IF_PROD) {
    console.error(
      "[annual-r-due] apply fallito in build — continuo; sync/cron o rilancio possono riparare",
    );
    process.exit(0);
  }
  process.exit(1);
});
