import type { RankingItem } from "@/lib/dashboard-aggregates";

const BAR_TONES: Record<string, string> = {
  Luce: "bg-amber-400",
  Gas: "bg-orange-500",
  "Dual (luce+gas)": "bg-violet-500",
  Fibra: "bg-sky-400",
};

export function DashboardRankingPanel({
  title,
  subtitle,
  items,
  emptyMessage = "Nessun dato disponibile.",
}: {
  title: string;
  subtitle?: string;
  items: RankingItem[];
  emptyMessage?: string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => {
            const width = Math.max(8, Math.round((item.count / max) * 100));
            const barTone = BAR_TONES[item.label] ?? "bg-emerald-500";
            return (
              <li key={`${item.label}-${index}`}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-slate-700">
                    {index + 1}. {item.label}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-slate-900">
                    {item.count}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${barTone}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
