"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { adminSetUserPasswordAction } from "@/lib/master-actions";

/**
 * Admin: imposta una nuova password per un collaboratore (senza email).
 */
export function AdminSetPasswordButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("userId", userId);

    start(async () => {
      const res = await adminSetUserPasswordAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Aggiornamento non riuscito");
        return;
      }
      setMessage(res.message ?? "Password aggiornata");
      form.reset();
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            setError(null);
            setMessage(null);
          }}
        >
          Nuova password
        </Button>
        {message ? (
          <p className="max-w-[14rem] text-[11px] text-emerald-700">{message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex min-w-[12rem] max-w-[16rem] flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
    >
      <p className="text-[11px] font-medium text-slate-700">
        Nuova password per {userName}
      </p>
      <p className="text-[10px] text-slate-500">
        Min. 8 caratteri, 1 lettera + 1 numero
      </p>
      <input
        name="newPassword"
        type="password"
        required
        minLength={8}
        placeholder="Es. Casa2026"
        autoComplete="new-password"
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <input
        name="confirmPassword"
        type="password"
        required
        minLength={8}
        placeholder="Conferma password"
        autoComplete="new-password"
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvo…" : "Salva"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Annulla
        </Button>
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </form>
  );
}
