"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExcelFilterTable, type FilterColumn } from "@/components/table/excel-filter-table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContractTableRow } from "@/lib/contract-row";
import { updateContractFieldAction } from "@/lib/contract-actions";
import { DeleteRowButton } from "@/components/ui/delete-row-button";

type Pending = { contractId: string; field: string; value: string; rowKey: string };

export function ContractsFilterTable({
  rows,
  editable = true,
  canDelete = false,
}: {
  rows: ContractTableRow[];
  editable?: boolean;
  canDelete?: boolean;
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
      key: "podPdr",
      label: "POD / PDR",
      getValue: (r) => String(r.podPdr ?? "").trim(),
      editable,
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
    },
    {
      key: "supplyStartDate",
      label: "Inizio fornitura",
      getValue: (r) => String(r.supplyStartDate ?? ""),
      editable,
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
            ? "Modifica le celle, poi clicca «Salva cambiamenti». POD / PDR in maiuscolo uniforme."
            : null}{" "}
          {canDelete ? "Elimina archivia la riga (soft delete)." : null}
        </p>
        {editable ? (
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
