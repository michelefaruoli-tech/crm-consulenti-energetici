import Link from "next/link";
import { redirect } from "next/navigation";
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
          Inserimento manuale. PDF allegato opzionale (max 3 MB); conserva i file sul PC finché non
          carichi.
        </p>
      </div>
      <CteOfferForm suppliers={suppliers} mode="create" />
    </div>
  );
}
