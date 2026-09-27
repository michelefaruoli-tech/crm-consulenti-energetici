import {
  Archive,
  CheckCircle2,
  Clock3,
  Layers,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import { STORNO_BADGE_DEFS, type StornoBadgeId } from "@/lib/storno-badges";

const LEGEND_ORDER: StornoBadgeId[] = [
  "in_storno",
  "storno_in_scadenza",
  "fuori_storno",
  "doppia_posizione",
  "storico",
  "stornato",
];

const ICONS = {
  shield: ShieldAlert,
  clock: Clock3,
  check: CheckCircle2,
  layers: Layers,
  archive: Archive,
  undo: Undo2,
} as const;

/**
 * Legenda badge P1.2 (testo + icona). I colori riga restano in tabella.
 */
export function StornoLegend({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-slate-700 ${className}`}
      aria-label="Legenda storno"
    >
      {LEGEND_ORDER.map((id) => {
        const def = STORNO_BADGE_DEFS[id];
        const Icon = ICONS[def.icon];
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${def.className}`}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            {def.label}
          </span>
        );
      })}
    </p>
  );
}
