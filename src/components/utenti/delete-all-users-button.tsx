"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteAllOtherUsersAction } from "@/lib/actions";

/**
 * Pulsante pericoloso: due conferme nel browser + testo obbligatorio lato server.
 */
export function DeleteAllUsersButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const ok1 = window.confirm(
      "ATTENZIONE: stai per eliminare TUTTI gli altri utenti (tranne te).\n\nVuoi continuare?",
    );
    if (!ok1) return;

    const typed = window.prompt(
      'Seconda conferma: digita esattamente ELIMINA TUTTI (maiuscole) per procedere.',
    );
    if (typed === null) return;
    if (typed.trim() !== "ELIMINA TUTTI") {
      setError('Testo non corretto. Devi scrivere esattamente: ELIMINA TUTTI');
      return;
    }

    const form = formRef.current;
    if (!form) return;

    const fd = new FormData(form);
    fd.set("confirmText", "ELIMINA TUTTI");

    startTransition(async () => {
      try {
        await deleteAllOtherUsersAction(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eliminazione non riuscita");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form ref={formRef} onSubmit={onSubmit}>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Eliminazione…" : "Elimina tutti tranne me"}
        </Button>
      </form>
      {error ? (
        <p className="max-w-xs text-right text-xs text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
