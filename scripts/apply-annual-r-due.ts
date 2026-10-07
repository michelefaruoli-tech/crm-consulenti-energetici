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
  isAnnualFirstYearCollected,
  isAnnualNextHidden,
  listAnnualDuePeriodsThrough,
  recurrenceWriteData,
  toPeriod,
} from "../src/lib/recurring";
import { computeSupplyStartDate } from "../src/lib/supply-dates";
import { clientDisplayName } from "../src/lib/utils";

/** Fornitori annuali (R) anche se ancora marcati UT per drift recurrenceKind. */
const ANNUAL_SUPPLIER_HINT =
  /sinergy|etruria|dolomiti|duferco/i;

const CLIENT_NAME_SELECT = {
  type: true,
  companyName: true,
  firstName: true,
  lastName: true,
} as const;

/** Allineato a `RECURRING_AUTO_CLOSED_NOTE` in recurring-window.ts (evita import @/). */
const AUTO_CLOSED_NOTES = new Set([
  "Esclusa: precedente all'ingresso in fornitura",
  "Esclusa: successiva alla chiusura del contratto",
  "Esclusa: Helios non ha ancora pagato questa competenza (lag 2 mesi)",
]);

function clearClosureNote(note: string | null | undefined): string | null {
  if (!note) return null;
  if (AUTO_CLOSED_NOTES.has(note) || isAnnualNextHidden(note)) return null;
  return note;
}

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
  return (value ?? "").trim().toUpperCase().replace(/[\s\-]/g, "");
}

function podMatchesFocus(
  focusPod: string,
  pod: string | null | undefined,
  podPdr: string | null | undefined,
): boolean {
  const target = normalizePod(focusPod);
  const a = normalizePod(pod);
  const b = normalizePod(podPdr);
  if (!target) return false;
  return (
    a === target ||
    b === target ||
    (a.length >= 8 && (a.endsWith(target) || target.endsWith(a))) ||
    (b.length >= 8 && (b.endsWith(target) || target.endsWith(b)))
  );
}

const FOCUS_CONTRACT_SELECT = {
  id: true,
  insertionDate: true,
  supplyStartDate: true,
  operationType: true,
  collectionDate: true,
  status: true,
  paymentStatus: true,
  recurrenceKind: true,
  isHistorical: true,
  pod: true,
  podPdr: true,
  client: { select: CLIENT_NAME_SELECT },
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
} as const;

