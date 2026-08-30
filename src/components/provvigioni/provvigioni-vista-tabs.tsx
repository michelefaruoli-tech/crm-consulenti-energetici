import Link from "next/link";

/** Schede principali Provvigioni (3 tab). */
export type ProvvigioniVistaTab = "tutti" | "mensile" | "annuale";

type TabCounts = {
  tutti: number;
  mensile: number;
  annuale: number;
};

function buildHref(
  vista: ProvvigioniVistaTab,
  base: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v) params.set(k, v);
  }
  if (vista !== "tutti") params.set("vista", vista);
  return `/provvigioni?${params.toString()}`;
}

export function ProvvigioniVistaTabs({
  active,
  counts,
  queryBase,
}: {
  active: ProvvigioniVistaTab;
  counts: TabCounts;
  queryBase: Record<string, string | undefined>;
}) {
  const tabs: Array<{
    id: ProvvigioniVistaTab;
    label: string;
    short: string;
    hint: string;
    activeClass: string;
    idleClass: string;
  }> = [
    {
      id: "tutti",
      label: "Tutti i contratti",
      short: "Tutti",
      hint: "Gettoni UT + ricorrenti M e R",
      activeClass: "bg-slate-900 text-white border-slate-900",
      idleClass: "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
    },
    {
      id: "mensile",
      label: "Ricorrenti mensili",
      short: "M",
      hint: "Helios, Sorgenia… pagamento ogni mese",
      activeClass: "bg-teal-600 text-white border-teal-600",
      idleClass: "bg-teal-50 text-teal-950 border-teal-200 hover:bg-teal-100",
    },
    {
      id: "annuale",
      label: "Ricorrenti annuali",
      short: "R",
      hint: "Etruria, Sinergy… ogni 12 mesi",
      activeClass: "bg-indigo-600 text-white border-indigo-600",
      idleClass: "bg-indigo-50 text-indigo-950 border-indigo-200 hover:bg-indigo-100",
    },
  ];

  return (
    <nav className="grid gap-2 sm:grid-cols-3" aria-label="Tipo provvigione">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <Link
            key={tab.id}
            href={buildHref(tab.id, queryBase)}
            className={`rounded-xl border px-4 py-3 shadow-sm transition ${
              isActive ? tab.activeClass : tab.idleClass
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-bold">{tab.short}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-sm font-semibold ${
                  isActive ? "bg-white/20" : "bg-black/5"
                }`}
              >
                {counts[tab.id]}
              </span>
            </div>
            <p className={`mt-1 text-sm font-medium ${isActive ? "text-white/95" : ""}`}>
              {tab.label}
            </p>
            <p
              className={`mt-0.5 text-xs ${
                isActive ? "text-white/75" : "text-slate-500"
              }`}
            >
              {tab.hint}
            </p>
          </Link>
        );
      })}
    </nav>
  );
}
