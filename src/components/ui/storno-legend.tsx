export function StornoLegend({ className = "" }: { className?: string }) {
  const items = [
    { label: "Da incassare", swatch: "bg-yellow-200 ring-yellow-400" },
    { label: "Ricorrente", swatch: "bg-emerald-800 ring-emerald-900" },
    { label: "Fuori storno", swatch: "bg-emerald-100 ring-emerald-300" },
    { label: "~1 mese fine storno (testo rosso)", swatch: "bg-rose-100 ring-red-400" },
    { label: "In periodo storno", swatch: "bg-red-200 ring-red-300" },
    { label: "KO / Cessato", swatch: "bg-slate-300 ring-slate-400" },
  ];
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 ${className}`}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded ring-1 ${item.swatch}`} />
          {item.label}
        </span>
      ))}
    </p>
  );
}
