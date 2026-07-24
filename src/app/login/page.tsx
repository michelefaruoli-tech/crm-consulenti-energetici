import Link from "next/link";
import { Zap } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/80 p-8 shadow-2xl backdrop-blur">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500 p-3 text-white">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">CRM Energia</h1>
            <p className="text-sm text-slate-400">Accesso gestionale consulenti</p>
          </div>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            Credenziali non valide
          </p>
        ) : null}

        <LoginForm />

        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="text-emerald-400 hover:underline">
            Password dimenticata?
          </Link>
        </p>
      </div>
    </div>
  );
}
