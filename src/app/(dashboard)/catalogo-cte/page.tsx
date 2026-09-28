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

function parseNonNegInt(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
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
  const fornitore = params.fornitore?.trim() || null;
  const importato = params.importato?.trim() || null;
  const importLabel = params.label?.trim() || null;
  const importCreated = parseNonNegInt(params.c);
  const importUpdated = parseNonNegInt(params.u);
  const importDeactivated = parseNonNegInt(params.d);

  const visibility = await cteCatalogVisibilityWhere(session);

  const offers = await prisma.cteOffer.findMany({
    where: {
      ...visibility,
      category,
      utility,
      priceKind,
      ...(fornitore
        ? {
            supplier: {
              name: { contains: fornitore, mode: "insensitive" },
            },
          }
        : {}),
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

  const dufercoFlexCount = canManage
    ? await prisma.cteOffer.count({
        where: {
          ...visibility,
          offerName: { startsWith: "FLEX CONDOMINI" },
          validFrom: null,
          validTo: null,
        },
      })
    : 0;

  const showImportBanner =
    Boolean(importato) && importCreated != null && importUpdated != null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Catalogo CTE</h1>
        <p className="text-slate-500">
          Confronto offerte luce e gas, dalla quota energia più bassa alla più alta. Ogni fornitore
          ha un colore fisso. Puoi scaricare un&apos;immagine riassuntiva divisa per categoria.
        </p>
      </div>

      {showImportBanner ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="font-semibold">
            Listino {importLabel ?? importato} aggiornato
          </p>
          <p className="mt-1">
            {importCreated} create, {importUpdated} aggiornate
            {importDeactivated != null && importDeactivated > 0
              ? `, ${importDeactivated} obsolete disattivate`
              : ""}
            . Qui sotto:{" "}
            {category === "RESIDENZIALE"
              ? "Residenziale"
              : category === "BUSINESS"
                ? "Business"
                : "Condomini"}{" "}
            · {utility === "LUCE" ? "Luce" : "Gas"} ·{" "}
            {priceKind === "FISSO" ? "Fissi" : "Variabili"}
            {fornitore ? ` · fornitore «${fornitore}»` : ""}.
            {importato === "sev-iren" ? (
              <>
                {" "}
                Le CTE SEV sono sotto fornitore <strong>Iren</strong> (non «Serviren»). Per SUMMER e
                altre variabili cambia Tipologia → Variabili.
              </>
            ) : null}
            {importato === "iren" ? (
              <>
                {" "}
                Tovaglietta Iren-6 (non SEV). Per business (Tua Azienda) cambia Segmento; per
                variabili (10 PER DUE/TRE, …) Tipologia → Variabili.
              </>
            ) : null}
            {importato === "duferco-fix-family" ? (
              <>
                {" "}
                Fix Family residenziali (Sempre Zero XS/S/M, CUN 1/2). Flex Condomini resta listino
                separato.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {fornitore && !showImportBanner ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-950">
          Filtro fornitore: <strong>{fornitore}</strong>
          {" · "}
          <a href="/catalogo-cte" className="underline">
            togli filtro
          </a>
        </p>
      ) : null}

      {canManage && dufercoFlexCount < 18 ? (
        <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="font-semibold">P0.1 — Duferco Flex Condomini non completo</p>
          <p className="mt-1">
            In catalogo risultano {dufercoFlexCount}/18 offerte FLEX CONDOMINI senza scadenza.
            Un click su{" "}
            <a href="/catalogo-cte/nuovo#duferco-flex-condomini" className="font-medium underline">
              Nuova CTE → Aggiorna Duferco
            </a>{" "}
            (upsert idempotente). Non viene eseguito in automatico al deploy.
          </p>
        </div>
      ) : null}

      {canManage && dufercoFlexCount >= 18 ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
          Duferco Flex Condomini: {dufercoFlexCount} offerte senza scadenza presenti (seed P0.1 ok).
        </p>
      ) : null}

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
            fornitore: fornitore ?? "",
          }}
          rankingActive={rankingActive}
          showGasNoRankBanner={showGasNoRankBanner}
        />
      </Suspense>
    </div>
  );
}
