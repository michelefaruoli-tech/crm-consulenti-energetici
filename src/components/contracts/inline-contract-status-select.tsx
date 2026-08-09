"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContractFieldAction } from "@/lib/contract-actions";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";
import {
  MASTER_STATUS_LABELS,
  MASTER_WORKFLOW_STATUSES,
  type MasterWorkflowStatus,
} from "@/lib/master-workflow";
import { cn } from "@/lib/cn";
import { format } from "date-fns";

/** Stati più usati in Dashboard / elenco Contratti (tendina compatta). */
const DASHBOARD_STATUSES: AppContractStatus[] = [
  "INSERITO",
  "IN_LAVORAZIONE",
  "DOCUMENTAZIONE_INCOMPLETA",
  "IN_ATTESA_PAGAMENTO",
  "ATTIVATO",
  "PAGATO_DAL_FORNITORE",
  "PROVVIGIONE_LIQUIDATA",
  "KO",
  "ANNULLATO",
  "CHIUSO",
];

/**
 * Tendina per cambiare lo stato del contratto senza aprire la scheda.
 * - mode "dashboard": stati principali del CRM
 * - mode "master": solo flusso In lavorazione / In pagamento / Integrazione / KO
 */
export function InlineContractStatusSelect({
  contractId,
  status,
  mode = "dashboard",
  className,
}: {
  contractId: string;
  status: string;
  mode?: "dashboard" | "master";
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null);
  const [closureDate, setClosureDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [closureReason, setClosureReason] = useState("");
  const [closureNotes, setClosureNotes] = useState("");

  const options: { value: string; label: string }[] =
    mode === "master"
      ? MASTER_WORKFLOW_STATUSES.map((s) => ({
          value: s,
          label: MASTER_STATUS_LABELS[s as MasterWorkflowStatus],
        }))
      : DASHBOARD_STATUSES.map((s) => ({
          value: s,
          label: CONTRACT_STATUS_LABELS[s],
        }));

  // Se lo stato attuale non è nella lista, lo aggiungiamo così non si perde
  const hasCurrent = options.some((o) => o.value === status);
  if (!hasCurrent && status) {
    options.unshift({
      value: status,
      label:
        CONTRACT_STATUS_LABELS[status as AppContractStatus] ??
        MASTER_STATUS_LABELS[status as MasterWorkflowStatus] ??
        status,
    });
  }

  function onChange(next: string) {
    if (next === status) return;
    if (["CHIUSO", "KO", "ANNULLATO"].includes(next)) {
      setTerminalStatus(next);
      setClosureDate(format(new Date(), "yyyy-MM-dd"));
      setClosureReason("");
      setClosureNotes("");
      return;
    }
    const label =
      options.find((o) => o.value === next)?.label ??
      CONTRACT_STATUS_LABELS[next as AppContractStatus] ??
      next;
    if (!window.confirm(`Cambiare lo stato in «${label}»?`)) {
      return;
    }
    setError(null);
    setValue(next);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("contractId", contractId);
        fd.set("field", "status");
        fd.set("value", next);
        await updateContractFieldAction(fd);
        router.refresh();
      } catch (e) {
        setValue(status);
        setError(e instanceof Error ? e.message : "Errore cambio stato");
      }
    });
  }

  function confirmTerminalStatus() {
    if (!terminalStatus || !closureDate || !closureReason.trim()) {
      setError("Data e motivo sono obbligatori");
      return;
    }
    const next = terminalStatus;
    setError(null);
    setValue(next);
    setTerminalStatus(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("contractId", contractId);
        fd.set("field", "status");
        fd.set("value", next);
        fd.set("closureDate", closureDate);
        fd.set("closureReason", closureReason.trim());
        fd.set("closureNotes", closureNotes.trim());
        await updateContractFieldAction(fd);
        router.refresh();
      } catch (e) {
        setValue(status);
        setError(e instanceof Error ? e.message : "Errore cambio stato");
      }
    });
  }

  return (
    <div className={cn("min-w-[9.5rem]", className)} onClick={(e) => e.stopPropagation()}>
      <select
        className={cn(
          "w-full max-w-[12rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium text-slate-900",
          pending && "opacity-60",
        )}
        value={pending ? value : status}
        disabled={pending}
        title="Cambia stato senza aprire la scheda"
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-0.5 text-[10px] text-red-600">{error}</p> : null}
      {terminalStatus ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-950">
              {terminalStatus === "CHIUSO" ? "Chiudi contratto" : terminalStatus === "KO" ? "Contratto KO" : "Annulla contratto"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Le rate già incassate o pagate resteranno nello storico.
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-800">
              Data chiusura
              <input type="date" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-800">
              Motivo
              <input value={closureReason} onChange={(e) => setClosureReason(e.target.value)} placeholder="Es. cessazione, ripensamento, pratica respinta" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-800">
              Note facoltative
              <textarea value={closureNotes} onChange={(e) => setClosureNotes(e.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {terminalStatus === "CHIUSO"
                ? `Ultima ricorrente spettante: ${closureDate.slice(0, 7).split("-").reverse().join("/")}. Dal mese successivo non verranno generate nuove rate.`
                : "Le ricorrenti ancora aperte verranno chiuse e non saranno più conteggiate."}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setTerminalStatus(null); setValue(status); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Annulla</button>
              <button type="button" onClick={confirmTerminalStatus} disabled={pending} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Conferma stato</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
