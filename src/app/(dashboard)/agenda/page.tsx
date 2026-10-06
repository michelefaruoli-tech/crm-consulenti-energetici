import { AgendaApp } from "@/components/agenda/agenda-app";
import { requireSession } from "@/lib/auth";
import {
  getAgendaGenericNoteAction,
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

  const [monthRes, noteRes] = await Promise.all([
    listAgendaItemsAction({ from, to }),
    getAgendaGenericNoteAction(),
  ]);

  const initialItems = monthRes.ok ? monthRes.items : [];
  const initialNoteText = noteRes.ok ? noteRes.note.text : "";

  return (
    <AgendaApp
      initialItems={initialItems}
      initialNoteText={initialNoteText}
      userName={session.name}
    />
  );
}
