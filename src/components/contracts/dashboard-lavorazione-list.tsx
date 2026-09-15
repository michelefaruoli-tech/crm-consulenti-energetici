"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { updateContractStatusesBulkAction } from "@/lib/contract-actions";
import {
  KO_REASON_OPTIONS,
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

const AGENT_NOTIFY_STATUSES = new Set([
  "IN_ATTESA_PAGAMENTO",
  "DOCUMENTAZIONE_INCOMPLETA",
  "KO",
]);

function localIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentNotes, setAgentNotes] = useState("");
  const [koReason, setKoReason] = useState("");

  const dirtyCount = Object.keys(draft).length;
  const draftEntries = Object.entries(draft);
  const needsAgentNotes = draftEntries.some(([, status]) =>
    AGENT_NOTIFY_STATUSES.has(status),
  );
  const needsKoReason = draftEntries.some(([, status]) => status === "KO");

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

  function openSave() {
    const entries = Object.entries(draft);
    if (entries.length === 0) return;
    setError(null);
    setMessage(null);
    setAgentNotes("");
    setKoReason("");
    setConfirmOpen(true);
  }

  function saveAll() {
    const entries = Object.entries(draft);
    if (entries.length === 0) return;
    if (needsAgentNotes && !agentNotes.trim()) {
      setError("Inserisci le note per l’agente prima di salvare");
      return;
    }
    if (needsKoReason && !koReason.trim()) {
      setError("Seleziona il motivo del KO");
      return;
    }
    setError(null);
    setMessage(null);
    startSave(async () => {
      try {
        const fd = new FormData();
        for (const [contractId, value] of entries) {
          fd.append("contractId", contractId);
          fd.append("status", value);
        }
        const notes = agentNotes.trim();
        if (notes) {
          fd.set("agentNotes", notes);
          fd.set("closureNotes", notes);
        }
        if (needsKoReason) {
          fd.set("closureDate", localIsoDate());
          fd.set("closureReason", koReason.trim() || "Esito Back Office");
        }
        const res = await updateContractStatusesBulkAction(fd);
        if (res.updated > 0) {
          setDraft((prev) => {
            const copy = { ...prev };
            for (const [id] of entries.slice(0, res.updated)) {
              delete copy[id];
            }
            return copy;
          });
        }
        if (!res.ok) {
          setError(
            res.updated > 0
              ? `${res.updated} aggiornate, poi: ${res.error ?? "errore di salvataggio"}`
              : (res.error ?? "Errore salvataggio"),
          );
          if (res.updated > 0) router.refresh();
          return;
        }
        setDraft({});
        setConfirmOpen(false);
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
            onClick={openSave}
          >
            {saving
              ? "Salvataggio…"
              : `Salva cambiamenti${dirtyCount ? ` (${dirtyCount})` : ""}`}
          </Button>
        </div>
      ) : null}

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error && !confirmOpen ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : null}

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
          <Button type="button" size="sm" disabled={saving} onClick={openSave}>
            {saving
              ? "Salvataggio…"
              : `Salva cambiamenti (${dirtyCount})`}
          </Button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-950">
              Salva esiti ({dirtyCount})
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {needsAgentNotes
                ? "Le note arrivano via email all’agente (oggetto: cliente + fornitore)."
                : "Confermi il salvataggio degli stati selezionati?"}
            </p>
            <ul className="mt-3 max-h-36 space-y-1 overflow-auto text-sm text-slate-700">
              {draftEntries.map(([id, status]) => {
                const item = items.find((c) => c.id === id);
                const name = item ? clientDisplayName(item.client) : id;
                const label =
                  MASTER_STATUS_LABELS[status as MasterWorkflowStatus] ?? status;
                return (
                  <li key={id} className="truncate">
                    <span className="font-medium">{name}</span>
                    {" → "}
                    {label}
                  </li>
                );
              })}
            </ul>
            {needsAgentNotes ? (
              <label className="mt-4 block text-sm font-semibold text-slate-800">
                Note per l’agente *
                <textarea
                  value={agentNotes}
                  onChange={(e) => {
                    setAgentNotes(e.target.value);
                    setError(null);
                  }}
                  rows={4}
                  placeholder="Es. contratto inserito, far firmare al cliente"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                  autoFocus
                />
              </label>
            ) : null}
            {needsKoReason ? (
              <label className="mt-3 block text-sm font-semibold text-slate-800">
                Motivo del KO *
                <select
                  value={koReason}
                  onChange={(e) => {
                    setKoReason(e.target.value);
                    setError(null);
                  }}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                >
                  <option value="">Seleziona</option>
                  {KO_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  setError(null);
                }}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={saving}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {saving ? "Salvataggio…" : "Conferma e salva"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
