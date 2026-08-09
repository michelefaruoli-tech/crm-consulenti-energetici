import { formatCurrency } from "@/lib/commission";
import { formatDate } from "@/lib/utils";
import { periodLabel } from "@/lib/recurring";

type CommissionEntry = {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  createdAt: Date;
};

type RecurringEntry = {
  id: string;
  period: string;
  status: string;
  amount: number;
  paidAt: Date | null;
  settledPeriod: string | null;
};

type TimelineItem = {
  id: string;
  date: Date;
  label: string;
  detail?: string;
  amount?: number;
  tone: "neutral" | "positive" | "negative" | "warning";
};

function periodDate(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(year || 2000, Math.max(0, (month || 1) - 1), 1);
}

function entryLabel(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "paid") return "Liquidazione collaboratore";
  if (normalized === "received") return "Incasso registrato";
  if (normalized.includes("storn")) return "Storno provvigione";
  return type || "Movimento provvigione";
}

export function ContractEconomicSummary({
  expected,
  received,
  paid,
  stornoAmount,
  stornoDate,
  commissionCreatedAt,
  commissionConfirmedAt,
  collectionDate,
  commissionEntries,
  recurringEntries,
}: {
  expected: number;
  received: number;
  paid: number;
  stornoAmount: number;
  stornoDate: Date | null;
  commissionCreatedAt: Date | null;
  commissionConfirmedAt: Date | null;
  collectionDate: Date | null;
  commissionEntries: CommissionEntry[];
  recurringEntries: RecurringEntry[];
}) {
  const effectiveReceived = collectionDate ? received || expected : received;
  const recurringReceived = recurringEntries
    .filter((entry) => entry.status === "PAID" || entry.status === "LIQUIDATED")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const recurringLiquidated = recurringEntries
    .filter((entry) => entry.status === "LIQUIDATED")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalLiquidated = paid + recurringLiquidated;
  const netAvailable = effectiveReceived + recurringReceived + stornoAmount;
  const balance = netAvailable - totalLiquidated;

  const timeline: TimelineItem[] = [];
  if (commissionCreatedAt && expected !== 0) {
    timeline.push({
      id: "commission-created",
      date: commissionCreatedAt,
      label: "Provvigione prevista",
      amount: expected,
      tone: "neutral",
    });
  }
  if (commissionConfirmedAt) {
    timeline.push({
      id: "commission-confirmed",
      date: commissionConfirmedAt,
      label: "Gettone confermato",
      tone: "positive",
    });
  }
  if (collectionDate) {
    timeline.push({
      id: "collection",
      date: collectionDate,
      label: "Incasso dal fornitore",
      amount: effectiveReceived,
      tone: "positive",
    });
  }
  if (stornoAmount !== 0 && (stornoDate || commissionCreatedAt)) {
    timeline.push({
      id: "storno",
      date: stornoDate ?? commissionCreatedAt!,
      label: "Storno registrato",
      amount: stornoAmount,
      tone: "negative",
    });
  }
  for (const entry of commissionEntries) {
    timeline.push({
      id: `entry-${entry.id}`,
      date: entry.createdAt,
      label: entryLabel(entry.type),
      detail: entry.note ?? undefined,
      amount: entry.amount,
      tone:
        entry.amount < 0
          ? "negative"
          : entry.type.toLowerCase() === "paid"
            ? "neutral"
            : "positive",
    });
  }
  for (const entry of recurringEntries) {
    const isMissing = entry.status === "MISSING" || entry.status === "ERROR_UNPAID";
    const isLiquidated = entry.status === "LIQUIDATED";
    timeline.push({
      id: `recurring-${entry.id}`,
      date: entry.paidAt ?? periodDate(entry.period),
      label: isMissing
        ? "Rata ricorrente mancante"
        : isLiquidated
          ? "Rata ricorrente liquidata"
          : entry.status === "PAID"
            ? "Rata ricorrente incassata"
            : "Rata ricorrente prevista",
      detail: `Competenza ${periodLabel(entry.period)}${
        entry.settledPeriod ? ` · rendiconto ${periodLabel(entry.settledPeriod)}` : ""
      }`,
      amount: entry.amount || undefined,
      tone: isMissing ? "warning" : isLiquidated ? "neutral" : "positive",
    });
  }
  timeline.sort((a, b) => b.date.getTime() - a.date.getTime());

  const toneClass = {
    neutral: "border-slate-300 bg-slate-100",
    positive: "border-emerald-300 bg-emerald-100",
    negative: "border-rose-300 bg-rose-100",
    warning: "border-amber-300 bg-amber-100",
  } as const;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Scheda economica</h2>
          <p className="mt-1 text-xs text-slate-500">
            Riepilogo consultivo di gettoni, ricorrenze, liquidazioni e storni.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            balance > 0
              ? "bg-amber-100 text-amber-900"
              : balance < 0
                ? "bg-rose-100 text-rose-900"
                : "bg-emerald-100 text-emerald-900"
          }`}
        >
          Saldo {formatCurrency(balance)}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Gettone previsto", expected],
          ["Incassato fornitore", effectiveReceived],
          ["Ricorrenze incassate", recurringReceived],
          ["Storni", stornoAmount],
          ["Liquidato", totalLiquidated],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 text-lg font-bold text-slate-900">
              {formatCurrency(Number(value))}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Cronologia economica</h3>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nessun movimento economico registrato.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {timeline.map((item) => (
              <li key={item.id} className="grid grid-cols-[auto_1fr_auto] gap-3 text-sm">
                <span
                  aria-hidden
                  className={`mt-1 h-3 w-3 rounded-full border ${toneClass[item.tone]}`}
                />
                <div>
                  <p className="font-medium text-slate-800">{item.label}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(item.date)}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </p>
                </div>
                {item.amount != null ? (
                  <span
                    className={`font-semibold tabular-nums ${
                      item.amount < 0 ? "text-rose-700" : "text-slate-800"
                    }`}
                  >
                    {formatCurrency(item.amount)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
