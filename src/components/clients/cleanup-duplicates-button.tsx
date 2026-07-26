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
              "Unisco anagrafiche duplicate (stesso nome+P.IVA/CF) e archivio i contratti POD precedenti fuori storno. Continuo?",
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
        {pending ? "Pulizia…" : "Pulisci duplicati"}
      </Button>
      {msg ? <p className="max-w-xs text-right text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
