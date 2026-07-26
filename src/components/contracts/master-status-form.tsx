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
 * Form esito lavorazione Master.
 * Tre scelte: In pagamento · Richiesta integrazione · KO
 * (+ opzione «In lavorazione» per rimettere in coda).
 */
export function MasterStatusForm({
  contractId,
  currentStatus,
  action,
}: {
  contractId: string;
  currentStatus: string;
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Esito lavorazione">
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
        <Field label="Note di lavorazione">
          <Textarea name="workNotes" rows={2} placeholder="Annotazioni interne" />
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
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-900">
          <strong>In pagamento</strong>: la pratica è ok. Il gettone e i pagamenti
          si gestiscono in Provvigioni.
        </div>
      ) : null}

      {status === "DOCUMENTAZIONE_INCOMPLETA" ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm text-amber-950">
            <strong>Richiesta integrazione</strong>: indica cosa manca al
            collaboratore.
          </p>
          <Field label="Dati / documenti mancanti *">
            <Textarea
              name="integrationNotes"
              rows={3}
              required
              placeholder="Es. manca CI retro, POD illegibile, IBAN non valido…"
            />
          </Field>
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
          <div className="sm:col-span-2">
            <Field label="Note KO *">
              <Textarea name="koNotes" rows={3} required />
            </Field>
          </div>
        </div>
      ) : null}

      <Button type="submit" className="w-full sm:w-auto">
        Salva esito
      </Button>
    </form>
  );
}
