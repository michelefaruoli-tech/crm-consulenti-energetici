import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { NuovoClienteForm } from "@/components/clients/nuovo-cliente-form";

export default async function NuovoClientePage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "clients.create")) redirect("/clienti");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Nuovo cliente</h1>
        <p className="text-slate-500">
          Anagrafica con CAP automatico (residenza o sede legale — senza indirizzo fornitura)
        </p>
      </div>

      <NuovoClienteForm />
    </div>
  );
}
