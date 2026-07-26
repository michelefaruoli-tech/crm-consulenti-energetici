"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { requestPasswordResetAction } from "@/lib/master-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export default function ForgotPasswordPage() {
  const honeypotId = useId();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Password dimenticata</h1>
        <p className="mt-1 text-sm text-slate-500">
          Inserisci la tua email: se risulta registrata riceverai un link sicuro a
          scadenza (1 ora).
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const res = await requestPasswordResetAction(fd);
              setIsError(!res.ok);
              setMessage(res.message);
            });
          }}
        >
          <div
            aria-hidden="true"
            className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"
          >
            <label htmlFor={honeypotId}>Sito web</label>
            <input
              id={honeypotId}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            Invia link di reset
          </Button>
        </form>
        {message ? (
          <p
            className={`mt-4 text-sm ${isError ? "text-rose-700" : "text-emerald-800"}`}
          >
            {message}
          </p>
        ) : null}
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-emerald-700 underline">
            Torna al login
          </Link>
          {" · "}
          <Link href="/privacy" className="text-slate-500 underline">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  );
}
