"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserNameAction } from "@/lib/user-actions";
import { Button } from "@/components/ui/button";

/**
 * Admin/Master: modifica il nominativo visualizzato (filtri Provvigioni/Report).
 * Non tocca password né email.
 */
export function EditUserNameForm({
  user,
}: {
  user: { id: string; name: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            setName(user.name);
            setError(null);
            setMessage(null);
          }}
        >
          Cambia nominativo
        </Button>
        {message ? (
          <p className="max-w-[14rem] text-[11px] text-emerald-700">{message}</p>
        ) : null}
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("userId", user.id);
    fd.set("name", name);

    start(async () => {
      const res = await updateUserNameAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Nominativo aggiornato");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex min-w-[12rem] max-w-[18rem] flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
    >
      <p className="text-[11px] font-medium text-slate-700">
        Nominativo visualizzato
      </p>
      <p className="text-[10px] text-slate-500">
        Compare nei filtri Provvigioni e Report. Non cambia email né password.
      </p>
      <input
        type="text"
        required
        minLength={2}
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
        autoComplete="off"
      />
      {error ? (
        <p className="text-[11px] text-red-700">{error}</p>
      ) : null}
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
    </form>
  );
}
