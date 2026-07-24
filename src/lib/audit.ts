import { prisma } from "@/lib/prisma";

/** Scrive una riga di storico anagrafica cliente (append-only). */
export async function writeClientHistory(params: {
  clientId: string;
  field: string;
  oldValue: string | null | undefined;
  newValue: string | null | undefined;
  changedBy: string;
}): Promise<void> {
  const oldV = params.oldValue ?? null;
  const newV = params.newValue ?? null;
  if (oldV === newV) return;
  await prisma.clientHistory.create({
    data: {
      clientId: params.clientId,
      field: params.field,
      oldValue: oldV,
      newValue: newV,
      changedBy: params.changedBy,
    },
  });
}

export async function writeClientHistoryBatch(
  clientId: string,
  changedBy: string,
  changes: Array<{ field: string; oldValue: string | null | undefined; newValue: string | null | undefined }>,
): Promise<void> {
  for (const c of changes) {
    await writeClientHistory({
      clientId,
      changedBy,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
    });
  }
}

/** Audit generico su AuditLog. */
export async function writeAuditLog(params: {
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown> | string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      details:
        params.details == null
          ? null
          : typeof params.details === "string"
            ? params.details
            : JSON.stringify(params.details),
    },
  });
}
