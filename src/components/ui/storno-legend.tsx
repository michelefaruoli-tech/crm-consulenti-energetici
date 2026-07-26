export function StornoLegend({ className = "" }: { className?: string }) {
  const items = [
    { label: "1 Da incassare", swatch: "bg-amber-200 ring-amber-500" },
    { label: "2 BLOCCA storno", swatch: "bg-red-200 ring-red-700" },
    { label: "3 Fuori storno", swatch: "bg-emerald-200 ring-emerald-600" },
    { label: "4 Ricorrente a vita", swatch: "bg-cyan-200 ring-cyan-600" },
    { label: "5 Fine storno vicina", swatch: "bg-violet-200 ring-violet-600" },
    { label: "6 Scadenza contratto 12 mesi", swatch: "bg-orange-200 ring-orange-600" },
    { label: "Manca ingresso → POD rosso", swatch: "bg-white ring-red-600" },
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
