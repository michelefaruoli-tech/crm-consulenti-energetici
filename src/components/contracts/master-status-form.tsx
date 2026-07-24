"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  KO_REASON_OPTIONS,
  MASTER_STATUS_LABELS,
  MASTER_WORKFLOW_STATUSES,
  type MasterWorkflowStatus,
} from "@/lib/master-workflow";

export function MasterStatusForm({
  contractId,
  currentStatus,
  action,
}: {
  contractId: string;
  currentStatus: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [koReason, setKoReason] = useState("");

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const label =
          MASTER_STATUS_LABELS[status as MasterWorkflowStatus] ?? status;
        if (!confirm(`Confermi il passaggio a «${label}»?`)) {
          e.preventDefault();
        }
      }}
      className="space-y-4"
    >
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nuovo stato">
          <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {MASTER_WORKFLOW_STATUSES.map((st) => (
              <option key={st} value={st}>
                {MASTER_STATUS_LABELS[st]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note di lavorazione">
          <Textarea name="workNotes" rows={2} />
        </Field>
        <Field label="Nota storico">
          <Input name="note" placeholder="Motivo del cambiamento" />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="forceOverride" />
          Override admin (correzione stato)
        </label>
      </div>

      {status === "IN_ATTESA_PAGAMENTO" ? (
        <div className="grid gap-3 rounded-lg border border-orange-100 bg-orange-50/50 p-3 md:grid-cols-2">
          <Field label="Importo atteso €">
            <Input name="expectedPaymentAmount" inputMode="decimal" />
          </Field>
          <Field label="Data prevista pagamento">
            <Input name="expectedPaymentDate" type="date" />
          </Field>
        </div>
      ) : null}

      {status === "ATTIVATO" ? (
        <div className="grid gap-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 md:grid-cols-2">
          <Field label="Data attivazione *">
            <Input name="activationDate" type="date" required />
          </Field>
          <Field label="Data pagamento">
            <Input name="paymentDate" type="date" />
          </Field>
          <Field label="Importo pagato €">
            <Input name="paymentAmount" inputMode="decimal" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="paymentConfirmed" />
            Confermo pagamento ricevuto
          </label>
        </div>
      ) : null}

      {status === "KO" ? (
        <div className="grid gap-3 rounded-lg border border-red-100 bg-red-50/50 p-3 md:grid-cols-2">
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
          {koReason === "ALTRO" ? (
            <Field label="Specifica motivo *">
              <Input name="koOtherText" required />
            </Field>
          ) : null}
          <div className="md:col-span-2">
            <Field label="Note sul KO *">
              <Textarea name="koNotes" rows={3} required />
            </Field>
          </div>
        </div>
      ) : null}

      <Button type="submit">Salva aggiornamento</Button>
    </form>
  );
}
