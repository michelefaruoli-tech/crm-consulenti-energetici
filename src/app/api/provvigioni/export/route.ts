import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientDisplayName } from "@/lib/utils";
import { CONTRACT_STATUS_LABELS } from "@/lib/constants";
import { buildProvvigioniContractWhere, provvigioniCompetenceWhere } from "@/lib/provvigioni-filters";
import { formatMonthYear } from "@/lib/date-parse";
import { addMonths, periodLabel, toPeriod } from "@/lib/recurring";
import {
  parseProvvigioniVista,
  vistaToRecurrenceMode,
} from "@/lib/provvigioni-competence";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "reports.export")) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const url = new URL(request.url);
  const collab = url.searchParams.get("collab");
  const settledPeriod = url.searchParams.get("settled")?.trim() || "";
  const supplier = url.searchParams.get("supplier");
  const stato = url.searchParams.get("stato");
  const tipologia = url.searchParams.get("tipologia");
  const q = url.searchParams.get("q");
  const vistaRaw = url.searchParams.get("vista");
  const focusRaw = url.searchParams.get("focus");
  const focus =
    focusRaw === "da-confermare" || focusRaw === "ricorrenze-mancanti"
      ? focusRaw
      : undefined;
  const vista = parseProvvigioniVista(vistaRaw);
  const recurrenceMode = vistaToRecurrenceMode(vista);
  const canViewAll = hasPermission(session.role, "commissions.view_all");
  const competenceRaw = url.searchParams.get("competence")?.trim() || "";
  const competenceAll = competenceRaw === "tutti";
  const competencePeriod =
    competenceRaw &&
    competenceRaw !== "tutti" &&
    /^\d{4}-\d{2}$/.test(competenceRaw)
      ? competenceRaw
      : undefined;
  const settled =
    settledPeriod && /^\d{4}-\d{2}$/.test(settledPeriod)
      ? settledPeriod
      : toPeriod(new Date());
  const showCompetencePanel = vista === "mensile" || vista === "annuale";
  const effectiveCompetence = competenceAll
    ? undefined
    : (competencePeriod ??
      (showCompetencePanel ? addMonths(settled, -1) : undefined));
  const applyCompetenceToList = Boolean(effectiveCompetence);

  const baseContractWhere = buildProvvigioniContractWhere({
    canViewAll,
    sessionUserId: session.id,
    collab,
    supplier,
    stato,
    tipologia,
    q,
    recurrenceMode,
    competencePeriod: effectiveCompetence,
  });
  const contractWhere: Prisma.ContractWhereInput =
    focus === "da-confermare"
      ? { AND: [baseContractWhere, { commissionConfirmed: false }] }
      : focus === "ricorrenze-mancanti"
        ? {
            AND: [
              baseContractWhere,
              {
                recurringMonths: {
                  some: {
                    status: "MISSING",
                    period: { lt: toPeriod(new Date()) },
                  },
                },
              },
            ],
          }
        : applyCompetenceToList
          ? {
              AND: [
                baseContractWhere,
                provvigioniCompetenceWhere(effectiveCompetence!, stato),
              ],
            }
          : baseContractWhere;

  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    select: {
      contractNumber: true,
      status: true,
      podPdr: true,
      recurrence: true,
      collectionDate: true,
      commissionConfirmed: true,
      insertionDate: true,
      notes: true,
      client: {
        select: {
          type: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
      },
      supplier: { select: { name: true } },
      collaborator: { select: { name: true } },
      commission: {
        select: { expected: true, received: true, paid: true },
      },
    },
    orderBy: [{ insertionDate: "desc" }, { createdAt: "desc" }],
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CRM Consulenti Energetici";

  const sheet = workbook.addWorksheet("Provvigioni");
  sheet.columns = [
    { header: "N. contratto", key: "number", width: 16 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "POD/PDR", key: "pod", width: 20 },
    { header: "Collaboratore", key: "collaborator", width: 20 },
    { header: "Fornitore", key: "supplier", width: 18 },
    { header: "Stato", key: "status", width: 22 },
    { header: "Ricorrenza", key: "recurrence", width: 14 },
    { header: "Gettone previsto", key: "expected", width: 14 },
    { header: "Ricevuto", key: "received", width: 12 },
    { header: "Liquidato", key: "paid", width: 12 },
    { header: "Pagato", key: "pagato", width: 10 },
    { header: "Data incasso", key: "collection", width: 14 },
    { header: "Gettone conf.", key: "confirmed", width: 12 },
    { header: "Note", key: "notes", width: 40 },
    { header: "Inserimento", key: "insertion", width: 12 },
  ];

  for (const c of contracts) {
    sheet.addRow({
      number: c.contractNumber,
      client: clientDisplayName(c.client),
      pod: c.podPdr ?? "",
      collaborator: c.collaborator.name,
      supplier: c.supplier.name,
      status: CONTRACT_STATUS_LABELS[c.status] ?? c.status,
      recurrence: c.recurrence || "Una tantum",
      expected: Number(c.commission?.expected ?? 0),
      received: Number(c.commission?.received ?? 0),
      paid: Number(c.commission?.paid ?? 0),
      pagato: c.collectionDate ? "Sì" : "No",
      collection: c.collectionDate ? formatMonthYear(c.collectionDate) : "",
      confirmed: c.commissionConfirmed ? "Sì" : "No",
      notes: c.notes ?? "",
      insertion: c.insertionDate.toISOString().slice(0, 10),
    });
  }

  // Foglio rendiconto: mese scelto = competenza OPPURE mese bonifico
  // (prima solo settledPeriod → se scaricavi luglio ma le rate erano settled=giugno, foglio vuoto)
  const monthKey =
    settledPeriod && /^\d{4}-\d{2}$/.test(settledPeriod) ? settledPeriod : "";
  const rendicontoWhere = {
    status: "PAID" as const,
    ...(monthKey
      ? { OR: [{ settledPeriod: monthKey }, { period: monthKey }] }
      : {}),
    contract: contractWhere,
  };

  const paidMonths = await prisma.recurringMonth.findMany({
    where: rendicontoWhere,
    include: {
      contract: {
        select: {
          contractNumber: true,
          podPdr: true,
          collaborator: { select: { name: true } },
          client: {
            select: {
              type: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: [{ settledPeriod: "desc" }, { period: "asc" }],
    take: 5000,
  });

  const sheet2 = workbook.addWorksheet(
    monthKey ? `Rendiconto ${monthKey}` : "Ricorrenze pagate",
  );
  sheet2.columns = [
    { header: "Competenza", key: "competence", width: 14 },
    { header: "Rendiconto (bonifico)", key: "settled", width: 18 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "POD/PDR", key: "pod", width: 18 },
    { header: "Collaboratore", key: "collaborator", width: 18 },
    { header: "Fornitore", key: "supplier", width: 16 },
    { header: "Importo", key: "amount", width: 12 },
    { header: "Pagato il", key: "paidAt", width: 14 },
    { header: "N. contratto", key: "number", width: 16 },
  ];

  if (paidMonths.length === 0) {
    sheet2.addRow({
      competence: monthKey
        ? `Nessuna rate PAID con competenza o bonifico ${monthKey}`
        : "Nessuna rate PAID",
      settled: "",
      client: "Prova il mese di competenza (es. 2026-06 per giugno Helios)",
      pod: "",
      collaborator: "",
      supplier: "",
      amount: "",
      paidAt: "",
      number: "",
    });
  }

  for (const m of paidMonths) {
    sheet2.addRow({
      competence: periodLabel(m.period),
      settled: m.settledPeriod ? periodLabel(m.settledPeriod) : "",
      client: clientDisplayName(m.contract.client),
      pod: m.contract.podPdr ?? "",
      collaborator: m.contract.collaborator.name,
      supplier: m.contract.supplier.name,
      amount: Number(m.amount ?? 0),
      paidAt: m.paidAt ? m.paidAt.toISOString().slice(0, 10) : "",
      number: m.contract.contractNumber,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = collab ? `-collab` : "";
  const settledSuffix = settledPeriod ? `-rend-${settledPeriod}` : "";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="provvigioni${suffix}${settledSuffix}-${Date.now()}.xlsx"`,
    },
  });
}
