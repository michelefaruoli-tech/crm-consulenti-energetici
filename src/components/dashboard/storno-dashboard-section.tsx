import Link from "next/link";
import { StatCard } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type {
  StornoDashboardAlert,
  StornoDashboardKpiCard,
} from "@/lib/storno-dashboard-kpi";

type CollabOpt = { id: string; name: string };
type SupplierOpt = { id: string; name: string };
type MonthOpt = { value: string; label: string };

/**
 * Sezione Dashboard P1.2 B5: filtri + card KPI storno + alert prioritari.
 * Link GET alle liste con `?storno=` (B4).
 */
export function StornoDashboardSection({
  cards,
  alerts,
  collaborators,
  suppliers,
  monthOptions,
  filters,
  showCollabFilter,
}: {
  cards: StornoDashboardKpiCard[];
  alerts: StornoDashboardAlert[];
  collaborators: CollabOpt[];
  suppliers: SupplierOpt[];
  monthOptions: MonthOpt[];
  filters: {
    collab?: string;
    supplierId?: string;
    month?: string;
    from?: string;
    to?: string;
    /** Preserva altri query Dashboard (q, anno, page). */
    q?: string;
    anno?: string;
  };
  showCollabFilter: boolean;
}) {
  const alertTone: Record<StornoDashboardAlert["tone"], string> = {
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-rose-200 bg-rose-50 text-rose-950",
    default: "border-slate-200 bg-slate-50 text-slate-950",
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
            Storno · POD
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">
            KPI e alert storno
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Contatori nello scope attuale · clic apre Contratti o Provvigioni già
            filtrati
          </p>
        </div>
      </div>

      <form
        method="get"
        action="/"
        className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
        {filters.anno ? (
          <input type="hidden" name="anno" value={filters.anno} />
        ) : null}

        {showCollabFilter ? (
          <Field label="Collaboratore">
            <Select name="collab" defaultValue={filters.collab ?? "tutti"}>
              <option value="tutti">Tutti</option>
              {collaborators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Fornitore">
          <Select
            name="supplierId"
            defaultValue={filters.supplierId ?? ""}
          >
            <option value="">Tutti</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Mese (inserimento / storno)">
          <Select name="month" defaultValue={filters.month ?? ""}>
            <option value="">Tutto il periodo</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Dal">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="Al">
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit" className="w-full">
            Applica
          </Button>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.id} href={card.href} className="block transition hover:-translate-y-0.5 hover:shadow-md">
            <StatCard
              label={card.label}
              value={card.count}
              tone={card.tone}
              hint="Apri elenco filtrato"
            />
          </Link>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Alert prioritari
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${alertTone[alert.tone]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold leading-tight">{alert.label}</p>
                <span
                  aria-hidden
                  className="text-lg leading-none opacity-50 transition group-hover:translate-x-0.5"
                >
                  →
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums">{alert.count}</p>
              <p className="mt-2 text-xs leading-snug opacity-75">{alert.hint}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
