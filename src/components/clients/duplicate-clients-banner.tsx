"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mergeClientIntoAction } from "@/lib/client-merge-actions";

export type DuplicateClientHint = {
  id: string;
  label: string;
  contractCount: number;
};

/**
 * Banner omonimi con link alle schede e azione primaria «Unisci qui».
 */
export function DuplicateClientsBanner({
  currentClientId,
  duplicates,
}: {
  currentClientId: string;
  duplicates: DuplicateClientHint[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function unifyInto(target: DuplicateClientHint) {
    const ok = window.confirm(
      `UNIFICA ANAGRAFICA\n\nI contratti di questa scheda passeranno sotto:\n«${target.label}»\n\nQuesta anagrafica verrà archiviata (niente duplicato).\nConfermi?`,
    );
    if (!ok) return;
    setErr(null);
    setBusyId(target.id);
    start(async () => {
      try {
        const result = await mergeClientIntoAction(currentClientId, target.id);
        if (!result.ok) {
          setErr(result.message);
          return;
        }
        if (result.redirectTo) {
          router.push(result.redirectTo);
          router.refresh();
        } else {
          router.refresh();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Errore unificazione");
      } finally {
        setBusyId(null);
      }
    });
  }

  if (duplicates.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      data-testid="duplicate-clients-banner"
    >
      <p className="font-medium">
        Attenzione: esistono altre anagrafiche con lo stesso nome / CF / P.IVA.
      </p>
      <p className="mt-1 text-xs text-amber-900/80">
        In Provvigioni puoi vedere contratti di clienti diversi omonimi. Per
        uniformarli: seleziona «Unisci qui», oppure digita la ragione sociale (o
        CF / P.IVA) nel form anagrafica e scegli dal typeahead.
      </p>
      <ul className="mt-2 space-y-2">
        {duplicates.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-2"
          >
            <Link
              href={`/clienti/${d.id}`}
              className="font-medium text-emerald-800 underline"
            >
              {d.label}
            </Link>
            <span className="text-xs text-amber-900/70">
              · {d.contractCount} contrat
              {d.contractCount === 1 ? "to" : "ti"}
            </span>
            <button
              type="button"
              disabled={pending}
              className="rounded-md border border-emerald-600 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
              onClick={() => unifyInto(d)}
            >
              {busyId === d.id ? "Unificazione…" : "Unisci qui"}
            </button>
          </li>
        ))}
      </ul>
      {err ? (
        <p className="mt-2 text-xs text-red-700">{err}</p>
      ) : null}
    </div>
  );
}
