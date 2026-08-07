"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContractFieldAction } from "@/lib/contract-actions";
import { CONTRACT_STATUS_LABELS, type AppContractStatus } from "@/lib/constants";
import {
  MASTER_STATUS_LABELS,
  MASTER_WORKFLOW_STATUSES,
  type MasterWorkflowStatus,
} from "@/lib/master-workflow";
import { cn } from "@/lib/cn";

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

  useEffect(() => {
    setValue(status);
  }, [status]);

  const options =
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
    if (next === value) return;
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

  return (
    <div className={cn("min-w-[9.5rem]", className)} onClick={(e) => e.stopPropagation()}>
      <select
        className={cn(
          "w-full max-w-[12rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium text-slate-900",
          pending && "opacity-60",
        )}
        value={value}
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
    </div>
  );
}
