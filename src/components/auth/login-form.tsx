"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const emailId = useId();
  const passwordId = useId();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={loginAction} className="space-y-4">
      <div>
        <label htmlFor={emailId} className="mb-1 block text-sm font-medium text-slate-300">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          name="email"
          required
          autoComplete="username"
          placeholder="admin@crm.local"
          className="login-input w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white caret-emerald-400 outline-none ring-emerald-500 placeholder:text-slate-500 focus:ring-2"
        />
      </div>

      <div>
        <label htmlFor={passwordId} className="mb-1 block text-sm font-medium text-slate-300">
          Password
        </label>
        <div className="relative">
          <input
            id={passwordId}
            type={showPassword ? "text" : "password"}
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="login-input w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 pr-11 text-sm text-white caret-emerald-400 outline-none ring-emerald-500 placeholder:text-slate-500 focus:ring-2"
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label={showPassword ? "Nascondi password" : "Mostra password"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button type="submit" className="w-full">
        Accedi
      </Button>
    </form>
  );
}
