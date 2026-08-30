"use server";

import { revalidatePath } from "next/cache";
import type { AgendaItemType, AgendaPriority } from "@/generated/prisma/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fromZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/timezone";

export type AgendaItemDto = {
  id: string;
  title: string;
  notes: string | null;
  type: AgendaItemType;
  priority: AgendaPriority;
  scheduledAt: string;
  allDay: boolean;
  completed: boolean;
  alertAt: string | null;
  userId: string;
  clientId: string | null;
  clientName: string | null;
};

function clean(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function parseRomeDateTime(dateYmd: string, timeHm?: string | null): Date {
  const time = timeHm && /^\d{2}:\d{2}$/.test(timeHm) ? timeHm : "09:00";
  return fromZonedTime(`${dateYmd}T${time}:00`, APP_TZ);
}

function toDto(
  item: {
    id: string;
    title: string;
    notes: string | null;
    type: AgendaItemType;
    priority: AgendaPriority;
    scheduledAt: Date;
    allDay: boolean;
    completed: boolean;
    alertAt: Date | null;
    userId: string;
    clientId: string | null;
    client: {
      firstName: string | null;
      lastName: string | null;
      companyName: string | null;
    } | null;
  },
): AgendaItemDto {
  const clientName = item.client
    ? item.client.companyName?.trim() ||
      [item.client.firstName, item.client.lastName].filter(Boolean).join(" ").trim() ||
      null
    : null;

  return {
    id: item.id,
    title: item.title,
    notes: item.notes,
    type: item.type,
    priority: item.priority,
    scheduledAt: item.scheduledAt.toISOString(),
    allDay: item.allDay,
    completed: item.completed,
    alertAt: item.alertAt?.toISOString() ?? null,
    userId: item.userId,
    clientId: item.clientId,
    clientName,
  };
}

const itemInclude = {
  client: {
    select: { firstName: true, lastName: true, companyName: true },
  },
} as const;

export async function listAgendaItemsAction(args: {
  from: string;
  to: string;
}): Promise<{ ok: true; items: AgendaItemDto[] } | { ok: false; error: string }> {
  try {
    const session = await requireSession();

    const from = fromZonedTime(`${args.from}T00:00:00`, APP_TZ);
    const to = fromZonedTime(`${args.to}T23:59:59.999`, APP_TZ);

    const items = await prisma.agendaItem.findMany({
      where: {
        userId: session.id,
        scheduledAt: { gte: from, lte: to },
      },
      include: itemInclude,
      orderBy: [{ scheduledAt: "asc" }, { priority: "desc" }],
    });

    return { ok: true, items: items.map(toDto) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Caricamento non riuscito",
    };
  }
}

export async function listPendingTasksAction(): Promise<
  { ok: true; items: AgendaItemDto[] } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();

    const items = await prisma.agendaItem.findMany({
      where: {
        userId: session.id,
        type: "TASK",
        completed: false,
      },
      include: itemInclude,
      orderBy: [{ scheduledAt: "asc" }, { priority: "desc" }],
      take: 200,
    });

    return { ok: true, items: items.map(toDto) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Caricamento non riuscito",
    };
  }
}

export async function createAgendaItemAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const title = clean(formData.get("title"));
    if (!title) return { ok: false, error: "Titolo obbligatorio" };

    const type = (clean(formData.get("type")) ?? "TASK") as AgendaItemType;
    const priority = (clean(formData.get("priority")) ?? "MEDIUM") as AgendaPriority;
    const dateYmd = clean(formData.get("date"));
    if (!dateYmd) return { ok: false, error: "Data obbligatoria" };

    const allDay = formData.get("allDay") === "on" || formData.get("allDay") === "true";
    const timeHm = allDay ? null : clean(formData.get("time"));
    const scheduledAt = parseRomeDateTime(dateYmd, timeHm);

    let alertAt: Date | null = null;
    const alertDate = clean(formData.get("alertDate"));
    const alertTime = clean(formData.get("alertTime"));
    if (alertDate) {
      alertAt = parseRomeDateTime(alertDate, alertTime ?? "09:00");
    }

    const clientId = clean(formData.get("clientId"));

    const item = await prisma.agendaItem.create({
      data: {
        title,
        notes: clean(formData.get("notes")),
        type,
        priority,
        scheduledAt,
        allDay,
        alertAt,
        userId: session.id,
        clientId,
      },
    });

    revalidatePath("/agenda");
    return { ok: true, id: item.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Salvataggio non riuscito",
    };
  }
}

export async function updateAgendaItemAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const id = clean(formData.get("id"));
    if (!id) return { ok: false, error: "Elemento non trovato" };

    const existing = await prisma.agendaItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== session.id) {
      return { ok: false, error: "Elemento non trovato" };
    }

    const title = clean(formData.get("title"));
    if (!title) return { ok: false, error: "Titolo obbligatorio" };

    const type = (clean(formData.get("type")) ?? existing.type) as AgendaItemType;
    const priority = (clean(formData.get("priority")) ?? existing.priority) as AgendaPriority;
    const dateYmd = clean(formData.get("date"));
    if (!dateYmd) return { ok: false, error: "Data obbligatoria" };

    const allDay = formData.get("allDay") === "on" || formData.get("allDay") === "true";
    const timeHm = allDay ? null : clean(formData.get("time"));
    const scheduledAt = parseRomeDateTime(dateYmd, timeHm);

    let alertAt: Date | null = null;
    const alertDate = clean(formData.get("alertDate"));
    const alertTime = clean(formData.get("alertTime"));
    if (alertDate) {
      alertAt = parseRomeDateTime(alertDate, alertTime ?? "09:00");
    }

    await prisma.agendaItem.update({
      where: { id },
      data: {
        title,
        notes: clean(formData.get("notes")),
        type,
        priority,
        scheduledAt,
        allDay,
        alertAt,
        clientId: clean(formData.get("clientId")),
      },
    });

    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Aggiornamento non riuscito",
    };
  }
}

export async function toggleAgendaCompleteAction(
  id: string,
  completed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const existing = await prisma.agendaItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== session.id) {
      return { ok: false, error: "Elemento non trovato" };
    }

    await prisma.agendaItem.update({
      where: { id },
      data: { completed },
    });

    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Operazione non riuscita",
    };
  }
}

export async function deleteAgendaItemAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const existing = await prisma.agendaItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== session.id) {
      return { ok: false, error: "Elemento non trovato" };
    }

    await prisma.agendaItem.delete({ where: { id } });
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Eliminazione non riuscita",
    };
  }
}
