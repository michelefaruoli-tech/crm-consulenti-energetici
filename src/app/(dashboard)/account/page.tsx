import { requireSession } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { prisma } from "@/lib/prisma";
import { formatRomeDateTime } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, name: true, passwordChangedAt: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sicurezza account</h1>
        <p className="text-slate-500">
          {user?.name} · {user?.email}
        </p>
        {user?.passwordChangedAt ? (
          <p className="mt-1 text-xs text-slate-500">
            Ultimo cambio password: {formatRomeDateTime(user.passwordChangedAt)}
          </p>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">Cambia password</h2>
        <p className="mb-4 text-sm text-slate-500">
          La password non viene mai mostrata. Usa almeno 8 caratteri (consigliati
          maiuscole, numeri e simboli).
        </p>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
