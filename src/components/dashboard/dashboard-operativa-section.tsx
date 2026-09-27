import Link from "next/link";
import { StatCard } from "@/components/ui/card";
import type {
  DashboardOperativaAlert,
  DashboardOperativaKpiCard,
  DashboardQuickAction,
} from "@/lib/dashboard-operativa";

const alertTone: Record<DashboardOperativaAlert["tone"], string> = {
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-rose-200 bg-rose-50 text-rose-950",
  default: "border-slate-200 bg-slate-50 text-slate-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
};

const priorityLabel: Record<DashboardOperativaAlert["priority"], string> = {
  alta: "Priorità alta",
  media: "Priorità media",
  bassa: "Priorità bassa",
};

/**
 * P1.3 — Centrale operativa Dashboard: KPI economici, alert, azioni rapide.
 * Ogni card/alert apre la lista filtrata corrispondente.
 */
export function DashboardOperativaSection({
  kpis,
  alerts,
  actions,
}: {
  kpis: DashboardOperativaKpiCard[];
  alerts: DashboardOperativaAlert[];
  actions: DashboardQuickAction[];
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Ciclo finanziario
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">
            KPI economici
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Importi nello scope attuale · clic apre Provvigioni già filtrate
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((card) => (
            <Link
              key={card.id}
              href={card.href}
              className="block transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <StatCard
                label={card.label}
                value={card.value}
                tone={card.tone}
                hint={card.hint}
              />
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              Priorità operative
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              Alert operativi
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Conteggio DB-side · clic apre elenco filtrato
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${alertTone[alert.tone]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {priorityLabel[alert.priority]}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-tight">
                    {alert.label}
                  </p>
                </div>
                <span
                  aria-hidden
                  className="text-lg leading-none opacity-50 transition group-hover:translate-x-0.5"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums">
                {alert.count}
              </p>
              <p className="mt-2 text-xs leading-snug opacity-75">
                {alert.hint}
              </p>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
            Scorciatoie
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">
            Azioni rapide
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-900"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
