"use client";

import { useMemo, useState, useTransition } from "react";
import { changeOwnPasswordAction } from "@/lib/master-actions";
import { passwordPolicyHints } from "@/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

function strength(pw: string): { label: string; className: string; bars: number } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2)
    return { label: "Debole", className: "text-red-600", bars: 1 };
  if (score <= 3)
    return { label: "Media", className: "text-amber-600", bars: 2 };
  return { label: "Forte", className: "text-emerald-700", bars: 3 };
}

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const hints = useMemo(() => passwordPolicyHints(), []);
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
        <Input
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
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
      <ul className="list-inside list-disc text-xs text-slate-500">
        {hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      {newPw ? (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`h-1.5 flex-1 rounded ${
                  n <= s.bars
                    ? s.bars === 1
                      ? "bg-red-500"
                      : s.bars === 2
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          <p className={`text-xs ${s.className}`}>Robustezza: {s.label}</p>
        </div>
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
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        Aggiorna password
      </Button>
    </form>
  );
}
