"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { it } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  createAgendaGenericNoteAction,
  createAgendaItemAction,
  deleteAgendaGenericNoteAction,
  deleteAgendaItemAction,
  listAgendaGenericNotesAction,
  listAgendaItemsAction,
  setAgendaGenericNoteStatusAction,
  toggleAgendaCompleteAction,
  updateAgendaGenericNoteAction,
  updateAgendaItemAction,
  type AgendaGenericNoteDto,
  type AgendaGenericNoteFilter,
  type AgendaItemDto,
} from "@/lib/agenda-actions";
import { APP_TZ, romeDateString } from "@/lib/timezone";

type ViewMode = "month" | "week" | "day" | "notes";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] as const;

const DOT_COLORS = {
  APPOINTMENT: {
    LOW: "bg-sky-500",
    MEDIUM: "bg-emerald-500",
    HIGH: "bg-rose-500",
  },
  TASK: {
    LOW: "bg-slate-400",
    MEDIUM: "bg-amber-500",
    HIGH: "bg-orange-500",
  },
} as const;

function toRomeDate(iso: string): string {
  return formatInTimeZone(iso, APP_TZ, "yyyy-MM-dd");
}

function toRomeTime(iso: string): string {
  return formatInTimeZone(iso, APP_TZ, "HH:mm");
}

function formatItemWhen(item: AgendaItemDto): string {
  if (!item.scheduledAt) return "Senza data";
  const date = formatInTimeZone(item.scheduledAt, APP_TZ, "EEE d MMM", { locale: it });
  if (item.allDay) return date;
  return `${date} · ${toRomeTime(item.scheduledAt)}`;
}

function emptyForm(dateYmd: string, noDate = false): FormState {
  return {
    id: null,
    title: "",
    notes: "",
    type: "APPOINTMENT",
    priority: "MEDIUM",
    noDate,
    date: noDate ? "" : dateYmd,
    time: "09:00",
    allDay: false,
    alertDate: "",
    alertTime: "09:00",
    hasAlert: false,
  };
}

type FormState = {
  id: string | null;
  title: string;
  notes: string;
  type: "APPOINTMENT" | "TASK";
  priority: "LOW" | "MEDIUM" | "HIGH";
  noDate: boolean;
  date: string;
  time: string;
  allDay: boolean;
  alertDate: string;
  alertTime: string;
  hasAlert: boolean;
};

function itemToForm(item: AgendaItemDto): FormState {
  const noDate = !item.scheduledAt;
  return {
    id: item.id,
    title: item.title,
    notes: item.notes ?? "",
    type: item.type,
    priority: item.priority,
    noDate,
    date: item.scheduledAt ? toRomeDate(item.scheduledAt) : "",
    time: !item.scheduledAt || item.allDay ? "09:00" : toRomeTime(item.scheduledAt),
    allDay: item.allDay || noDate,
    alertDate: item.alertAt ? toRomeDate(item.alertAt) : "",
    alertTime: item.alertAt ? toRomeTime(item.alertAt) : "09:00",
    hasAlert: Boolean(item.alertAt),
  };
}

function sortItems(a: AgendaItemDto, b: AgendaItemDto): number {
  const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
  const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
  if (aTime !== bTime) return aTime - bTime;
  if (a.priority === "HIGH" && b.priority !== "HIGH") return -1;
  if (b.priority === "HIGH" && a.priority !== "HIGH") return 1;
  return a.title.localeCompare(b.title, "it");
}

function EventChip({
  item,
  compact = false,
  onClick,
}: {
  item: AgendaItemDto;
  compact?: boolean;
  onClick: () => void;
}) {
  const timeLabel =
    item.scheduledAt && !item.allDay ? toRomeTime(item.scheduledAt) : item.allDay ? "Tutto giorno" : "";
  const dot = DOT_COLORS[item.type][item.priority];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-md text-left transition-colors hover:bg-slate-100/80",
        compact ? "px-0.5 py-0.5" : "px-1.5 py-1",
        item.completed && "opacity-50",
      )}
      title={item.title}
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "flex items-baseline gap-1 text-[11px] leading-tight sm:text-xs",
            item.completed && "line-through",
          )}
        >
          {timeLabel ? (
            <span className="shrink-0 font-semibold tabular-nums text-slate-700">{timeLabel}</span>
          ) : null}
          <span className="truncate font-medium text-slate-800">{item.title}</span>
          {item.priority === "HIGH" ? (
            <Star className="inline h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label="Priorità alta" />
          ) : null}
        </span>
      </span>
    </button>
  );
}

