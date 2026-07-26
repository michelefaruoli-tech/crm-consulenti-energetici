"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreContractRowAction } from "@/lib/delete-actions";
import { formatDateTime } from "@/lib/utils";

type TrashRow = {
  id: string;
  clientName: string;
  supplierName: string;
  collaboratorName: string;
  podPdr: string;
  deletedAt: string;
};

export function ProvvigioniTrashPanel({ rows }: { rows: TrashRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (rows.length === 0) return null;

  function restore(id: string, label: string) {
    if (
      !window.confirm(
        `Ripristinare «${label}»?\n\nTorna visibile in Provvigioni / Contratti.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    start(async () => {
      const fd = new FormData();
      fd.set("contractId", id);
      const res = await restoreContractRowAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Ripristino non riuscito");
        return;
      }
      setMessage(`Ripristinato: ${label}`);
      router.refresh();
    });
  }

  return (
    <details className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 open:shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-amber-950">
        Cestino — ultime {rows.length} eliminazioni (puoi ripristinare)
      </summary>
      <p className="mt-2 text-xs text-amber-900/80">
        Se elimini una riga per errore, usala qui. L’eliminazione è un archivio
        (soft delete), non cancella i dati in modo definitivo.
      </p>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-800">{message}</p> : null}
      <ul className="mt-3 divide-y divide-amber-100 rounded-lg border border-amber-100 bg-white">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{r.clientName}</p>
              <p className="text-slate-500">
                {r.supplierName}
                {r.podPdr ? ` · ${r.podPdr}` : ""} · {r.collaboratorName} ·{" "}
                {formatDateTime(r.deletedAt)}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-emerald-700 px-2.5 py-1.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              onClick={() => restore(r.id, r.clientName)}
            >
              Ripristina
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
