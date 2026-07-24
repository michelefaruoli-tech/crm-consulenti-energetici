"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CollaboratorOption, ContractTableRow } from "@/lib/contract-row";
import { updateContractFieldAction } from "@/lib/contract-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

type Pending = { contractId: string; field: string; value: string; rowKey: string };

export function ContractsFilterTable({
  rows,
  editable = true,
  canDelete = false,
  canChangeCollaborator = false,
  collaborators = [],
}: {
  rows: ContractTableRow[];
  editable?: boolean;
  canDelete?: boolean;
  /** Admin + Segreteria: tendina collaboratore in elenco/Dashboard */
  canChangeCollaborator?: boolean;
  collaborators?: CollaboratorOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirty = pending.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const queueEdit = useCallback(
    (row: Record<string, unknown>, key: string, value: string) => {
      const map: Record<string, string> = {
        podPdr: "podPdr",
        statusLabel: "status",
        insertionDate: "insertionDate",
        supplyStartDate: "supplyStartDate",
        operationLabel: "operationType",
        collaboratorName: "collaboratorId",
      };
      const field = map[key];
      if (!field) return;
      const contractId = String(row.id);
      const rowKey = `${contractId}:${field}`;
      setPending((prev) => {
        const rest = prev.filter((p) => p.rowKey !== rowKey);
        return [...rest, { contractId, field, value, rowKey }];
      });
      setMessage(null);
      setError(null);
    },
    [],
  );

  function saveAll() {
    startSave(async () => {
      setError(null);
      try {
        for (const p of pending) {
          const fd = new FormData();
          fd.set("contractId", p.contractId);
          fd.set("field", p.field);
          fd.set("value", p.value);
          await updateContractFieldAction(fd);
        }
        setPending([]);
        setMessage("Modifiche salvate");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore di salvataggio");
      }
    });
  }

  const columns: FilterColumn[] = [
    {
      key: "clientName",
      label: "Cliente",
      getValue: (r) => String(r.clientName ?? ""),
      render: (r) => (
        <Link
          href={`/contratti/${String(r.id)}`}
          className="font-medium text-emerald-700 hover:underline"
          onClick={(e) => {
            if (dirty && !confirm("Hai modifiche non salvate. Vuoi uscire senza salvarle?")) {
              e.preventDefault();
              return;
            }
            e.stopPropagation();
          }}
        >
          {String(r.clientName)}
        </Link>
      ),
    },
    {
      key: "supplierName",
      label: "Fornitore",
      getValue: (r) => String(r.supplierName ?? ""),
    },
    {
      key: "utilityFilter",
      label: "POD / PDR",
      getValue: (r) => String(r.utilityFilter ?? r.podPdr ?? "").trim(),
      editable: false,
      render: (r) => {
        const techLines = Array.isArray(r.techLines)
          ? (r.techLines as string[])
          : [String(r.podPdr ?? "")].filter(Boolean);
        const serviceLabel = String(r.serviceLabel ?? "");
        if (editable) {
          return (
            <div className="min-w-[8rem]" onClick={(e) => e.stopPropagation()}>
              <input
                className="w-full rounded border border-transparent bg-transparent px-0.5 py-0.5 text-xs hover:border-slate-200 focus:border-emerald-500 focus:outline-none"
                defaultValue={String(r.podPdr ?? "")}
                title="Modifica POD/PDR"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  const next = e.target.value;
                  const prev = String(r.podPdr ?? "");
                  if (next !== prev) queueEdit(r, "podPdr", next);
                }}
              />
              {serviceLabel ? (
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {serviceLabel}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <div className="min-w-[7rem]">
            {techLines.length > 0 ? (
              techLines.map((line) => (
                <p key={line} className="text-xs text-slate-900">
                  {line}
                </p>
              ))
            ) : (
              <p className="text-xs text-slate-400">—</p>
            )}
            {serviceLabel ? (
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {serviceLabel}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "statusLabel",
      label: "Stato",
      getValue: (r) => String(r.statusLabel ?? ""),
      editable,
      render: editable ? undefined : (r) => <StatusBadge status={String(r.status)} />,
    },
    {
      key: "insertionDate",
      label: "Inserimento",
      getValue: (r) => String(r.insertionDate ?? ""),
      editable,
      sortKind: "date",
    },
    {
      key: "supplyStartDate",
      label: "Inizio fornitura",
      getValue: (r) => String(r.supplyStartDate ?? ""),
      editable,
      sortKind: "date",
    },
    {
      key: "operationLabel",
      label: "Operazione",
      getValue: (r) => String(r.operationLabel ?? ""),
      editable,
    },
    {
      key: "collaboratorName",
      label: "Collaboratore",
      getValue: (r) => String(r.collaboratorName ?? ""),
      render: (r) => {
        if (!canChangeCollaborator || collaborators.length === 0) {
          return <span className="text-xs text-slate-700">{String(r.collaboratorName ?? "")}</span>;
        }
        const currentId = String(r.collaboratorId ?? "");
        return (
          <select
            className="max-w-[11rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
            defaultValue={currentId}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = e.target.value;
              if (next !== currentId) queueEdit(r, "collaboratorName", next);
            }}
          >
            {collaborators.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.active && c.id !== currentId}>
                {c.name}
                {!c.active ? " (inattivo)" : ""}
                {c.roleLabel ? ` · ${c.roleLabel}` : ""}
              </option>
            ))}
          </select>
        );
      },
    },
  ];

  if (canDelete) {
    columns.push({
      key: "_del",
      label: "",
      getValue: () => "",
      render: (r) => <DeleteRowButton kind="contract" id={String(r.id)} />,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {editable
            ? "Modifica le celle, poi clicca «Salva cambiamenti». Sotto POD/PDR vedi il tipo di servizio."
            : null}{" "}
          {canChangeCollaborator
            ? "Puoi cambiare il collaboratore dalla tendina (Admin/Segreteria)."
            : null}{" "}
          {canDelete ? "Elimina archivia la riga (soft delete)." : null}
        </p>
        {editable || canChangeCollaborator ? (
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={saveAll}>
            {saving ? "Salvataggio…" : `Salva cambiamenti${dirty ? ` (${pending.length})` : ""}`}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className="text-xs text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <ExcelFilterTable
        dense
        rows={rows as unknown as Record<string, unknown>[]}
        columns={columns}
        rowKey={(r) => String(r.id)}
        onRowClick={(r) => {
          if (dirty && !confirm("Hai modifiche non salvate. Vuoi uscire senza salvarle?")) {
            return;
          }
          router.push(`/contratti/${r.id}`);
        }}
        onCellEdit={editable ? queueEdit : undefined}
      />
    </div>
  );
}