const NOTE_FILTERS: { key: AgendaGenericNoteFilter; label: string }[] = [
  { key: "aperte", label: "Da controllare" },
  { key: "risolte", label: "Risolte" },
  { key: "tutte", label: "Tutte" },
];

function noteStatusLabel(status: AgendaGenericNoteDto["status"]): string {
  return status === "RISOLTA" ? "Risolta" : "Da controllare";
}

export function AgendaApp({
  initialItems,
  initialNotes,
  userName,
}: {
  initialItems: AgendaItemDto[];
  initialNotes: AgendaGenericNoteDto[];
  userName: string;
}) {
  const todayYmd = romeDateString();
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(todayYmd);
  const [items, setItems] = useState(initialItems);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(todayYmd));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState(initialNotes);
  const [noteFilter, setNoteFilter] = useState<AgendaGenericNoteFilter>("aperte");
  const [newNoteText, setNewNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const cursorDate = useMemo(() => new Date(`${cursor}T12:00:00`), [cursor]);

  const monthStart = useMemo(() => startOfMonth(cursorDate), [cursorDate]);

  const calendarDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    const days: Date[] = [];
    let cur = start;
    while (cur <= end) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    return days;
  }, [monthStart]);

  const weekStart = useMemo(
    () => startOfWeek(cursorDate, { weekStartsOn: 1 }),
    [cursorDate],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const rangeFromTo = useMemo(() => {
    if (view === "week") {
      return {
        from: format(weekDays[0], "yyyy-MM-dd"),
        to: format(weekDays[6], "yyyy-MM-dd"),
      };
    }
    if (view === "day") {
      return { from: cursor, to: cursor };
    }
    // month (+ notes: keep month cache warm)
    return {
      from: format(startOfWeek(monthStart, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }, [view, weekDays, cursor, monthStart]);

  const reloadRange = useCallback((from: string, to: string) => {
    startTransition(async () => {
      const res = await listAgendaItemsAction({ from, to });
      if (res.ok) setItems(res.items);
    });
  }, []);

  useEffect(() => {
    if (view === "notes") return;
    reloadRange(rangeFromTo.from, rangeFromTo.to);
  }, [view, rangeFromTo, reloadRange]);

  const reloadNotes = useCallback((filter: AgendaGenericNoteFilter) => {
    startTransition(async () => {
      const res = await listAgendaGenericNotesAction(filter);
      if (res.ok) {
        setNotes(res.notes);
        setNoteMsg(null);
      } else {
        setNoteMsg(res.error);
      }
    });
  }, []);

  useEffect(() => {
    if (view !== "notes") return;
    reloadNotes(noteFilter);
  }, [view, noteFilter, reloadNotes]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const tick = () => {
      const now = Date.now();
      for (const item of items) {
        if (!item.alertAt || item.completed) continue;
        const alertMs = new Date(item.alertAt).getTime();
        if (alertMs > now || alertMs < now - 60_000) continue;
        if (notifiedRef.current.has(item.id)) continue;
        notifiedRef.current.add(item.id);

        if (Notification.permission === "granted") {
          new Notification(`Promemoria: ${item.title}`, {
            body: item.notes ?? (item.scheduledAt ? formatItemWhen(item) : "Nota"),
            tag: item.id,
          });
        }
      }
    };

    const id = window.setInterval(tick, 30_000);
    tick();
    return () => window.clearInterval(id);
  }, [items]);

  const openCreate = (dateYmd?: string, noDate = false) => {
    setError(null);
    setForm(emptyForm(dateYmd ?? cursor, noDate));
    setFormOpen(true);
  };

  const openEdit = (item: AgendaItemDto) => {
    setError(null);
    setForm(itemToForm(item));
    setFormOpen(true);
  };

  const saveForm = () => {
    setError(null);
    const fd = new FormData();
    if (form.id) fd.set("id", form.id);
    fd.set("title", form.title);
    fd.set("notes", form.notes);
    fd.set("type", form.type);
    fd.set("priority", form.priority);
    if (form.noDate || !form.date) {
      fd.set("noDate", "true");
    } else {
      fd.set("date", form.date);
    }
    if (!form.allDay && !form.noDate) fd.set("time", form.time);
    if (form.allDay) fd.set("allDay", "true");
    if (form.hasAlert && form.alertDate) {
      fd.set("alertDate", form.alertDate);
      fd.set("alertTime", form.alertTime);
    }

    startTransition(async () => {
      const res = form.id
        ? await updateAgendaItemAction(fd)
        : await createAgendaItemAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFormOpen(false);
      reloadRange(rangeFromTo.from, rangeFromTo.to);
    });
  };

  const toggleComplete = (item: AgendaItemDto) => {
    startTransition(async () => {
      const res = await toggleAgendaCompleteAction(item.id, !item.completed);
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, completed: !i.completed } : i)),
      );
    });
  };

  const removeItem = (id: string) => {
    if (!window.confirm("Eliminare questo elemento?")) return;
    startTransition(async () => {
      const res = await deleteAgendaItemAction(id);
      if (!res.ok) return;
      setItems((prev) => prev.filter((i) => i.id !== id));
      setFormOpen(false);
    });
  };

  const createNote = () => {
    setNoteMsg(null);
    startTransition(async () => {
      const res = await createAgendaGenericNoteAction(newNoteText);
      if (!res.ok) {
        setNoteMsg(res.error);
        return;
      }
      setNewNoteText("");
      setNoteMsg("Nota creata");
      if (noteFilter === "risolte") {
        setNoteFilter("aperte");
      } else {
        reloadNotes(noteFilter);
      }
    });
  };

  const saveEditedNote = (id: string) => {
    setNoteMsg(null);
    startTransition(async () => {
      const res = await updateAgendaGenericNoteAction(id, editingNoteText);
      if (!res.ok) {
        setNoteMsg(res.error);
        return;
      }
      setEditingNoteId(null);
      setEditingNoteText("");
      setNoteMsg("Nota aggiornata");
      reloadNotes(noteFilter);
    });
  };

  const markNoteResolved = (id: string) => {
    setNoteMsg(null);
    startTransition(async () => {
      const res = await setAgendaGenericNoteStatusAction(id, "RISOLTA");
      if (!res.ok) {
        setNoteMsg(res.error);
        return;
      }
      setNoteMsg("Nota segnata come risolta");
      reloadNotes(noteFilter);
    });
  };

  const reopenNote = (id: string) => {
    setNoteMsg(null);
    startTransition(async () => {
      const res = await setAgendaGenericNoteStatusAction(id, "DA_CONTROLLARE");
      if (!res.ok) {
        setNoteMsg(res.error);
        return;
      }
      setNoteMsg("Nota riaperta");
      reloadNotes(noteFilter);
    });
  };

  const removeNote = (id: string) => {
    if (!window.confirm("Eliminare questa nota?")) return;
    setNoteMsg(null);
    startTransition(async () => {
      const res = await deleteAgendaGenericNoteAction(id);
      if (!res.ok) {
        setNoteMsg(res.error);
        return;
      }
      if (editingNoteId === id) {
        setEditingNoteId(null);
        setEditingNoteText("");
      }
      setNoteMsg("Nota eliminata");
      reloadNotes(noteFilter);
    });
  };

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItemDto[]>();
    for (const item of items) {
      if (!item.scheduledAt) continue;
      const key = toRomeDate(item.scheduledAt);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    for (const [, list] of map) list.sort(sortItems);
    return map;
  }, [items]);

  const dayItems = useMemo(() => {
    return (itemsByDay.get(cursor) ?? []).slice().sort(sortItems);
  }, [itemsByDay, cursor]);

  const goToday = () => setCursor(todayYmd);

  const goPrev = () => {
    if (view === "week") {
      setCursor(format(subWeeks(cursorDate, 1), "yyyy-MM-dd"));
    } else if (view === "day") {
      setCursor(format(addDays(cursorDate, -1), "yyyy-MM-dd"));
    } else {
      setCursor(format(subMonths(monthStart, 1), "yyyy-MM-dd"));
    }
  };

  const goNext = () => {
    if (view === "week") {
      setCursor(format(addWeeks(cursorDate, 1), "yyyy-MM-dd"));
    } else if (view === "day") {
      setCursor(format(addDays(cursorDate, 1), "yyyy-MM-dd"));
    } else {
      setCursor(format(addMonths(monthStart, 1), "yyyy-MM-dd"));
    }
  };

  const periodLabel = useMemo(() => {
    if (view === "day") {
      return format(cursorDate, "EEEE d MMMM yyyy", { locale: it });
    }
    if (view === "week") {
      return `${format(weekDays[0], "d MMM", { locale: it })} – ${format(weekDays[6], "d MMM yyyy", { locale: it })}`;
    }
    return format(monthStart, "MMMM yyyy", { locale: it });
  }, [view, cursorDate, weekDays, monthStart]);

  const viewTabs: Array<{ key: ViewMode; label: string }> = [
    { key: "month", label: "Mese" },
    { key: "week", label: "Settimana" },
    { key: "day", label: "Giorno" },
    { key: "notes", label: "Note generiche" },
  ];

  return (
    <div className="relative pb-20 sm:pb-8">
      <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Agenda Appuntamenti
          </h1>
          <p className="text-sm text-slate-500">{userName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined" && "Notification" in window) {
                void Notification.requestPermission();
              }
            }}
          >
            <Bell className="mr-1.5 h-4 w-4" />
            Alert
          </Button>
          <Button type="button" size="sm" onClick={() => openCreate(cursor)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nuovo Appuntamento
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:p-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Periodo precedente"
            disabled={view === "notes"}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-50"
            aria-label="Periodo successivo"
            disabled={view === "notes"}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={goToday}
            disabled={view === "notes"}
            className="ml-1"
          >
            Oggi
          </Button>
          <p className="ml-2 truncate text-sm font-semibold capitalize text-slate-800 sm:text-base">
            {view === "notes" ? "Note personali" : periodLabel}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:flex sm:w-auto">
          {viewTabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "rounded-md px-2.5 py-2 text-center text-xs font-semibold transition-colors sm:px-3 sm:text-sm",
                view === key
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-fr">
            {calendarDays.map((day) => {
              const ymd = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, monthStart);
              const dayList = itemsByDay.get(ymd) ?? [];
              const maxShow = 3;
              const extra = dayList.length - maxShow;
              return (
                <div
                  key={ymd}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setCursor(ymd);
                    setView("day");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setCursor(ymd);
                      setView("day");
                    }
                  }}
                  className={cn(
                    "min-h-[4.5rem] border-b border-r border-slate-100 p-1 text-left align-top sm:min-h-[7.5rem] sm:p-1.5",
                    !inMonth && "bg-slate-50/70",
                    isToday(day) && "bg-emerald-50/60",
                  )}
                >
                  <div className="mb-0.5 flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold sm:h-7 sm:w-7 sm:text-sm",
                        isToday(day) && "bg-emerald-600 text-white",
                        !isToday(day) && inMonth && "text-slate-800",
                        !isToday(day) && !inMonth && "text-slate-300",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <button
                      type="button"
                      className="hidden rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-emerald-600 sm:inline-flex"
                      aria-label={`Nuovo appuntamento il ${ymd}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreate(ymd);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="hidden space-y-0.5 sm:block">
                    {dayList.slice(0, maxShow).map((item) => (
                      <EventChip
                        key={item.id}
                        item={item}
                        compact
                        onClick={() => openEdit(item)}
                      />
                    ))}
                    {extra > 0 ? (
                      <p className="px-0.5 text-[10px] font-medium text-slate-400">+{extra} altri</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayList.slice(0, 4).map((item) => (
                      <span
                        key={item.id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          DOT_COLORS[item.type][item.priority],
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "week" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="-mx-0 flex gap-0 overflow-x-auto md:grid md:grid-cols-7">
            {weekDays.map((day) => {
              const ymd = format(day, "yyyy-MM-dd");
              const dayList = itemsByDay.get(ymd) ?? [];
              return (
                <div
                  key={ymd}
                  className="min-w-[9.5rem] flex-1 border-r border-slate-100 last:border-r-0 md:min-w-0"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCursor(ymd);
                      setView("day");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between border-b border-slate-100 px-2.5 py-2 text-left",
                      isToday(day) && "bg-emerald-50",
                    )}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-500">
                        {format(day, "EEE", { locale: it })}
                      </p>
                      <p
                        className={cn(
                          "text-lg font-bold",
                          isToday(day) ? "text-emerald-700" : "text-slate-900",
                        )}
                      >
                        {format(day, "d")}
                      </p>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-emerald-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreate(ymd);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          openCreate(ymd);
                        }
                      }}
                      aria-label={`Nuovo il ${ymd}`}
                    >
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                  <div className="min-h-[12rem] space-y-1 p-1.5">
                    {dayList.length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-slate-400">—</p>
                    ) : (
                      dayList.map((item) => (
                        <EventChip key={item.id} item={item} onClick={() => openEdit(item)} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "day" ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold capitalize text-slate-800">
              {format(cursorDate, "EEEE d MMMM yyyy", { locale: it })}
            </p>
            <Button type="button" size="sm" onClick={() => openCreate(cursor)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Aggiungi
            </Button>
          </div>
          {dayItems.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <StickyNote className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">Nessun appuntamento per questo giorno</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dayItems.map((item) => (
                <li key={item.id} className="flex gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleComplete(item)}
                    disabled={pending}
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                      item.completed
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-300 hover:border-emerald-500",
                    )}
                    aria-label={item.completed ? "Segna come da fare" : "Segna come completato"}
                  >
                    {item.completed ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          DOT_COLORS[item.type][item.priority],
                        )}
                      />
                      {item.scheduledAt && !item.allDay ? (
                        <span className="text-sm font-semibold tabular-nums text-slate-700">
                          {toRomeTime(item.scheduledAt)}
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-slate-500">Tutto il giorno</span>
                      )}
                      <span
                        className={cn(
                          "font-medium text-slate-900",
                          item.completed && "line-through opacity-60",
                        )}
                      >
                        {item.title}
                      </span>
                      {item.priority === "HIGH" ? (
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                      ) : null}
                    </div>
                    {item.notes ? (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.notes}</p>
                    ) : null}
                    {item.alertAt ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                        <Bell className="h-3 w-3" />
                        Alert {formatInTimeZone(item.alertAt, APP_TZ, "dd/MM/yyyy HH:mm")}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {view === "notes" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Note generiche</h2>
              <p className="text-sm text-slate-500">
                Lista di appunti da lavorare, indipendenti dagli appuntamenti
              </p>
            </div>
            <div
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
              role="tablist"
              aria-label="Filtro note"
            >
              {NOTE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={noteFilter === f.key}
                  onClick={() => setNoteFilter(f.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    noteFilter === f.key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <Field label="Nuova nota">
              <Textarea
                rows={3}
                value={newNoteText}
                onChange={(e) => {
                  setNewNoteText(e.target.value);
                  setNoteMsg(null);
                }}
                placeholder="Es. Ricontrollare contratti attivi…"
                className="font-normal"
              />
            </Field>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={createNote}
                disabled={pending || !newNoteText.trim()}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {pending ? "Salvataggio..." : "Aggiungi nota"}
              </Button>
              {noteMsg ? <span className="text-xs text-emerald-700">{noteMsg}</span> : null}
            </div>
          </div>

          {notes.length === 0 ? (
            <div className="px-2 py-12 text-center">
              <StickyNote className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">
                {noteFilter === "risolte"
                  ? "Nessuna nota risolta"
                  : noteFilter === "tutte"
                    ? "Nessuna nota ancora"
                    : "Nessuna nota da controllare"}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {notes.map((note) => {
                const isEditing = editingNoteId === note.id;
                const isResolved = note.status === "RISOLTA";
                return (
                  <li key={note.id} className="px-3 py-3 sm:px-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold",
                          isResolved
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-amber-50 text-amber-800",
                        )}
                      >
                        {noteStatusLabel(note.status)}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Aggiornata{" "}
                        {formatInTimeZone(note.updatedAt, APP_TZ, "dd/MM/yyyy HH:mm")}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          rows={4}
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          className="font-normal"
                          autoFocus
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveEditedNote(note.id)}
                            disabled={pending || !editingNoteText.trim()}
                          >
                            Salva
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingNoteId(null);
                              setEditingNoteText("");
                            }}
                            disabled={pending}
                          >
                            Annulla
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p
                          className={cn(
                            "whitespace-pre-wrap text-sm text-slate-800",
                            isResolved && "text-slate-500 line-through",
                          )}
                        >
                          {note.text}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingNoteId(note.id);
                              setEditingNoteText(note.text);
                              setNoteMsg(null);
                            }}
                            disabled={pending}
                          >
                            Modifica
                          </Button>
                          {isResolved ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => reopenNote(note.id)}
                              disabled={pending}
                            >
                              Riapri
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => markNoteResolved(note.id)}
                              disabled={pending}
                            >
                              <Check className="mr-1.5 h-4 w-4" />
                              Segna risolta
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeNote(note.id)}
                            disabled={pending}
                            className="text-rose-700 hover:bg-rose-50"
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Elimina
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {pending && view !== "notes" ? (
        <p className="mt-2 text-center text-xs text-slate-400">Aggiornamento...</p>
      ) : null}

      <button
        type="button"
        onClick={() => openCreate(cursor)}
        className="fixed bottom-5 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 sm:hidden"
        aria-label="Nuovo appuntamento"
      >
        <Plus className="h-6 w-6" />
      </button>

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {form.id ? "Modifica" : "Nuovo Appuntamento"}
              </h2>
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-slate-100"
                onClick={() => setFormOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error ? (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="space-y-3">
              <Field label="Titolo">
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Es. Visita cliente, call fornitore..."
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo">
                  <Select
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as FormState["type"];
                      setForm((f) => ({
                        ...f,
                        type,
                        noDate: type === "APPOINTMENT" ? false : f.noDate,
                        date: type === "APPOINTMENT" && !f.date ? cursor : f.date,
                        allDay: type === "TASK" ? f.allDay : false,
                      }));
                    }}
                  >
                    <option value="APPOINTMENT">Appuntamento</option>
                    <option value="TASK">Da fare / nota</option>
                  </Select>
                </Field>
                <Field label="Priorità">
                  <Select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: e.target.value as FormState["priority"],
                      }))
                    }
                  >
                    <option value="LOW">Bassa</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta (★)</option>
                  </Select>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.noDate}
                  disabled={form.type === "APPOINTMENT"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      noDate: e.target.checked,
                      date: e.target.checked ? "" : f.date || cursor,
                      allDay: e.target.checked ? true : f.allDay,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                Senza data (solo nota / appunto)
              </label>

              {!form.noDate ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Data">
                      <Input
                        type="date"
                        value={form.date}
                        onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      />
                    </Field>
                    <Field label="Ora">
                      <Input
                        type="time"
                        value={form.time}
                        disabled={form.allDay}
                        onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                      />
                    </Field>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Tutto il giorno / senza orario preciso
                  </label>
                </>
              ) : null}

              <Field label="Note">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Dettagli, numeri di telefono, riferimenti..."
                />
              </Field>

              <div className="rounded-xl border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={form.hasAlert}
                    onChange={(e) => setForm((f) => ({ ...f, hasAlert: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <Bell className="h-4 w-4 text-emerald-600" />
                  Promemoria / alert
                </label>
                {form.hasAlert ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Data alert">
                      <Input
                        type="date"
                        value={form.alertDate}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, alertDate: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Ora alert">
                      <Input
                        type="time"
                        value={form.alertTime}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, alertTime: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" onClick={saveForm} disabled={pending || !form.title.trim()}>
                {pending ? "Salvataggio..." : "Salva"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Annulla
              </Button>
              {form.id ? (
                <Button
                  type="button"
                  variant="danger"
                  className="ml-auto"
                  onClick={() => removeItem(form.id!)}
                  disabled={pending}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Elimina
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
