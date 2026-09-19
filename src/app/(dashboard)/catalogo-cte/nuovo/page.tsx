import Link from "next/link";
import { redirect } from "next/navigation";
import { CteDolomitiImportButton } from "@/components/cte/cte-dolomiti-import-button";
import { CteOfferForm } from "@/components/cte/cte-offer-form";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadUserVisibilityScope } from "@/lib/user-scope";

export const dynamic = "force-dynamic";

export default async function NuovaCtePage() {
  const session = await requireSession();
  if (!hasPermission(session.role, "cte.catalog.manage")) {
    redirect("/catalogo-cte");
  }

  const scope = await loadUserVisibilityScope(session);
  const supplierWhere =
    scope.kind === "scoped" && scope.supplierIds.length > 0
      ? { id: { in: scope.supplierIds }, active: true }
      : scope.kind === "scoped"
        ? { id: "__none__" }
        : { active: true };

  const suppliers = await prisma.supplier.findMany({
    where: supplierWhere,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/catalogo-cte" className="text-sm text-emerald-700 hover:underline">
          ← Catalogo CTE
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Nuova offerta CTE</h1>
        <p className="text-slate-500">
          Seleziona PDF CTE o screenshot di listino (PNG/JPG). Da una tabella Dolomiti si creano più
          offerte in coda: controlli, salvi, poi la successiva. I numeri non letti restano vuoti. Max
          3 MB a file, fino a 15 file.
        </p>
      </div>
      <CteDolomitiImportButton />
      <CteOfferForm suppliers={suppliers} mode="create" />
    </div>
  );
}
