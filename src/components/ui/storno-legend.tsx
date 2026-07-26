export function StornoLegend({ className = "" }: { className?: string }) {
  const items = [
    { label: "Da incassare", swatch: "bg-yellow-200 ring-yellow-500" },
    { label: "Ricorrente", swatch: "bg-teal-50 ring-teal-500" },
    { label: "Fuori storno", swatch: "bg-lime-200 ring-lime-500" },
    { label: "Verso 2 mesi (solo da incassare)", swatch: "bg-orange-200 ring-orange-500" },
    { label: "~1 mese fine storno (testo rosso)", swatch: "bg-rose-100 ring-red-500" },
    { label: "In periodo storno (incassato)", swatch: "bg-red-200 ring-red-400" },
    { label: "KO / Cessato", swatch: "bg-slate-300 ring-slate-500" },
  ];
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700 ${className}`}>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded ring-1 ${item.swatch}`} />
          {item.label}
        </span>
      ))}
    </p>
  );
}
