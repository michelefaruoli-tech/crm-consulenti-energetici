import { AgendaApp } from "@/components/agenda/agenda-app";
import { requireSession } from "@/lib/auth";
import {
  listAgendaItemsAction,
  listPendingTasksAction,
} from "@/lib/agenda-actions";
import { romeDateString } from "@/lib/timezone";
import { addDays, format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const session = await requireSession();
  const today = romeDateString();
  const weekEnd = format(addDays(new Date(`${today}T12:00:00`), 6), "yyyy-MM-dd");

  const [weekRes, tasksRes] = await Promise.all([
    listAgendaItemsAction({ from: today, to: weekEnd }),
    listPendingTasksAction(),
  ]);

  const initialItems = weekRes.ok ? weekRes.items : [];
  const initialTasks = tasksRes.ok ? tasksRes.items : [];

  return (
    <AgendaApp
      initialItems={initialItems}
      initialTasks={initialTasks}
      userName={session.name}
    />
  );
}
