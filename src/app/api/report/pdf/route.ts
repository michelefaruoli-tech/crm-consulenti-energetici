import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  loadReportRecurringPaid,
} from "@/lib/report-recurring";
import { loadReportStornos } from "@/lib/report-stornos";
import {
  buildRendiconto,
  rendicontoCollectedHeading,
} from "@/lib/report-rendiconto";
import { buildRendicontoPdfBytes } from "@/lib/rendiconto-pdf";
import {
  parseReportExtras,
  sumReportExtras,
} from "@/lib/report-extras";
import {
  buildReportContractWhere,
  formatMonthsLabel,
  reportHasStato,
  reportIncludesRecurring,
  reportIncludesStornos,
  reportPeriodUsesCollectionDate,
  reportRecurringCompetenceOnly,
  resolveReportPeriod,
  resolveIncassatoMonths,
  resolveReportStati,
  resolveReportStato,
} from "@/lib/report-filters";

export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (!session || !hasPermission(session.role, "reports.export")) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const month = sp.get("month");
  const collaboratorId = sp.get("collaboratorId");
  const supplierId = sp.get("supplierId");
  const stato = resolveReportStato(sp.get("stato"));
  const stati = resolveReportStati(sp.get("stato"));

  const { contractVisibilityWhere } = await import("@/lib/user-scope");
  const visibility = await contractVisibilityWhere(session);

  const contracts = await prisma.contract.findMany({
    where: buildReportContractWhere(
      { from, to, month, collaboratorId, supplierId, stato },
      visibility,
    ),
    include: {
      client: true,
      supplier: true,
      collaborator: { select: { name: true } },
      commission: true,
    },
    orderBy: reportPeriodUsesCollectionDate(stato)
      ? { collectionDate: "desc" }
      : { insertionDate: "desc" },
  });

  const includeStornos = reportIncludesStornos(stati);
  const includeRecurring = reportIncludesRecurring(stati);
  const onlyStornato =
    stati.length > 0 && stati.every((s) => s === "Stornato");

  const recurringRows = includeRecurring
    ? await loadReportRecurringPaid({
        from,
        to,
        month,
        collaboratorId,
        supplierId,
        visibility,
        competenceOnly: reportRecurringCompetenceOnly(stato),
        stato,
      })
    : [];

  const stornoRows = includeStornos
    ? await loadReportStornos({
        from,
        to,
        month,
        collaboratorId,
        supplierId,
        visibility,
      })
    : [];

  const period = resolveReportPeriod({ from, to, month });
  const periodLabelText =
    period.months.length > 0
      ? formatMonthsLabel(period.months)
      : `${period.from} - ${period.to}`;
  const incassatoMonths = resolveIncassatoMonths(period);

  const rendiconto = buildRendiconto({
    contracts: onlyStornato ? [] : contracts,
    stornoRows,
    recurringRows: includeRecurring && !onlyStornato ? recurringRows : [],
    skipRecurring: !includeRecurring || onlyStornato,
    onlyStornato,
    inlineRecurring: reportHasStato(stati, "Da incassare"),
    incassatoMonths,
  });

  const extras = parseReportExtras((k) => sp.get(k));
  const extrasSum = sumReportExtras(extras);
  const grandNetto = rendiconto.totNetto + extrasSum;

  const pdf = buildRendicontoPdfBytes({
    periodLabel: periodLabelText,
    statoLabel: stato,
    generatedAtLabel: new Date().toLocaleString("it-IT"),
    rendiconto,
    extras,
    grandNetto,
    includeRecurring,
    includeStornos,
    collectedHeading: rendicontoCollectedHeading(stati),
  });
  const safePeriod =
    periodLabelText.replace(/[^\wàèéìòù+\-\s]/gi, "").slice(0, 40).trim() ||
    "periodo";

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rendiconto-${safePeriod.replace(/\s+/g, "-")}-${Date.now()}.pdf"`,
    },
  });
}
