"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fixSwappedClientNamesAction } from "@/lib/client-name-fix-actions";

/** Admin: scambia Nome/Cognome dove l'euristica IT (o il CF) rileva l'inversione. */
export function FixSwappedNamesButton() {
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
              "Correggere i clienti PRIVATO con Nome e Cognome invertiti?\n\n" +
                "Usa i nomi italiani tipici e, se presente, il codice fiscale.\n" +
                "I casi dubbi non vengono toccati.\n\nContinuo?",
            )
          ) {
            return;
          }
          setMsg(null);
          start(async () => {
            const r = await fixSwappedClientNamesAction();
            setMsg(r.message);
          });
        }}
      >
        {pending ? "Correzione nomi…" : "Sistema Nome/Cognome"}
      </Button>
      {msg ? <p className="max-w-xs text-right text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