/** Lookup flessibile: equals Prisma a volte non matcha POD con spazi/casing. */
async function findFocusContractRows(focusPod: string) {
  const tail = focusPod.slice(-10);
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      OR: [
        { pod: { equals: focusPod, mode: "insensitive" } },
        { podPdr: { equals: focusPod, mode: "insensitive" } },
        { pod: { contains: tail, mode: "insensitive" } },
        { podPdr: { contains: tail, mode: "insensitive" } },
      ],
    },
    select: FOCUS_CONTRACT_SELECT,
    take: 30,
  });
  return rows.filter((r) => podMatchesFocus(focusPod, r.pod, r.podPdr));
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
          note: clearClosureNote(again.note),
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
      note: clearClosureNote(existing.note),
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
      status: true,
      paymentStatus: true,
      pod: true,
      podPdr: true,
      client: { select: CLIENT_NAME_SELECT },
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
    const clientLabel = clientDisplayName(contract.client);
    const paidPeriods = contract.recurringMonths
      .filter((r) => r.status === "PAID" || r.status === "LIQUIDATED")
      .map((r) => r.period);
    const pod = normalizePod(contract.pod || contract.podPdr);
    const firstYearCollected = isAnnualFirstYearCollected({
      collectionDate: contract.collectionDate,
      status: contract.status,
      paymentStatus: contract.paymentStatus,
      paidOrLiquidatedPeriods: paidPeriods,
    });
    if (!firstYearCollected) {
      skippedNotDue++;
      if (FOCUS_PODS.has(pod)) {
        console.warn(
          `[focus] SKIP ${clientLabel} | ${pod} | primo anno non incassato (collectionDate=${contract.collectionDate ? "si" : "no"} status=${contract.status} payment=${contract.paymentStatus ?? "-"} paidMonths=${paidPeriods.length})`,
        );
        focusResults.push({
          pod,
          client: clientLabel,
          supplier: contract.supplier.name,
          period: null,
          status: null,
          action: "skipped_first_year",
        });
      }
      continue;
    }

    const start = supplyStartPeriod(contract);
    const duePeriods = listAnnualDuePeriodsThrough(start, paidPeriods, nowPeriod);
    if (duePeriods.length === 0) {
      skippedNotDue++;
      if (FOCUS_PODS.has(pod)) {
        console.warn(
          `[focus] SKIP ${clientLabel} | ${pod} | nessuna competenza dovuta (start=${start} paid=${paidPeriods.join(",") || "-"})`,
        );
        focusResults.push({
          pod,
          client: clientLabel,
          supplier: contract.supplier.name,
          period: null,
          status: null,
          action: "skipped_not_due",
        });
      }
      continue;
    }

    candidates++;
    const amount = Number(contract.commission?.expected ?? 0) || null;
    const byPeriod = new Map(
      contract.recurringMonths.map((r) => [r.period, r] as const),
    );

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
            `[ok] CREATA ${clientLabel} ${pod} ${period} (${contract.supplier.name})`,
          );
        } else if (action === "reopened") {
          reopened++;
          console.log(
            `[ok] RIAPERTA ${clientLabel} ${pod} ${period} (${contract.supplier.name})`,
          );
        } else if (action === "already_ok") {
          alreadyOk++;
        } else {
          skippedOther++;
        }

        if (FOCUS_PODS.has(pod)) {
          focusResults.push({
            pod,
            client: clientLabel,
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

  // Pass focus: lookup flessibile POD (spazi/casing) + apply anche se esclusi dal filtro R stretto.
  console.log("[focus] apply/verifica POD segnalati (lookup flessibile)");
  const focusLines: string[] = [];
  let focusOk = 0;
  let focusMissing = 0;
  for (const pod of FOCUS_PODS) {
    const matches = await findFocusContractRows(pod);
    if (matches.length === 0) {
      const line = `[focus] POD ${pod}: nessun contratto (qualsiasi kind) | MANCANTE`;
      console.warn(line);
      focusLines.push(line);
      focusMissing++;
      continue;
    }

    for (const m of matches) {
      console.log(
        `[focus] DIAG ${pod} id=${m.id} kind=${m.recurrenceKind} status=${m.status} hist=${m.isHistorical} pod=${m.pod ?? "-"} podPdr=${m.podPdr ?? "-"} client=${clientDisplayName(m.client)} supplier=${m.supplier.name}`,
      );
    }

    // Preferisci R non storico; altrimenti il primo non storico (spesso UT da correggere).
    let row =
      matches.find((m) => m.recurrenceKind === "R" && !m.isHistorical) ??
      matches.find((m) => m.recurrenceKind === "R") ??
      matches.find((m) => !m.isHistorical) ??
      matches[0]!;

    const clientLabel = clientDisplayName(row.client);
    const annualSupplier = ANNUAL_SUPPLIER_HINT.test(row.supplier.name);

    // Vitucci/Quadrifoglio: Sinergy/Etruria restati UT perché set-annual scriveva
    // solo `recurrence` e non `recurrenceKind` (e Etruria non era in lista).
    if (row.recurrenceKind !== "R") {
      if (!annualSupplier) {
        const line = `[focus] ${clientLabel} | ${pod} | ${row.supplier.name} | kind=${row.recurrenceKind} (atteso R) | MANCANTE`;
        console.warn(line);
        focusLines.push(line);
        focusMissing++;
        continue;
      }
      if (!DRY) {
        await prisma.contract.update({
          where: { id: row.id },
          data: recurrenceWriteData("R"),
        });
      }
      console.log(
        `[focus] FIX kind ${row.recurrenceKind}→R ${clientLabel} | ${pod} | ${row.supplier.name}${DRY ? " (dry)" : ""}`,
      );
      row = { ...row, recurrenceKind: "R" };
    }

    const paidPeriods = row.recurringMonths
      .filter((r) => r.status === "PAID" || r.status === "LIQUIDATED")
      .map((r) => r.period);
    const firstYearCollected = isAnnualFirstYearCollected({
      collectionDate: row.collectionDate,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paidOrLiquidatedPeriods: paidPeriods,
    });
    if (!firstYearCollected) {
      const line = `[focus] ${clientLabel} | ${pod} | ${row.supplier.name} | primo anno non incassato | MANCANTE`;
      console.warn(line);
      focusLines.push(line);
      focusMissing++;
      continue;
    }

    const start = supplyStartPeriod(row);
    const duePeriods = listAnnualDuePeriodsThrough(start, paidPeriods, nowPeriod);
    const amount = Number(row.commission?.expected ?? 0) || null;
    const byPeriod = new Map(
      row.recurringMonths.map((r) => [r.period, r] as const),
    );

    for (const period of duePeriods) {
      const existing = byPeriod.get(period) ?? null;
      // Se già processato nel loop principale (already_ok), upsert è idempotente.
      try {
        const action = await upsertDuePeriod({
          contractId: row.id,
          period,
          amount,
          nowPeriod,
          existing,
        });
        if (action === "created") created++;
        else if (action === "reopened") reopened++;
        console.log(
          `[focus] ${action.toUpperCase()} ${clientLabel} ${pod} ${period}`,
        );
        focusResults.push({
          pod,
          client: clientLabel,
          supplier: row.supplier.name,
          period,
          status:
            action === "created" || action === "reopened"
              ? period < nowPeriod
                ? "MISSING"
                : "PENDING"
              : existing?.status ?? null,
          action,
        });
      } catch (e) {
        errors++;
        console.error(
          `[focus] err ${row.id} ${pod} ${period}`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // Rileggi mesi dopo apply per status reale.
    const months = await prisma.recurringMonth.findMany({
      where: { contractId: row.id },
      select: { period: true, status: true },
      orderBy: { period: "asc" },
    });
    const paidAfter = months
      .filter((r) => r.status === "PAID" || r.status === "LIQUIDATED")
      .map((r) => r.period);
    const dueAfter = listAnnualDuePeriodsThrough(
      supplyStartPeriod(row),
      paidAfter,
      nowPeriod,
    );
    const target = dueAfter[0] ?? duePeriods[0] ?? null;
    const month = target
      ? months.find((r) => r.period === target) ?? null
      : null;
    const operational =
      !!month &&
      (OPEN_STATUSES.has(month.status) ||
        month.status === "PAID" ||
        month.status === "LIQUIDATED");
    if (operational) focusOk++;
    else focusMissing++;
    const line = `[focus] ${clientLabel} | ${pod} | ${row.supplier.name} | due=${target ?? "-"} | status=${month?.status ?? "ASSENTE"} | ${operational ? "OK" : "MANCANTE"}`;
    console.log(line);
    focusLines.push(line);
  }

  const summary = {
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
    focusOk,
    focusMissing,
    focusActions: focusResults,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY && APPLY_IF_PROD && !DRY) {
    await emailApplyReport({ summary, focusLines }).catch((e) => {
      console.error("[annual-r-due] email report fallita", e);
    });
  }

  await prisma.$disconnect();
  // In production build non far fallire il deploy (come annual-past-years).
  if (errors > 0 && !APPLY_IF_PROD) process.exit(1);
  if (errors > 0 && APPLY_IF_PROD) {
    console.error(
      `[annual-r-due] ${errors} errori durante apply — continuo il build; sync/cron o rilancio possono completare`,
    );
  }
}

async function emailApplyReport(args: {
  summary: {
    created: number;
    reopened: number;
    alreadyOk: number;
    candidates: number;
    errors: number;
    focusOk: number;
    focusMissing: number;
    nowPeriod: string;
  };
  focusLines: string[];
}): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim() || process.env.SMTP_PASSWORD?.trim();
  const to =
    process.env.MASTER_EMAIL?.trim() || "michele.faruoli@gmail.com";
  if (!host || !user || !pass) {
    console.warn("[annual-r-due] SMTP non configurato — skip email report");
    return;
  }
  const nodemailer = await import("nodemailer");
  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    user;
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "CRM FM Consulenza";
  const { summary, focusLines } = args;
  const ok = summary.focusMissing === 0 && summary.focusOk >= 6;
  const subject = ok
    ? `CRM — apply rate 2026 OK (created ${summary.created}, reopened ${summary.reopened})`
    : `CRM — apply rate 2026 da verificare (focus missing ${summary.focusMissing})`;
  const text = [
    `Apply annuali R dovute — produzione`,
    `periodo corrente: ${summary.nowPeriod}`,
    `created=${summary.created} reopened=${summary.reopened} alreadyOk=${summary.alreadyOk}`,
    `candidates=${summary.candidates} errors=${summary.errors}`,
    `focusOk=${summary.focusOk} focusMissing=${summary.focusMissing}`,
    "",
    ...focusLines,
  ].join("\n");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
  });
  console.log(`[annual-r-due] email report inviata a ${to}`);
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
