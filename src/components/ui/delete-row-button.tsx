"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteContractRowAction, deleteClientRowAction } from "@/lib/delete-actions";

export function DeleteRowButton({
  kind,
  id,
  label = "Elimina",
  compact = false,
}: {
  kind: "contract" | "client";
  id: string;
  label?: string;
  /** Solo una X rossa (risparmia spazio in tabella) */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending}
        className={
          compact
            ? "rounded px-1 py-0 text-base font-bold leading-none text-red-800 hover:bg-white/70 disabled:opacity-50"
            : "rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-red-800 ring-1 ring-red-200 hover:bg-white disabled:opacity-50"
        }
        title="Archivia / elimina"
        aria-label="Elimina"
        onClick={(e) => {
          e.stopPropagation();
          setErr(null);
          if (
            !confirm(
              kind === "contract"
                ? "Vuoi eliminare questa riga?\n\nL'operazione archivia il contratto (soft delete) e lo toglie dalla visualizzazione."
                : "Vuoi eliminare questa riga?\n\nIl cliente e i contratti collegati verranno archiviati.",
            )
          ) {
            return;
          }
          start(async () => {
            try {
              const fd = new FormData();
              let res: { ok: boolean; error?: string };
              if (kind === "contract") {
                fd.set("contractId", id);
                res = await deleteContractRowAction(fd);
              } else {
                fd.set("clientId", id);
                res = await deleteClientRowAction(fd);
              }
              if (!res.ok) {
                setErr(res.error ?? "Eliminazione non riuscita");
                return;
              }
              router.refresh();
            } catch (error) {
              setErr(error instanceof Error ? error.message : "Eliminazione non riuscita");
            }
          });
        }}
      >
        {pending ? "…" : compact ? "×" : label}
      </button>
      {err ? <span className="max-w-[8rem] text-[10px] text-red-600">{err}</span> : null}
    </span>
  );
}
