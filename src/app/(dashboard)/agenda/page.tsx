import { AgendaApp } from "@/components/agenda/agenda-app";
import { requireSession } from "@/lib/auth";
import {
  listAgendaGenericNotesAction,
  listAgendaItemsAction,
} from "@/lib/agenda-actions";
import { romeDateString } from "@/lib/timezone";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const session = await requireSession();
  const today = romeDateString();
  const monthStart = startOfMonth(new Date(`${today}T12:00:00`));
  const from = format(startOfWeek(monthStart, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const to = format(endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const [monthRes, notesRes] = await Promise.all([
    listAgendaItemsAction({ from, to }),
    listAgendaGenericNotesAction("aperte"),
  ]);

  const initialItems = monthRes.ok ? monthRes.items : [];
  const initialNotes = notesRes.ok ? notesRes.notes : [];

  return (
    <AgendaApp
      initialItems={initialItems}
      initialNotes={initialNotes}
      userName={session.name}
    />
  );
}
