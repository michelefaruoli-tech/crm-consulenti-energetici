"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cleanupClientDuplicatesAction } from "@/lib/client-cleanup-actions";

/** Admin: unisce anagrafiche omonime e archivia POD ricontrattualizzati. */
export function CleanupDuplicatesButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
            if (
            !confirm(
              "1) Riattivo i contratti importati nascosti (così Lobefaro & co. li vedono in Provvigioni).\n2) Unisco anagrafiche duplicate.\n3) Archivo i POD ricontrattualizzati (precedenti).\n\nContinuo?",
            )
          ) {
            return;
          }
          setMsg(null);
          start(async () => {
            const r = await cleanupClientDuplicatesAction();
            setMsg(r.message);
          });
        }}
      >
        {pending ? "Pulizia…" : "Ripristina elenchi + pulisci"}
      </Button>
      {msg ? <p className="max-w-xs text-right text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
