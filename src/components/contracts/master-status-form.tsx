"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  KO_REASON_OPTIONS,
  MASTER_OUTCOME_STATUSES,
  MASTER_STATUS_LABELS,
  type MasterWorkflowStatus,
} from "@/lib/master-workflow";

/**
 * Form esito lavorazione Back Office / Master.
 * Cambia stato + note per l’agente → Salva → email automatica all’agente.
 */
export function MasterStatusForm({
  contractId,
  currentStatus,
  initialNotes,
  action,
}: {
  contractId: string;
  currentStatus: string;
  initialNotes?: string | null;
  action: (formData: FormData) => Promise<void>;
}) {
  const initial =
    currentStatus === "IN_LAVORAZIONE" ||
    currentStatus === "IN_ATTESA_PAGAMENTO" ||
    currentStatus === "DOCUMENTAZIONE_INCOMPLETA" ||
    currentStatus === "KO"
      ? currentStatus
      : "IN_LAVORAZIONE";

  const [status, setStatus] = useState(initial);
  const [agentNotes, setAgentNotes] = useState(initialNotes ?? "");
  const [koReason, setKoReason] = useState("");

  const statusChanging = status !== currentStatus;
  const needsAgentNotes =
    status === "IN_ATTESA_PAGAMENTO" ||
    status === "DOCUMENTAZIONE_INCOMPLETA" ||
    status === "KO";

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (needsAgentNotes && !agentNotes.trim()) {
          e.preventDefault();
          alert(
            "Inserisci le note per l’agente (es. «contratto inserito, far firmare al cliente»).",
          );
          return;
        }
        const label =
          MASTER_STATUS_LABELS[status as MasterWorkflowStatus] ?? status;
        if (
          statusChanging &&
          !confirm(
            `Confermi il passaggio a «${label}»?\nAll’agente arriverà un’email con le note.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="space-y-4"
    >
      <input type="hidden" name="contractId" value={contractId} />

      <Field label="Stato">
        <Select
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="IN_LAVORAZIONE">
            {MASTER_STATUS_LABELS.IN_LAVORAZIONE}
          </option>
          {MASTER_OUTCOME_STATUSES.map((st) => (
            <option key={st} value={st}>
              {MASTER_STATUS_LABELS[st]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={
          needsAgentNotes
            ? "Note per l’agente (inviate via email) *"
            : "Note per l’agente"
        }
      >
        <Textarea
          name="agentNotes"
          rows={3}
          value={agentNotes}
          onChange={(e) => setAgentNotes(e.target.value)}
          required={needsAgentNotes}
          placeholder="Es. contratto inserito, far firmare al cliente"
        />
        <p className="mt-1 text-xs text-slate-500">
          Con «Salva», se lo stato cambia, l’agente riceve un’email: oggetto = cliente +
          fornitore, corpo = queste note.
        </p>
      </Field>

      {status === "IN_ATTESA_PAGAMENTO" ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-900">
          <strong>Da incassare</strong>: la pratica passa in Provvigioni. L’agente riceve
          le note (es. far firmare il contratto).
        </div>
      ) : null}

      {status === "DOCUMENTAZIONE_INCOMPLETA" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-950">
          <strong>Richiesta integrazione</strong>: nelle note indica cosa manca (CI,
          POD, IBAN…).
        </div>
      ) : null}

      {status === "KO" ? (
        <div className="grid gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3 sm:grid-cols-2">
          <Field label="Motivo del KO *">
            <Select
              name="koReason"
              value={koReason}
              onChange={(e) => setKoReason(e.target.value)}
              required
            >
              <option value="">Seleziona</option>
              {KO_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dettaglio Altro">
            <Input name="koOtherText" placeholder="Solo se motivo = Altro" />
          </Field>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="forceOverride" />
        Override admin (correzione stato)
      </label>

      <Button type="submit" className="w-full sm:w-auto">
        Salva
      </Button>
    </form>
  );
}
