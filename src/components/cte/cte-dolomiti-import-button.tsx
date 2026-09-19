"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PersistentAlert } from "@/components/ui/persistent-alert";
import { importDolomitiListinoAction } from "@/lib/cte-actions";

export function CteDolomitiImportButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onImport() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await importDolomitiListinoAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        `Listino Dolomiti: ${res.created} create, ${res.updated} aggiornate (${res.supplierName}). Righe senza prezzo nello screenshot non sono state importate.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import non riuscito");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
      <h2 className="font-semibold text-slate-900">Listino Dolomiti da screenshot</h2>
      <p className="mt-1 text-sm text-slate-600">
        Importa le 17 offerte con prezzo visibile nelle tabelle (residenziale, extra, business,
        corporate, pertinenza). Le righe con «/» restano fuori. Poi rivedile dal catalogo.
      </p>
      <div className="mt-3">
        <Button type="button" disabled={pending} onClick={() => void onImport()}>
          {pending ? "Importazione…" : "Aggiungi offerte Dolomiti al catalogo"}
        </Button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <PersistentAlert title="Import listino" messages={[error]} tone="error" />
        </div>
      ) : null}
    </div>
  );
}
