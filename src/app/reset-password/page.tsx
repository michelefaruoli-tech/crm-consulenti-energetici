"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { resetPasswordWithTokenAction } from "@/lib/master-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setMessage(null);
        const fd = new FormData(e.currentTarget);
        fd.set("token", token);
        start(async () => {
          const res = await resetPasswordWithTokenAction(fd);
          if (!res.ok) setError(res.error ?? "Errore");
          else setMessage(res.message ?? "OK");
        });
      }}
    >
      <input type="hidden" name="token" value={token} />
      <Field label="Nuova password">
        <Input name="newPassword" type="password" required minLength={8} />
      </Field>
      <Field label="Conferma password">
        <Input name="confirmPassword" type="password" required minLength={8} />
      </Field>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? (
        <p className="text-sm text-emerald-800">
          {message}{" "}
          <Link href="/login" className="underline">
            Accedi
          </Link>
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !token} className="w-full">
        Reimposta password
      </Button>
      {!token ? (
        <p className="text-sm text-red-700">Link non valido: manca il token.</p>
      ) : null}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Reimposta password</h1>
        <p className="mt-1 text-sm text-slate-500">Scegli una nuova password sicura.</p>
        <Suspense fallback={<p className="mt-4 text-sm">Caricamento…</p>}>
          <ResetForm />
        </Suspense>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-emerald-700 underline">
            Torna al login
          </Link>
        </p>
      </div>
    </div>
  );
}
