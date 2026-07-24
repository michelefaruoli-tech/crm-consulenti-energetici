"use client";

import { useState, useTransition } from "react";
import { changeOwnPasswordAction } from "@/lib/master-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

function strength(pw: string): { label: string; className: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { label: "Debole", className: "text-red-600" };
  if (score <= 3) return { label: "Media", className: "text-amber-600" };
  return { label: "Forte", className: "text-emerald-700" };
}

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  const s = strength(newPw);

  return (
    <form
      className="grid max-w-lg gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await changeOwnPasswordAction(fd);
          if (!res.ok) setError(res.error ?? "Errore");
          else {
            setMessage(res.message ?? "OK");
            e.currentTarget.reset();
            setNewPw("");
          }
        });
      }}
    >
      <Field label="Password attuale">
        <Input name="currentPassword" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="Nuova password">
        <Input
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
        />
      </Field>
      {newPw ? (
        <p className={`text-xs ${s.className}`}>Robustezza: {s.label}</p>
      ) : null}
      <Field label="Conferma nuova password">
        <Input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-700">{message}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Aggiorna password
      </Button>
    </form>
  );
}
