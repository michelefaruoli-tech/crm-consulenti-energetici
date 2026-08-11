"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { formatCurrency } from "@/lib/commission";
import { REPORT_EXTRA_TYPE_SUGGESTIONS } from "@/lib/report-extras";

type ExtraDraft = {
  tipologia: string;
  amount: string;
  note: string;
};

const EMPTY: ExtraDraft = { tipologia: "", amount: "", note: "" };

/**
 * 3 voci manuali (tipologia / importo / note) + pulsanti Excel/PDF.
 * Gli importi compilati finiscono nel rendiconto e si sommano al totale.
 */
export function ReportExportPanel({
  baseQuery,
}: {
  /** Query già con filtri report (senza `?`) */
  baseQuery: string;
}) {
  const [extras, setExtras] = useState<ExtraDraft[]>([
    { tipologia: REPORT_EXTRA_TYPE_SUGGESTIONS[0], amount: "", note: "" },
    { ...EMPTY },
    { ...EMPTY },
  ]);

  function update(i: number, patch: Partial<ExtraDraft>) {
    setExtras((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  const exportQs = useMemo(() => {
    const qs = new URLSearchParams(baseQuery);
    extras.forEach((row, idx) => {
      const n = idx + 1;
      const tip = row.tipologia.trim();
      const amt = row.amount.trim();
      const note = row.note.trim();
      if (!tip && !amt && !note) return;
      if (tip) qs.set(`extra${n}Type`, tip);
      if (amt) qs.set(`extra${n}Amount`, amt);
      if (note) qs.set(`extra${n}Note`, note);
    });
    return `?${qs.toString()}`;
  }, [baseQuery, extras]);

  const previewSum = extras.reduce((s, row) => {
    const t = row.amount.trim().replace(",", ".");
    if (!t) return s;
    const n = Number(t);
    return Number.isFinite(n) ? s + n : s;
  }, 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-2 font-semibold text-slate-900">Esporta (filtri attuali)</h2>
      <p className="mb-4 text-sm text-slate-500">
        Excel e PDF usano i filtri sopra. Compila le voci sotto solo se ti servono
        (es. acconti): entrano nel rendiconto e si <strong>sommano</strong> al totale
        netto.
      </p>

      <div className="mb-5 space-y-3">
        <h3 className="text-sm font-medium text-slate-800">
          Voci aggiuntive (opzionali)
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Tipologia</th>
                <th className="px-2 py-2">Importo €</th>
                <th className="px-2 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {extras.map((row, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-2">
                    <Input
                      list={`report-extra-types-${i}`}
                      value={row.tipologia}
                      onChange={(e) => update(i, { tipologia: e.target.value })}
                      placeholder={
                        i === 0
                          ? "Acconti precedenti"
                          : i === 1
                            ? "Conguaglio"
                            : "Bonus / premio"
                      }
                      className="min-w-[10rem]"
                    />
                    <datalist id={`report-extra-types-${i}`}>
                      {REPORT_EXTRA_TYPE_SUGGESTIONS.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => update(i, { amount: e.target.value })}
                      placeholder="0,00"
                      className="w-28"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      value={row.note}
                      onChange={(e) => update(i, { note: e.target.value })}
                      placeholder="Opzionale"
                      className="min-w-[12rem]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {previewSum !== 0 ? (
          <p className="text-sm text-slate-600">
            Somma voci aggiuntive:{" "}
            <strong className="text-emerald-800">{formatCurrency(previewSum)}</strong>{" "}
            (verrà aggiunta al totale netto nell’export)
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Lascia vuoto se non ti servono. Puoi usare importi negativi per detrazioni.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/api/report/excel${exportQs}`}>
          <Button variant="secondary">Scarica Excel</Button>
        </Link>
        <Link href={`/api/report/pdf${exportQs}`}>
          <Button variant="secondary">Scarica PDF</Button>
        </Link>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        L’export apre con il foglio/sezione <strong>Rendiconto</strong>: Incassato +
        Storni + ricorrenti + eventuali voci sopra, con subtotali.
      </p>
    </section>
  );
}
