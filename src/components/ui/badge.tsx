import { CONTRACT_STATUS_LABELS, STATUS_COLORS, type AppContractStatus } from "@/lib/constants";
import { cn } from "@/lib/cn";

export function StatusBadge({ status }: { status: string }) {
  const key = status as AppContractStatus;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_COLORS[key] ?? "bg-slate-100 text-slate-700",
      )}
    >
      {CONTRACT_STATUS_LABELS[key] ?? status}
    </span>
  );
}
