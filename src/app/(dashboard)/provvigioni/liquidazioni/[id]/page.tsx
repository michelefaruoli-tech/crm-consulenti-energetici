import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { contractVisibilityWhere } from "@/lib/user-scope";
import { decimalToNumber } from "@/lib/commission";
import { periodLabel } from "@/lib/recurring";
import { loadPayoutRunTotals } from "@/lib/payout/totals";
import { PayoutRunDetail } from "@/components/provvigioni/payout-run-detail";

export default async function LiquidazioneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const canManage = hasPermission(session.role, "commissions.edit_gettone");
  const canRead = canManage || hasPermission(session.role, "commissions.view_all");
  if (!canRead) redirect("/provvigioni");

  const run = await prisma.payoutRun.findUnique({
    where: { id },
    select: {
      id: true,
      period: true,
      label: true,
      status: true,
      markMode: true,
      appliedAt: true,
      liquidatedAt: true,
      closedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      batches: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          filename: true,
          status: true,
          totalRows: true,
          matchedRows: true,
          ambiguousRows: true,
          unmatchedRows: true,
          appliedRows: true,
          computedTotal: true,
          declaredTotal: true,
          createdAt: true,
          source: { select: { name: true } },
          uploadedBy: { select: { name: true } },
        },
      },
      reportRuns: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          reason: true,
          createdAt: true,
          createdBy: { select: { name: true } },
          items: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              collaboratorId: true,
              netTotal: true,
              importedTotal: true,
              adjustmentsTotal: true,
              rowCount: true,
              delivery: true,
              sentAt: true,
              lastError: true,
              snapshotJson: true,
              collaborator: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!run) notFound();

  // La visibilità segue i contratti: un Area Manager vede solo il proprio team
  const visibility = canManage
    ? undefined
    : await contractVisibilityWhere(session);

  const [totals, pendingRows, adjustments] = await Promise.all([
    loadPayoutRunTotals(run.id, visibility),
    prisma.payoutRow.findMany({
      where: {
        batch: { runId: run.id, status: { not: "REVERTED" } },
        matchStatus: { in: ["AMBIGUOUS", "UNMATCHED", "ERROR"] },
        ...(visibility && Object.keys(visibility).length > 0
          ? { contract: visibility }
          : {}),
      },
      orderBy: [{ matchStatus: "asc" }, { id: "asc" }],
      take: 200,
      select: {
        id: true,
        sheetName: true,
        rowIndex: true,
        podRaw: true,
        clientNameRaw: true,
        amount: true,
        period: true,
        matchStatus: true,
        matchReason: true,
        note: true,
        candidateIdsJson: true,
      },
    }),
    prisma.payoutAdjustment.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        amount: true,
        note: true,
        createdAt: true,
        voidedAt: true,
        voidReason: true,
        collaboratorId: true,
        collaborator: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
  ]);

  const visibleCollaboratorIds = new Set(totals.map((t) => t.collaboratorId));
  const visibleAdjustments = canManage
    ? adjustments
    : adjustments.filter((a) => visibleCollaboratorIds.has(a.collaboratorId));

  const latestReportRun = run.reportRuns[0] ?? null;
  const lastGeneratedAt = latestReportRun?.createdAt ?? null;
  // Una rettifica successiva all'ultima generazione rende i report obsoleti
  const adjustmentsAfterReport = lastGeneratedAt
    ? visibleAdjustments.filter(
        (a) => !a.voidedAt && a.createdAt > lastGeneratedAt,
      ).length
    : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <Link
          href="/provvigioni/liquidazioni"
          className="text-sm text-emerald-700 hover:underline"
        >
          ← Tutte le liquidazioni
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {run.label}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Periodo {periodLabel(run.period)} · creata da {run.createdBy.name}
        </p>
      </div>

      <PayoutRunDetail
        canManage={canManage}
        run={{
          id: run.id,
          period: run.period,
          label: run.label,
          status: run.status,
          markMode: run.markMode,
          appliedAt: run.appliedAt?.toISOString() ?? null,
          liquidatedAt: run.liquidatedAt?.toISOString() ?? null,
          closedAt: run.closedAt?.toISOString() ?? null,
        }}
        batches={run.batches.map((b) => ({
          id: b.id,
          filename: b.filename,
          sourceName: b.source.name,
          status: b.status,
          totalRows: b.totalRows,
          matchedRows: b.matchedRows,
          ambiguousRows: b.ambiguousRows,
          unmatchedRows: b.unmatchedRows,
          appliedRows: b.appliedRows,
          computedTotal: decimalToNumber(b.computedTotal),
          declaredTotal:
            b.declaredTotal == null ? null : decimalToNumber(b.declaredTotal),
          uploadedBy: b.uploadedBy.name,
          createdAt: b.createdAt.toISOString(),
        }))}
        totals={totals}
        pendingRows={pendingRows.map((r) => ({
          id: r.id,
          sheetName: r.sheetName,
          rowIndex: r.rowIndex,
          podRaw: r.podRaw ?? "",
          clientNameRaw: r.clientNameRaw ?? "",
          amount: r.amount == null ? null : decimalToNumber(r.amount),
          period: r.period,
          matchStatus: r.matchStatus,
          matchReason: r.matchReason,
          note: r.note,
          hasCandidates: Boolean(r.candidateIdsJson),
        }))}
        adjustments={visibleAdjustments.map((a) => ({
          id: a.id,
          kind: a.kind,
          amount: decimalToNumber(a.amount),
          note: a.note,
          collaboratorId: a.collaboratorId,
          collaboratorName: a.collaborator.name,
          authorName: a.createdBy.name,
          createdAt: a.createdAt.toISOString(),
          voidedAt: a.voidedAt?.toISOString() ?? null,
          voidReason: a.voidReason,
        }))}
        reportRuns={run.reportRuns.map((rr) => ({
          id: rr.id,
          version: rr.version,
          status: rr.status,
          reason: rr.reason,
          createdAt: rr.createdAt.toISOString(),
          authorName: rr.createdBy.name,
          items: rr.items.map((item) => ({
            id: item.id,
            collaboratorName: item.collaborator.name,
            importedTotal: decimalToNumber(item.importedTotal),
            adjustmentsTotal: decimalToNumber(item.adjustmentsTotal),
            netTotal: decimalToNumber(item.netTotal),
            rowCount: item.rowCount,
            delivery: item.delivery,
            sentAt: item.sentAt?.toISOString() ?? null,
            lastError: item.lastError,
            ready: item.snapshotJson !== "" && item.snapshotJson !== "{}",
          })),
        }))}
        adjustmentsAfterReport={adjustmentsAfterReport}
      />
    </div>
  );
}
