"use client";

import type { ReactNode } from "react";
import { AnomaliesBulkPanel } from "@/components/provvigioni/anomalies-bulk-panel";

export function ProvvigioniAnomaliesSection({
  alertCount,
  monthIds,
  children,
}: {
  alertCount: number;
  /** Id RecurringMonth delle segnalazioni aperte (mancanti + assenti Helios). */
  monthIds?: string[];
  children: ReactNode;
}) {
  if (alertCount <= 0) return null;

  return (
    <details className="rounded-2xl border border-red-200 bg-red-50/40 p-4 open:shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-red-950">
        Anomalie — {alertCount} segnalazioni (rate mancanti, assenti da rendiconto…)
      </summary>
      <div className="mt-4 space-y-4">
        {monthIds && monthIds.length > 0 ? (
          <AnomaliesBulkPanel monthIds={monthIds} />
        ) : null}
        {children}
      </div>
    </details>
  );
}
