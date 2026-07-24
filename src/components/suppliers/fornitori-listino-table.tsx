"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateSupplierListinoAction } from "@/lib/actions";

export type FornitoreListinoRow = {
  id: string;
  name: string;
  code: string;
  email: string;
  active: boolean;
  contractsCount: number;
  stornoMonths: string;
  gettone: string;
  paymentType: string;
  paymentTypeLabel: string;
};

type Pending = {
  supplierId: string;
  field: string;
  value: string;
  rowKey: string;
};

const PAYMENT_OPTIONS = [
  { value: "UNA_TANTUM", label: "Una tantum" },
  { value: "MENSILE", label: "Mensile" },
  { value: "RATEIZZATO", label: "Rateizzato" },
  { value: "BONUS", label: "Bonus" },
  { value: "PREMIO", label: "Premio" },
];

export function FornitoriListinoTable({ rows }: { rows: FornitoreListinoRow[] }) {
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

  const queueEdit = useCallback((supplierId: string, field: string, value: string) => {
    const rowKey = `${supplierId}:${field}`;
    setPending((prev) => {
      const rest = prev.filter((p) => p.rowKey !== rowKey);
      return [...rest, { supplierId, field, value, rowKey }];
    });
    setMessage(null);
    setError(null);
  }, []);

  function currentValue(row: FornitoreListinoRow, field: string): string {
    const p = pending.find((x) => x.supplierId === row.id && x.field === field);
    if (p) return p.value;
    if (field === "name") return row.name;
    if (field === "code") return row.code;
    if (field === "email") return row.email;
    if (field === "stornoMonths") return row.stornoMonths;
    if (field === "gettone") return row.gettone;
    if (field === "paymentType") return row.paymentType;
    if (field === "active") return row.active ? "true" : "false";
    return "";
  }

  function saveAll() {
    startSave(async () => {
      setError(null);
      try {
        const byId = new Map<string, Record<string, string>>();
        for (const p of pending) {
          const cur = byId.get(p.supplierId) ?? {};
          cur[p.field] = p.value;
          byId.set(p.supplierId, cur);
        }

        for (const [supplierId, changes] of byId) {
          const row = rows.find((r) => r.id === supplierId);
          if (!row) continue;
          const fd = new FormData();
          fd.set("supplierId", supplierId);
          fd.set("name", changes.name ?? row.name);
          fd.set("code", changes.code ?? row.code);
          fd.set("email", changes.email ?? row.email);
          fd.set("active", changes.active ?? (row.active ? "true" : "false"));
          fd.set("stornoMonths", changes.stornoMonths ?? row.stornoMonths);
          fd.set("gettone", changes.gettone ?? row.gettone);
          fd.set("paymentType", changes.paymentType ?? row.paymentType);
          await updateSupplierListinoAction(fd);
        }

        setPending([]);
        setMessage("Listino salvato");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore di salvataggio");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Listino base fornitori</h2>
          <p className="text-xs text-slate-500">
            Modifica le celle (storno e gettone semplice), poi clicca «Salva cambiamenti».
            Regole complesse (kW, fasce, potenza…) le inserirai a mano più avanti.
          </p>
        </div>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={saveAll}>
          {saving ? "Salvataggio…" : `Salva cambiamenti${dirty ? ` (${pending.length})` : ""}`}
        </Button>
      </div>

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 font-medium">Fornitore</th>
              <th className="px-2 py-2 font-medium">Codice</th>
              <th className="px-2 py-2 font-medium">Email</th>
              <th className="px-2 py-2 font-medium">Contratti</th>
              <th className="px-2 py-2 font-medium">Mesi storno</th>
              <th className="px-2 py-2 font-medium">Gettone € (base)</th>
              <th className="px-2 py-2 font-medium">Tipo gettone</th>
              <th className="px-2 py-2 font-medium">Attivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cell =
                "w-full min-w-[5rem] rounded border border-transparent bg-transparent px-1 py-1 hover:border-slate-200 focus:border-emerald-500 focus:outline-none";
              return (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-2 py-1.5">
                    <input
                      className={`${cell} min-w-[8rem] font-medium text-slate-900`}
                      defaultValue={row.name}
                      onBlur={(e) => {
                        if (e.target.value !== row.name) queueEdit(row.id, "name", e.target.value);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${cell} min-w-[4rem] uppercase`}
                      defaultValue={row.code}
                      onBlur={(e) => {
                        const next = e.target.value.toUpperCase();
                        if (next !== row.code) queueEdit(row.id, "code", next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${cell} min-w-[9rem]`}
                      defaultValue={row.email}
                      placeholder="—"
                      onBlur={(e) => {
                        if (e.target.value !== row.email) queueEdit(row.id, "email", e.target.value);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{row.contractsCount}</td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${cell} w-20`}
                      type="number"
                      min={0}
                      defaultValue={row.stornoMonths}
                      placeholder="es. 12"
                      title="Mesi di storno dal ingresso fornitura"
                      onBlur={(e) => {
                        if (e.target.value !== row.stornoMonths) {
                          queueEdit(row.id, "stornoMonths", e.target.value);
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${cell} w-24`}
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={row.gettone}
                      placeholder="es. 50"
                      title="Gettone listino base (regole semplici)"
                      onBlur={(e) => {
                        if (e.target.value !== row.gettone) {
                          queueEdit(row.id, "gettone", e.target.value);
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="max-w-[9rem] rounded border border-slate-200 bg-white px-1 py-1"
                      value={currentValue(row, "paymentType")}
                      onChange={(e) => queueEdit(row.id, "paymentType", e.target.value)}
                    >
                      {PAYMENT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="rounded border border-slate-200 bg-white px-1 py-1"
                      value={currentValue(row, "active")}
                      onChange={(e) => queueEdit(row.id, "active", e.target.value)}
                    >
                      <option value="true">Sì</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {rows.length} fornitori · modifiche in coda: {pending.length}
        </div>
      </div>
    </div>
  );
}
