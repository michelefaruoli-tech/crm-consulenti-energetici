import {
  Archive,
  CheckCircle2,
  Clock3,
  Layers,
  ShieldAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  resolveStornoBadges,
  type ResolveStornoBadgesInput,
  type StornoBadgeDef,
  type StornoBadgeId,
} from "@/lib/storno-badges";

const ICONS: Record<StornoBadgeDef["icon"], LucideIcon> = {
  shield: ShieldAlert,
  clock: Clock3,
  check: CheckCircle2,
  layers: Layers,
  archive: Archive,
  undo: Undo2,
};

export function StornoBadge({
  badge,
  className,
}: {
  badge: StornoBadgeDef;
  className?: string;
}) {
  const Icon = ICONS[badge.icon];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-tight",
        badge.className,
        className,
      )}
      title={badge.label}
      data-storno-badge={badge.id}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{badge.label}</span>
    </span>
  );
}

export function StornoBadgeList({
  badges,
  className,
  emptyFallback,
}: {
  badges: StornoBadgeDef[];
  className?: string;
  /** Se nessun badge P1.2, mostra testo residuo (es. label operativa) */
  emptyFallback?: string | null;
}) {
  if (badges.length === 0) {
    if (!emptyFallback) return null;
    return (
      <span className={cn("text-xs text-slate-700", className)}>
        {emptyFallback}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
      role="list"
      aria-label="Stato storno"
    >
      {badges.map((b) => (
        <span key={b.id} role="listitem">
          <StornoBadge badge={b} />
        </span>
      ))}
    </span>
  );
}

/** Convenience: resolve + render da input riga. */
export function StornoBadgesFromSignals({
  input,
  emptyFallback,
  className,
}: {
  input: ResolveStornoBadgesInput;
  emptyFallback?: string | null;
  className?: string;
}) {
  return (
    <StornoBadgeList
      badges={resolveStornoBadges(input)}
      emptyFallback={emptyFallback}
      className={className}
    />
  );
}

export type { StornoBadgeId, StornoBadgeDef, ResolveStornoBadgesInput };
