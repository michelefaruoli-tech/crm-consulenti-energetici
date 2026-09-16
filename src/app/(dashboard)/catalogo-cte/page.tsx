import { Suspense } from "react";
import { redirect } from "next/navigation";
import type {
  CteCategory,
  CtePriceKind,
  CteUtility,
} from "@/generated/prisma/client";
import { CteCatalogClient } from "@/components/cte/cte-catalog-client";
import { requireSession } from "@/lib/auth";
import { cteCatalogVisibilityWhere } from "@/lib/cte-scope";
import { mapDbOffer, rankCteOffers, shouldRankCatalog } from "@/lib/cte-ranking";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseCategory(v: string | undefined): CteCategory {
  if (v === "BUSINESS" || v === "CONDOMINI") return v;
  return "RESIDENZIALE";
}

function parseUtility(v: string | undefined): CteUtility {
  return v === "GAS" ? "GAS" : "LUCE";
}

function parsePriceKind(v: string | undefined): CtePriceKind {
  return v === "VARIABILE" ? "VARIABILE" : "FISSO";
}

function parseOptionalNumber(v: string | undefined): number | null {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function CatalogoCtePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  if (!hasPermission(session.role, "cte.catalog.view")) {
    redirect("/login");
  }

  const params = await searchParams;
  const category = parseCategory(params.categoria);
  const utility = parseUtility(params.utility);
  const priceKind = parsePriceKind(params.prezzo);
  const monthlyConsumption = parseOptionalNumber(params.consumo);
  const powerKw = parseOptionalNumber(params.potenza);
  const validFrom = params.validFrom?.trim() || null;
  const validTo = params.validTo?.trim() || null;

  const visibility = await cteCatalogVisibilityWhere(session);

  const offers = await prisma.cteOffer.findMany({
    where: {
      ...visibility,
      category,
      utility,
      priceKind,
      ...(validFrom
        ? {
            OR: [{ validFrom: null }, { validFrom: { lte: new Date(validFrom) } }],
          }
        : {}),
      ...(validTo
        ? {
            OR: [{ validTo: null }, { validTo: { gte: new Date(validTo) } }],
          }
        : {}),
    },
    include: {
      supplier: { select: { name: true } },
      priceBands: { orderBy: [{ sortOrder: "asc" }, { timeBand: "asc" }] },
    },
    orderBy: [{ offerName: "asc" }],
  });

  const filters = {
    category,
    utility,
    priceKind,
    monthlyConsumption,
    powerKw,
    validFrom,
    validTo,
  };

  const rows = rankCteOffers(
    offers.map((o) => mapDbOffer(o)),
    filters,
  );

  const rankingActive = shouldRankCatalog(filters);
  const showGasNoRankBanner =
    utility === "GAS" && (monthlyConsumption == null || monthlyConsumption <= 0);
  const canManage = hasPermission(session.role, "cte.catalog.manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Catalogo CTE</h1>
        <p className="text-slate-500">
          Confronto offerte luce e gas — inserimento manuale. Ranking automatico per consumo
          (luce sempre; gas solo con Smc/mese inseriti).
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Caricamento filtri…</p>}>
        <CteCatalogClient
          rows={rows}
          canManage={canManage}
          filters={{
            category,
            utility,
            priceKind,
            monthlyConsumption: monthlyConsumption?.toString() ?? "",
            powerKw: powerKw?.toString() ?? "",
            validFrom: validFrom ?? "",
            validTo: validTo ?? "",
          }}
          rankingActive={rankingActive}
          showGasNoRankBanner={showGasNoRankBanner}
        />
      </Suspense>
    </div>
  );
}
