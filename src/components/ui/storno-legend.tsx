export function StornoLegend({ className = "" }: { className?: string }) {
  const items = [
    { label: "Da pagare / Fuori storno", swatch: "bg-emerald-200 ring-emerald-300" },
    { label: "Ricorrente", swatch: "bg-teal-200 ring-teal-300" },
    { label: "Fine periodo storno", swatch: "bg-amber-200 ring-amber-300" },
    { label: "Periodo storno / Ricambio", swatch: "bg-red-200 ring-red-300" },
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
