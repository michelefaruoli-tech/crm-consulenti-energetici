import { ContractStatus } from "@/generated/prisma/client";
import { CONTRACT_STATUS_LABELS, STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/cn";

export function StatusBadge({ status }: { status: ContractStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        STATUS_COLORS[status],
      )}
    >
      {CONTRACT_STATUS_LABELS[status]}
    </span>
  );
}
