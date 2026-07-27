"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { periodLabel } from "@/lib/recurring";
import { resolveHeliosAbsentAction } from "@/lib/helios-absent-actions";
import { Button } from "@/components/ui/button";

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
 * Alert: cliente Helios scomparso dai rendiconti successivi.
 * Azioni: contratto chiuso / errore Helios / in attesa rientro (+ note).
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
        Questi contratti comparivano in un rendiconto Helios e{" "}
        <strong>non risultano più</strong> nei mesi dopo. Scegli uno stato per
        toglierli dall&apos;elenco (es. tutti chiusi / cessati).
      </p>
      <ul className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto text-sm">
        {[...byContract.entries()].map(([contractId, list]) => {
          const first = list[0]!;
          const periods = list.map((x) => periodLabel(x.period)).join(", ");
          return (
            <li
              key={contractId}
              className="rounded-lg border border-rose-200 bg-white px-3 py-3"
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
              <ResolveForm contractId={contractId} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ResolveForm({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        fd.set("contractId", contractId);
        start(async () => {
          const res = await resolveHeliosAbsentAction(fd);
          if (res.error) {
            setError(res.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="block min-w-[12rem] flex-1 text-xs text-slate-700">
        Stato
        <select
          name="resolution"
          required
          defaultValue="CLOSED"
          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
        >
          <option value="CLOSED">Contratto chiuso / cessato</option>
          <option value="HELIOS_ERROR">Errore Helios (manca nel file)</option>
          <option value="WILL_RETURN">In attesa di rientro</option>
        </select>
      </label>
      <label className="block min-w-[10rem] flex-[2] text-xs text-slate-700">
        Note
        <input
          name="notes"
          placeholder="es. switch errato, rientra a luglio…"
          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Salvo…" : "Applica e rimuovi"}
      </Button>
      {error ? (
        <p className="w-full text-xs text-rose-700">{error}</p>
      ) : null}
    </form>
  );
}
