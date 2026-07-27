"use client";

import Link from "next/link";
import { periodLabel } from "@/lib/recurring";

export type HeliosAbsentAlert = {
  id: string;
  period: string;
  contractId: string;
  podPdr: string;
  clientName: string;
  collaboratorName: string;
  note: string | null;
};

/**
 * Alert: cliente Helios presente in rendiconti precedenti ma
 * scomparso da un mese successivo → verificare cessazione o errore Helios.
 */
export function HeliosAbsentPanel({ alerts }: { alerts: HeliosAbsentAlert[] }) {
  if (alerts.length === 0) return null;

  const byContract = new Map<string, HeliosAbsentAlert[]>();
  for (const a of alerts) {
    const list = byContract.get(a.contractId) ?? [];
    list.push(a);
    byContract.set(a.contractId, list);
  }

  return (
    <section className="rounded-xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
      <h2 className="text-base font-semibold text-rose-950">
        Helios: assenti dai rendiconti successivi ({byContract.size} clienti)
      </h2>
      <p className="mt-1 text-xs text-rose-900/80">
        Questi contratti comparivano in un rendiconto Helios e <strong>non
        risultano più</strong> nei mesi dopo. Controlla se sono{" "}
        <strong>cessati</strong> (switch/errore) oppure se manca una riga nel
        file Helios. Alcuni rientrano dopo (es. NEGLI…).
      </p>
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
        {[...byContract.entries()].map(([contractId, list]) => {
          const first = list[0]!;
          const periods = list.map((x) => periodLabel(x.period)).join(", ");
          return (
            <li
              key={contractId}
              className="rounded-lg border border-rose-200 bg-white px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/contratti/${contractId}`}
                  className="font-medium text-rose-950 underline-offset-2 hover:underline"
                >
                  {first.clientName}
                </Link>
                <span className="text-xs text-rose-800/70">
                  {first.collaboratorName}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-rose-900/70">
                POD {first.podPdr || "—"} · mesi assenti:{" "}
                <strong>{periods}</strong>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
