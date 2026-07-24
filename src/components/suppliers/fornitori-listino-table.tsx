"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  createListinoRuleAction,
  deactivateListinoRuleAction,
  updateListinoRuleAction,
  updateSupplierListinoAction,
} from "@/lib/actions";
import { formatListinoTotale, sumUnaTantumGettoni } from "@/lib/listino";

export type FornitoreAnagraficaRow = {
  id: string;
  name: string;
  code: string;
  email: string;
  active: boolean;
  contractsCount: number;
  stornoMonths: string;
};

export type ListinoRegolaRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  name: string;
  clientSegment: string;
  stornoMonths: string;
  gettoneBase: string;
  gettoneRid: string;
  gettoneBollettaWeb: string;
  gettoneMail: string;
  gettoneUnaTantumIniziale: string;
  gettoneMensile: string;
  active: boolean;
};

type SupplierPending = { supplierId: string; field: string; value: string; rowKey: string };
type RulePending = { ruleId: string; field: string; value: string; rowKey: string };

const SEGMENTS = [
  { value: "TUTTI", label: "Tutti" },
  { value: "PRIVATO", label: "Privato" },
  { value: "BUSINESS", label: "Business" },
];

const cellCls =
  "w-full min-w-[4rem] rounded border border-transparent bg-transparent px-1 py-1 hover:border-slate-200 focus:border-emerald-500 focus:outline-none";

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function FornitoriListinoEditor({
  suppliers,
  rules,
}: {
  suppliers: FornitoreAnagraficaRow[];
  rules: ListinoRegolaRow[];
}) {
  const router = useRouter();
  const [supplierPending, setSupplierPending] = useState<SupplierPending[]>([]);
  const [rulePending, setRulePending] = useState<RulePending[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const dirty = supplierPending.length + rulePending.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const queueSupplier = useCallback((supplierId: string, field: string, value: string) => {
    const rowKey = `${supplierId}:${field}`;
    setSupplierPending((prev) => [...prev.filter((p) => p.rowKey !== rowKey), { supplierId, field, value, rowKey }]);
    setMessage(null);
    setError(null);
  }, []);

  const queueRule = useCallback((ruleId: string, field: string, value: string) => {
    const rowKey = `${ruleId}:${field}`;
    setRulePending((prev) => [...prev.filter((p) => p.rowKey !== rowKey), { ruleId, field, value, rowKey }]);
    setMessage(null);
    setError(null);
  }, []);

  function supplierVal(row: FornitoreAnagraficaRow, field: string): string {
    const p = supplierPending.find((x) => x.supplierId === row.id && x.field === field);
    if (p) return p.value;
    if (field === "name") return row.name;
    if (field === "code") return row.code;
    if (field === "email") return row.email;
    if (field === "stornoMonths") return row.stornoMonths;
    if (field === "active") return row.active ? "true" : "false";
    return "";
  }

  function ruleVal(row: ListinoRegolaRow, field: keyof ListinoRegolaRow | string): string {
    const p = rulePending.find((x) => x.ruleId === row.id && x.field === field);
    if (p) return p.value;
    const v = (row as Record<string, unknown>)[field];
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v ?? "");
  }

  const liveRules = useMemo(() => {
    return rules.map((r) => ({
      ...r,
      name: ruleVal(r, "name"),
      clientSegment: ruleVal(r, "clientSegment"),
      stornoMonths: ruleVal(r, "stornoMonths"),
      gettoneBase: ruleVal(r, "gettoneBase"),
      gettoneRid: ruleVal(r, "gettoneRid"),
      gettoneBollettaWeb: ruleVal(r, "gettoneBollettaWeb"),
      gettoneMail: ruleVal(r, "gettoneMail"),
      gettoneUnaTantumIniziale: ruleVal(r, "gettoneUnaTantumIniziale"),
      gettoneMensile: ruleVal(r, "gettoneMensile"),
      active: ruleVal(r, "active") === "true",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleVal depends on rulePending
  }, [rules, rulePending]);

  function saveAll() {
    startSave(async () => {
      setError(null);
      try {
        const suppliersById = new Map<string, Record<string, string>>();
        for (const p of supplierPending) {
          const cur = suppliersById.get(p.supplierId) ?? {};
          cur[p.field] = p.value;
          suppliersById.set(p.supplierId, cur);
        }
        for (const [supplierId, changes] of suppliersById) {
          const row = suppliers.find((r) => r.id === supplierId);
          if (!row) continue;
          const fd = new FormData();
          fd.set("supplierId", supplierId);
          fd.set("name", changes.name ?? row.name);
          fd.set("code", changes.code ?? row.code);
          fd.set("email", changes.email ?? row.email);
          fd.set("active", changes.active ?? (row.active ? "true" : "false"));
          fd.set("stornoMonths", changes.stornoMonths ?? row.stornoMonths);
          await updateSupplierListinoAction(fd);
        }

        const rulesById = new Map<string, Record<string, string>>();
        for (const p of rulePending) {
          const cur = rulesById.get(p.ruleId) ?? {};
          cur[p.field] = p.value;
          rulesById.set(p.ruleId, cur);
        }
        for (const [ruleId, changes] of rulesById) {
          const row = rules.find((r) => r.id === ruleId);
          if (!row) continue;
          const fd = new FormData();
          fd.set("ruleId", ruleId);
          fd.set("name", changes.name ?? row.name);
          fd.set("clientSegment", changes.clientSegment ?? row.clientSegment);
          fd.set("stornoMonths", changes.stornoMonths ?? row.stornoMonths);
          fd.set("gettoneBase", changes.gettoneBase ?? row.gettoneBase);
          fd.set("gettoneRid", changes.gettoneRid ?? row.gettoneRid);
          fd.set("gettoneBollettaWeb", changes.gettoneBollettaWeb ?? row.gettoneBollettaWeb);
          fd.set("gettoneMail", changes.gettoneMail ?? row.gettoneMail);
          fd.set("gettoneUnaTantumIniziale", changes.gettoneUnaTantumIniziale ?? row.gettoneUnaTantumIniziale);
          fd.set("gettoneMensile", changes.gettoneMensile ?? row.gettoneMensile);
          fd.set("active", changes.active ?? (row.active ? "true" : "false"));
          await updateListinoRuleAction(fd);
        }

        setSupplierPending([]);
        setRulePending([]);
        setMessage("Listino salvato");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore di salvataggio");
      }
    });
  }

  async function addRule(form: HTMLFormElement) {
    setError(null);
    try {
      const fd = new FormData(form);
      await createListinoRuleAction(fd);
      form.reset();
      setMessage("Regola creata");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore creazione regola");
    }
  }

  async function deactivate(ruleId: string) {
    if (!confirm("Disattivare questa regola listino?")) return;
    const fd = new FormData();
    fd.set("ruleId", ruleId);
    await deactivateListinoRuleAction(fd);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Listino fornitori</h2>
          <p className="text-xs text-slate-500">
            Modifica celle → <strong>Salva cambiamenti</strong>. Gettone mail = extra se fattura via
            email. Totale = somma delle voci una tantum (+ mensile a parte).
          </p>
        </div>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={saveAll}>
          {saving ? "Salvataggio…" : `Salva cambiamenti${dirty ? ` (${supplierPending.length + rulePending.length})` : ""}`}
        </Button>
      </div>

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {/* Anagrafica fornitori */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">1. Anagrafica e storno default</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2">Fornitore</th>
                <th className="px-2 py-2">Codice</th>
                <th className="px-2 py-2">Email contatto</th>
                <th className="px-2 py-2">Contratti</th>
                <th className="px-2 py-2">Storno default (mesi)</th>
                <th className="px-2 py-2">Attivo</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input
                      className={`${cellCls} min-w-[8rem] font-medium`}
                      defaultValue={row.name}
                      onBlur={(e) => {
                        if (e.target.value !== row.name) queueSupplier(row.id, "name", e.target.value);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${cellCls} uppercase`}
                      defaultValue={row.code}
                      onBlur={(e) => {
                        const next = e.target.value.toUpperCase();
                        if (next !== row.code) queueSupplier(row.id, "code", next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className={`${cellCls} min-w-[9rem]`}
                      defaultValue={row.email}
                      placeholder="—"
                      onBlur={(e) => {
                        if (e.target.value !== row.email) queueSupplier(row.id, "email", e.target.value);
                      }}
                    />
                  </td>
                  <td className="px-2 py-1 text-slate-600">{row.contractsCount}</td>
                  <td className="px-2 py-1">
                    <input
                      className={`${cellCls} w-20`}
                      type="number"
                      min={0}
                      defaultValue={row.stornoMonths}
                      placeholder="12"
                      onBlur={(e) => {
                        if (e.target.value !== row.stornoMonths) {
                          queueSupplier(row.id, "stornoMonths", e.target.value);
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className="rounded border border-slate-200 bg-white px-1 py-1"
                      value={supplierVal(row, "active")}
                      onChange={(e) => queueSupplier(row.id, "active", e.target.value)}
                    >
                      <option value="true">Sì</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Regole listino */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">
          2. Regole listino (es. Dolomiti Privato, Dolomiti Business, Base Extra)
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2">Fornitore</th>
                <th className="px-2 py-2">Nome regola</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Storno</th>
                <th className="px-2 py-2">Base €</th>
                <th className="px-2 py-2">RID €</th>
                <th className="px-2 py-2">Boll.web €</th>
                <th className="px-2 py-2">Mail €</th>
                <th className="px-2 py-2">UT iniz. €</th>
                <th className="px-2 py-2">Mensile €</th>
                <th className="px-2 py-2">Totale</th>
                <th className="px-2 py-2">Attiva</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {liveRules.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-6 text-center text-slate-500">
                    Nessuna regola ancora. Creane una sotto (es. «Dolomiti Privato»).
                  </td>
                </tr>
              ) : (
                liveRules.map((row) => {
                  const totale = formatListinoTotale({
                    unaTantum: sumUnaTantumGettoni({
                      gettoneBase: num(row.gettoneBase),
                      gettoneRid: num(row.gettoneRid),
                      gettoneBollettaWeb: num(row.gettoneBollettaWeb),
                      gettoneMail: num(row.gettoneMail),
                      gettoneUnaTantumIniziale: num(row.gettoneUnaTantumIniziale),
                    }),
                    mensile: num(row.gettoneMensile),
                  });
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-medium text-slate-800">{row.supplierName}</td>
                      <td className="px-2 py-1">
                        <input
                          className={`${cellCls} min-w-[8rem]`}
                          defaultValue={row.name}
                          onBlur={(e) => {
                            if (e.target.value !== rules.find((r) => r.id === row.id)?.name) {
                              queueRule(row.id, "name", e.target.value);
                            }
                          }}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <select
                          className="rounded border border-slate-200 bg-white px-1 py-1"
                          value={row.clientSegment || "TUTTI"}
                          onChange={(e) => queueRule(row.id, "clientSegment", e.target.value)}
                        >
                          {SEGMENTS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          className={`${cellCls} w-14`}
                          type="number"
                          min={0}
                          defaultValue={row.stornoMonths}
                          placeholder="—"
                          title="Mesi storno di questa regola (se vuoto usa default fornitore)"
                          onBlur={(e) => queueRule(row.id, "stornoMonths", e.target.value)}
                        />
                      </td>
                      {(
                        [
                          "gettoneBase",
                          "gettoneRid",
                          "gettoneBollettaWeb",
                          "gettoneMail",
                          "gettoneUnaTantumIniziale",
                          "gettoneMensile",
                        ] as const
                      ).map((field) => (
                        <td key={field} className="px-2 py-1">
                          <input
                            className={`${cellCls} w-16`}
                            type="number"
                            step="0.01"
                            min={0}
                            defaultValue={row[field]}
                            placeholder="0"
                            onBlur={(e) => queueRule(row.id, field, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 whitespace-nowrap font-medium text-emerald-800">
                        {totale}
                      </td>
                      <td className="px-2 py-1">
                        <select
                          className="rounded border border-slate-200 bg-white px-1 py-1"
                          value={row.active ? "true" : "false"}
                          onChange={(e) => queueRule(row.id, "active", e.target.value)}
                        >
                          <option value="true">Sì</option>
                          <option value="false">No</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          className="text-[11px] text-red-600 hover:underline"
                          onClick={() => void deactivate(row.id)}
                        >
                          Disattiva
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Nuova regola */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Aggiungi regola listino</h3>
        <form
          className="grid gap-3 md:grid-cols-3 xl:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addRule(e.currentTarget);
          }}
        >
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Fornitore *</span>
            <select
              name="supplierId"
              required
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
            >
              <option value="">Seleziona</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Nome regola *</span>
            <input
              name="name"
              required
              placeholder="Es. Dolomiti Privato"
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Tipologia</span>
            <select
              name="clientSegment"
              defaultValue="TUTTI"
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
            >
              {SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Mesi storno</span>
            <input
              name="stornoMonths"
              type="number"
              min={0}
              placeholder="es. 12"
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Gettone base €</span>
            <input name="gettoneBase" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Gettone RID €</span>
            <input name="gettoneRid" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Bolletta web €</span>
            <input name="gettoneBollettaWeb" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Mail (fattura email) €</span>
            <input name="gettoneMail" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Una tantum iniziale €</span>
            <input name="gettoneUnaTantumIniziale" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-slate-700">Mensile €</span>
            <input name="gettoneMensile" type="number" step="0.01" min={0} className="w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <div className="flex items-end md:col-span-2">
            <Button type="submit">Crea regola</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
