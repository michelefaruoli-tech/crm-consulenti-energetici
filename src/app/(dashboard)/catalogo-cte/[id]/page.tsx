import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CteOfferForm } from "@/components/cte/cte-offer-form";
import { requireSession } from "@/lib/auth";
import { mapDbOffer } from "@/lib/cte-ranking";
import { userCanManageCteOffer } from "@/lib/cte-scope";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadUserVisibilityScope } from "@/lib/user-scope";

export const dynamic = "force-dynamic";

export default async function ModificaCtePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "cte.catalog.manage")) {
    redirect("/catalogo-cte");
  }

  const { id } = await params;
  const { saved } = await searchParams;

  const offer = await prisma.cteOffer.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      priceBands: { orderBy: [{ sortOrder: "asc" }, { timeBand: "asc" }] },
    },
  });

  if (!offer || !offer.active) notFound();
  if (!(await userCanManageCteOffer(session, offer.supplierId))) {
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

  const mapped = mapDbOffer(offer);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/catalogo-cte" className="text-sm text-emerald-700 hover:underline">
          ← Catalogo CTE
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Modifica CTE</h1>
        <p className="text-slate-500">{offer.offerName}</p>
        {saved === "1" ? (
          <p className="mt-2 text-sm font-medium text-emerald-700">Modifiche salvate.</p>
        ) : null}
      </div>
      <CteOfferForm
        suppliers={suppliers}
        mode="edit"
        initial={{
          ...mapped,
          pdfFilename: offer.pdfFilename,
        }}
      />
    </div>
  );
}
