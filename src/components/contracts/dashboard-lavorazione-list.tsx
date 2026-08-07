"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { updateContractFieldAction } from "@/lib/contract-actions";
import {
  MASTER_STATUS_LABELS,
  MASTER_WORKFLOW_STATUSES,
  type MasterWorkflowStatus,
} from "@/lib/master-workflow";
import { clientDisplayName } from "@/lib/utils";

export type DashboardLavorazioneItem = {
  id: string;
  status: string;
  contractNumber: string;
  client: {
    type: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  };
  supplier: { name: string };
  collaborator: { name: string };
};

/**
 * Card Dashboard «Contratti in lavorazione»:
 * tendina stato + pulsante «Salva cambiamenti» senza aprire la scheda.
 */
export function DashboardLavorazioneList({
  items,
  canChangeStatus,
}: {
  items: DashboardLavorazioneItem[];
  canChangeStatus: boolean;
}) {
  const router = useRouter();
  // Mappa id contratto → nuovo stato scelto (solo se diverso dall’originale)
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirtyCount = Object.keys(draft).length;

  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const onSelect = useCallback((id: string, original: string, next: string) => {
    setMessage(null);
    setError(null);
    setDraft((prev) => {
      const copy = { ...prev };
      if (next === original) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }, []);

  function saveAll() {
    const entries = Object.entries(draft);
    if (entries.length === 0) return;
    setError(null);
    setMessage(null);
    startSave(async () => {
      try {
        for (const [contractId, value] of entries) {
          const fd = new FormData();
          fd.set("contractId", contractId);
          fd.set("field", "status");
          fd.set("value", value);
          await updateContractFieldAction(fd);
        }
        setDraft({});
        setMessage(
          entries.length === 1
            ? "Stato aggiornato."
            : `${entries.length} stati aggiornati.`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore salvataggio");
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">Nessun contratto inviato al Master.</p>
    );
  }

  return (
    <div className="space-y-3">
      {canChangeStatus ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Cambia lo stato dalla tendina, poi clicca «Salva cambiamenti».
          </p>
          <Button
            type="button"
            size="sm"
            disabled={dirtyCount === 0 || saving}
            onClick={saveAll}
          >
            {saving
              ? "Salvataggio…"
              : `Salva cambiamenti${dirtyCount ? ` (${dirtyCount})` : ""}`}
          </Button>
        </div>
      ) : null}

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      <ul className="space-y-3">
        {items.map((contract) => {
          const name = clientDisplayName(contract.client);
          const current = draft[contract.id] ?? contract.status;
          const changed = draft[contract.id] != null;

          return (
            <li
              key={contract.id}
              className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/lavorazione/${contract.id}`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  {name}
                </Link>
                <p className="truncate text-sm text-slate-500">
                  {contract.contractNumber} · {contract.supplier.name} ·{" "}
                  {contract.collaborator.name}
                </p>
              </div>

              {canChangeStatus ? (
                <select
                  className={
                    changed
                      ? "shrink-0 max-w-[11.5rem] rounded border border-amber-400 bg-amber-50 px-1.5 py-1 text-xs font-medium text-slate-900"
                      : "shrink-0 max-w-[11.5rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-medium text-slate-900"
                  }
                  value={current}
                  disabled={saving}
                  title="Cambia stato (poi Salva cambiamenti)"
                  onChange={(e) =>
                    onSelect(contract.id, contract.status, e.target.value)
                  }
                >
                  {/* Se lo stato attuale non è tra quelli Master, lo mostriamo comunque */}
                  {!MASTER_WORKFLOW_STATUSES.includes(
                    contract.status as MasterWorkflowStatus,
                  ) ? (
                    <option value={contract.status}>{contract.status}</option>
                  ) : null}
                  {MASTER_WORKFLOW_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {MASTER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={contract.status} />
              )}
            </li>
          );
        })}
      </ul>

      {canChangeStatus && dirtyCount > 0 ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={saving} onClick={saveAll}>
            {saving
              ? "Salvataggio…"
              : `Salva cambiamenti (${dirtyCount})`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
