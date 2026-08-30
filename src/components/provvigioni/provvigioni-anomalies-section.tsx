"use client";

import type { ReactNode } from "react";

export function ProvvigioniAnomaliesSection({
  alertCount,
  children,
}: {
  alertCount: number;
  children: ReactNode;
}) {
  if (alertCount <= 0) return null;

  return (
    <details
      open={alertCount > 0}
      className="rounded-2xl border border-red-200 bg-red-50/40 p-4 open:shadow-sm"
    >
      <summary className="cursor-pointer text-sm font-semibold text-red-950">
        Anomalie — {alertCount} segnalazioni (rate mancanti, assenti da rendiconto…)
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}
