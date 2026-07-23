import { loginAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Zap } from "lucide-react";

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

        <form action={loginAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Email</label>
            <Input type="email" name="email" required placeholder="admin@crm.local" className="bg-slate-900 text-white border-slate-700" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Password</label>
            <Input type="password" name="password" required placeholder="••••••••" className="bg-slate-900 text-white border-slate-700" />
          </div>
          <Button type="submit" className="w-full">
            Accedi
          </Button>
        </form>

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
          <p className="font-medium text-slate-300">Account demo:</p>
          <p className="mt-2">admin@crm.local / Admin123!</p>
        </div>
      </div>
    </div>
  );
}
