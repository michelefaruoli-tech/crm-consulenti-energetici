"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { importCteListinoAction, importDolomitiListinoAction } from "@/lib/cte-actions";
import type { CteListinoKind } from "@/lib/cte-listino-detect";

const ITEMS: Array<{ kind: CteListinoKind; title: string; body: string }> = [
  {
    kind: "dolomiti",
    title: "Dolomiti",
    body: "17 offerte con prezzo dagli screenshot (senza righe «/»).",
  },
  {
    kind: "enel-corporate",
    title: "Enel Corporate Power",
    body: "7 CTE business fisse (Enel + Soluzione Energia), F1/F2/F3, perdite escluse.",
  },
  {
    kind: "sev-iren",
    title: "SEV Iren",
    body: "19 offerte domestiche dal PDF OFFERTE SEV-9.",
  },
  {
    kind: "compara",
    title: "Compara Semplice",
    body: "15 luce/gas dal volantino, senza gettoni. Super Luce Enel non ripetuta (già Corporate).",
  },
  {
    kind: "duferco-flex-condomini",
    title: "Duferco Flex Condomini",
    body: "18 CTE (8 luce + 10 gas) variabili, sezione Condomini, senza scadenza.",
  },
];

export function CteListinoImportPanel() {
  const router = useRouter();
  const [pending, setPending] = useState<CteListinoKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onImport(kind: CteListinoKind) {
    setPending(kind);
    setError(null);
    setMessage(null);
    try {
      if (kind === "dolomiti") {
        const res = await importDolomitiListinoAction();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setMessage(
          `Listino Dolomiti: ${res.created} create, ${res.updated} aggiornate (${res.supplierName}). Righe senza prezzo non importate.`,
        );
      } else {
        const res = await importCteListinoAction(kind);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const skip =
          res.skipped.length > 0 ? ` Non inserite: ${res.skipped.join("; ")}.` : "";
        setMessage(
          `Listino ${res.label}: ${res.created} create, ${res.updated} aggiornate.${skip}`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import non riuscito");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
      <h2 className="font-semibold text-slate-900">Listini da screenshot / PDF</h2>
      <p className="mt-1 text-sm text-slate-600">
        Aggiunge le offerte al catalogo. I numeri assenti restano vuoti; i compensi Compara non
        vengono importati. In alternativa carica il file: si apre la coda offerta per offerta.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.kind} className="rounded-lg border border-sky-100 bg-white/80 p-3">
            <p className="font-medium text-slate-900">{item.title}</p>
            <p className="mt-1 text-sm text-slate-600">{item.body}</p>
            <Button
              type="button"
              className="mt-2"
              disabled={pending != null}
              onClick={() => void onImport(item.kind)}
            >
              {pending === item.kind ? "Importazione…" : `Aggiungi ${item.title}`}
            </Button>
          </div>
        ))}
      </div>
      {message ? <p className="mt-3 text-sm text-emerald-800">{message}</p> : null}
      {error ? (
        <div className="mt-3">
          <PersistentAlert title="Import listino" messages={[error]} tone="error" />
        </div>
      ) : null}
    </div>
  );
}
