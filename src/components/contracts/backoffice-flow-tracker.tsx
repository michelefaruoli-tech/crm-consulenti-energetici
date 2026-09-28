import { cn } from "@/lib/cn";
import {
  BACK_OFFICE_PHASE_LABELS,
  buildBackOfficeFlowSteps,
  mapStatusToBackOfficePhase,
  type BackOfficeFlowPhase,
} from "@/lib/contract-bo-flow";
import { formatRomeDateTime } from "@/lib/timezone";

type HistoryEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date | string;
  changeReason?: string | null;
  note?: string | null;
  changedBy?: { name: string } | null;
};

/**
 * Tracciamento presa in carico BO: Inviato → In lavorazione → Conclusa
 * (+ richiesta integrazione). Solo UI su stati Prisma esistenti.
 */
export function BackOfficeFlowTracker({
  status,
  sendToMaster,
  assignedToMaster,
  sentToMasterAt,
  history,
  integrationNotes,
}: {
  status: string;
  sendToMaster?: boolean;
  assignedToMaster?: boolean;
  sentToMasterAt?: Date | string | null;
  history?: HistoryEntry[];
  /** Note richiesta integrazione documenti (workNotes / notes) */
  integrationNotes?: string | null;
}) {
  const phase = mapStatusToBackOfficePhase(status, {
    sendToMaster,
    assignedToMaster,
  });
  const steps = buildBackOfficeFlowSteps(status, {
    sendToMaster,
    assignedToMaster,
  });

  const boHistory = (history ?? []).filter((h) => {
    const to = mapStatusToBackOfficePhase(h.toStatus, {
      sendToMaster: true,
      assignedToMaster: true,
    });
    return (
      to === "inviato_bo" ||
      to === "in_lavorazione" ||
      to === "richiesta_integrazione" ||
      to === "conclusa" ||
      to === "ko" ||
      /back office|lavorazione|integraz/i.test(
        `${h.changeReason ?? ""} ${h.note ?? ""}`,
      )
    );
  });

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      data-testid="backoffice-flow-tracker"
    >
      <div className="mb-3">
        <h2 className="font-semibold text-slate-900">Flusso Back Office</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Presa in carico:{" "}
          <strong>{BACK_OFFICE_PHASE_LABELS[phase as BackOfficeFlowPhase]}</strong>
          {sentToMasterAt
            ? ` · inviato ${formatRomeDateTime(sentToMasterAt)}`
            : ""}
        </p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold ring-1",
              step.current
                ? "bg-emerald-600 text-white ring-emerald-700"
                : step.reached
                  ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                  : "bg-slate-50 text-slate-500 ring-slate-200",
            )}
          >
            {step.label}
          </li>
        ))}
      </ol>

      {phase === "richiesta_integrazione" ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Richiesta integrazione documenti</p>
          <p className="mt-1 text-xs">
            {integrationNotes?.trim() ||
              "Il Back Office ha chiesto documenti o dati aggiuntivi. Carica gli allegati mancanti e reinvia."}
          </p>
        </div>
      ) : null}

      {boHistory.length > 0 ? (
        <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto text-xs text-slate-600">
          {boHistory.slice(0, 12).map((h) => (
            <li
              key={h.id}
              className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-1.5"
            >
              <span className="font-medium text-slate-800">
                {h.fromStatus ?? "—"} → {h.toStatus}
              </span>
              {" · "}
              {formatRomeDateTime(h.changedAt)}
              {h.changedBy?.name ? ` · ${h.changedBy.name}` : ""}
              {h.changeReason ? (
                <span className="mt-0.5 block text-slate-500">
                  {h.changeReason}
                  {h.note ? ` — ${h.note}` : ""}
                </span>
              ) : h.note ? (
                <span className="mt-0.5 block text-slate-500">{h.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
