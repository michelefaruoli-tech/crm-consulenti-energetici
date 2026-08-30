"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { it } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import {
  Bell,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListTodo,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  createAgendaItemAction,
  deleteAgendaItemAction,
  listAgendaItemsAction,
  listPendingTasksAction,
  toggleAgendaCompleteAction,
  updateAgendaItemAction,
  type AgendaItemDto,
} from "@/lib/agenda-actions";
import { APP_TZ, romeDateString } from "@/lib/timezone";

type ViewMode = "today" | "week" | "tasks";

const PRIORITY_LABELS = {
  LOW: "Bassa",
  MEDIUM: "Media",
  HIGH: "Alta",
} as const;

const PRIORITY_STYLES = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-amber-100 text-amber-800",
  HIGH: "bg-red-100 text-red-800",
} as const;

function toRomeDate(iso: string): string {
  return formatInTimeZone(iso, APP_TZ, "yyyy-MM-dd");
}

function toRomeTime(iso: string): string {
  return formatInTimeZone(iso, APP_TZ, "HH:mm");
}

function formatItemWhen(item: AgendaItemDto): string {
  const date = formatInTimeZone(item.scheduledAt, APP_TZ, "EEE d MMM", { locale: it });
  if (item.allDay) return date;
  return `${date} · ${toRomeTime(item.scheduledAt)}`;
}

function emptyForm(dateYmd: string): FormState {
  return {
    id: null,
    title: "",
    notes: "",
    type: "TASK",
    priority: "MEDIUM",
    date: dateYmd,
    time: "09:00",
    allDay: true,
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
  date: string;
  time: string;
  allDay: boolean;
  alertDate: string;
  alertTime: string;
  hasAlert: boolean;
};

function itemToForm(item: AgendaItemDto): FormState {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes ?? "",
    type: item.type,
    priority: item.priority,
    date: toRomeDate(item.scheduledAt),
    time: item.allDay ? "09:00" : toRomeTime(item.scheduledAt),
    allDay: item.allDay,
    alertDate: item.alertAt ? toRomeDate(item.alertAt) : "",
    alertTime: item.alertAt ? toRomeTime(item.alertAt) : "09:00",
    hasAlert: Boolean(item.alertAt),
  };
}

export function AgendaApp({
  initialItems,
  initialTasks,
  userName,
}: {
  initialItems: AgendaItemDto[];
  initialTasks: AgendaItemDto[];
  userName: string;
}) {
  const todayYmd = romeDateString();
  const [view, setView] = useState<ViewMode>("today");
  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [weekAnchor, setWeekAnchor] = useState(todayYmd);
  const [monthAnchor, setMonthAnchor] = useState(todayYmd);
  const [items, setItems] = useState(initialItems);
  const [tasks, setTasks] = useState(initialTasks);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(todayYmd));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const notifiedRef = useRef<Set<string>>(new Set());

  const weekStart = useMemo(() => {
    const d = new Date(`${weekAnchor}T12:00:00`);
    return startOfWeek(d, { weekStartsOn: 1 });
  }, [weekAnchor]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const monthStart = useMemo(() => startOfMonth(new Date(`${monthAnchor}T12:00:00`)), [monthAnchor]);

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

  const reloadRange = useCallback(
    (from: string, to: string) => {
      startTransition(async () => {
        const res = await listAgendaItemsAction({ from, to });
        if (res.ok) setItems(res.items);
      });
    },
    [],
  );

  const reloadTasks = useCallback(() => {
    startTransition(async () => {
      const res = await listPendingTasksAction();
      if (res.ok) setTasks(res.items);
    });
  }, []);

  useEffect(() => {
    if (view === "today") {
      const monthStartYmd = format(startOfMonth(new Date(`${monthAnchor}T12:00:00`)), "yyyy-MM-dd");
      const monthEndYmd = format(endOfMonth(new Date(`${monthAnchor}T12:00:00`)), "yyyy-MM-dd");
      reloadRange(monthStartYmd, monthEndYmd);
    } else if (view === "week") {
      const from = format(weekDays[0], "yyyy-MM-dd");
      const to = format(weekDays[6], "yyyy-MM-dd");
      reloadRange(from, to);
    }
  }, [view, selectedDate, weekDays, monthAnchor, reloadRange]);

  useEffect(() => {
    reloadTasks();
  }, [reloadTasks]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const tick = () => {
      const now = Date.now();
      const all = [...items, ...tasks];
      for (const item of all) {
        if (!item.alertAt || item.completed) continue;
        const alertMs = new Date(item.alertAt).getTime();
        if (alertMs > now || alertMs < now - 60_000) continue;
        if (notifiedRef.current.has(item.id)) continue;
        notifiedRef.current.add(item.id);

        if (Notification.permission === "granted") {
          new Notification(`Promemoria: ${item.title}`, {
            body: item.notes ?? formatItemWhen(item),
            tag: item.id,
          });
        }
      }
    };

    const id = window.setInterval(tick, 30_000);
    tick();
    return () => window.clearInterval(id);
  }, [items, tasks]);

  const requestNotifications = () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      void Notification.requestPermission();
    }
  };

  const openCreate = (dateYmd?: string) => {
    setError(null);
    setForm(emptyForm(dateYmd ?? selectedDate));
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
    fd.set("date", form.date);
    if (!form.allDay) fd.set("time", form.time);
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
      if (view === "today") {
        const monthStartYmd = format(startOfMonth(new Date(`${monthAnchor}T12:00:00`)), "yyyy-MM-dd");
        const monthEndYmd = format(endOfMonth(new Date(`${monthAnchor}T12:00:00`)), "yyyy-MM-dd");
        reloadRange(monthStartYmd, monthEndYmd);
      } else if (view === "week") {
        reloadRange(format(weekDays[0], "yyyy-MM-dd"), format(weekDays[6], "yyyy-MM-dd"));
      }
      reloadTasks();
    });
  };

  const toggleComplete = (item: AgendaItemDto) => {
    startTransition(async () => {
      const res = await toggleAgendaCompleteAction(item.id, !item.completed);
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, completed: !i.completed } : i)),
      );
      reloadTasks();
    });
  };

  const removeItem = (id: string) => {
    if (!window.confirm("Eliminare questo elemento?")) return;
    startTransition(async () => {
      const res = await deleteAgendaItemAction(id);
      if (!res.ok) return;
      setItems((prev) => prev.filter((i) => i.id !== id));
      reloadTasks();
      setFormOpen(false);
    });
  };

  const todayItems = items.filter((i) => toRomeDate(i.scheduledAt) === selectedDate);
  const sortedToday = [...todayItems].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItemDto[]>();
    for (const item of items) {
      const key = toRomeDate(item.scheduledAt);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  return (
    <div className="relative pb-24">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Agenda</h1>
          <p className="text-sm text-slate-500">
            La tua agenda personale · {userName}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={requestNotifications}>
          <Bell className="mr-1.5 h-4 w-4" />
          Alert
        </Button>
      </div>

      <div className="mb-4 flex rounded-xl border border-slate-200 bg-white p-1">
        {(
          [
            ["today", "Oggi", Calendar],
            ["week", "Settimana", Clock],
            ["tasks", "Da fare", ListTodo],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors",
              view === key
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden xs:inline sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {view === "today" ? (
        <>
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-slate-50"
                onClick={() => {
                  const d = addDays(new Date(`${selectedDate}T12:00:00`), -1);
                  setSelectedDate(format(d, "yyyy-MM-dd"));
                }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="text-sm font-semibold capitalize text-slate-800">
                {format(new Date(`${selectedDate}T12:00:00`), "EEEE d MMMM yyyy", {
                  locale: it,
                })}
              </p>
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-slate-50"
                onClick={() => {
                  const d = addDays(new Date(`${selectedDate}T12:00:00`), 1);
                  setSelectedDate(format(d, "yyyy-MM-dd"));
                }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 p-2">
              {calendarDays.map((day) => {
                const ymd = format(day, "yyyy-MM-dd");
                const inMonth = day.getMonth() === monthStart.getMonth();
                const selected = ymd === selectedDate;
                const hasItems = (itemsByDay.get(ymd)?.length ?? 0) > 0;
                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => setSelectedDate(ymd)}
                    className={cn(
                      "relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm",
                      !inMonth && "text-slate-300",
                      inMonth && "text-slate-700",
                      selected && "bg-emerald-600 font-semibold text-white",
                      !selected && isToday(day) && "ring-2 ring-emerald-400",
                      !selected && "hover:bg-slate-50",
                    )}
                  >
                    {format(day, "d")}
                    {hasItems && !selected ? (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-emerald-500" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                className="text-xs font-medium text-emerald-700"
                onClick={() => {
                  setMonthAnchor(format(subMonths(monthStart, 1), "yyyy-MM-dd"));
                }}
              >
                ← Mese prec.
              </button>
              <button
                type="button"
                className="text-xs font-medium text-emerald-700"
                onClick={() => {
                  setSelectedDate(todayYmd);
                  setMonthAnchor(todayYmd);
                }}
              >
                Oggi
              </button>
              <button
                type="button"
                className="text-xs font-medium text-emerald-700"
                onClick={() => {
                  setMonthAnchor(format(addMonths(monthStart, 1), "yyyy-MM-dd"));
                }}
              >
                Mese succ. →
              </button>
            </div>
          </div>

          <AgendaItemList
            items={sortedToday}
            emptyLabel="Nessun impegno per questo giorno"
            onToggle={toggleComplete}
            onEdit={openEdit}
            pending={pending}
          />
        </>
      ) : null}

      {view === "week" ? (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-slate-50"
              onClick={() => {
                setWeekAnchor(format(addDays(weekStart, -7), "yyyy-MM-dd"));
              }}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-sm font-semibold text-slate-800">
              {format(weekDays[0], "d MMM", { locale: it })} –{" "}
              {format(weekDays[6], "d MMM yyyy", { locale: it })}
            </p>
            <button
              type="button"
              className="rounded-lg p-2 hover:bg-slate-50"
              onClick={() => {
                setWeekAnchor(format(addDays(weekStart, 7), "yyyy-MM-dd"));
              }}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto pb-2">
            {weekDays.map((day) => {
              const ymd = format(day, "yyyy-MM-dd");
              const dayItems = itemsByDay.get(ymd) ?? [];
              return (
                <div
                  key={ymd}
                  className="min-w-[10.5rem] flex-1 rounded-xl border border-slate-200 bg-white"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(ymd);
                      setView("today");
                    }}
                    className={cn(
                      "w-full border-b border-slate-100 px-3 py-2 text-left",
                      isToday(day) && "bg-emerald-50",
                    )}
                  >
                    <p className="text-xs uppercase text-slate-500">
                      {format(day, "EEE", { locale: it })}
                    </p>
                    <p className="text-lg font-bold text-slate-900">{format(day, "d")}</p>
                  </button>
                  <div className="space-y-2 p-2">
                    {dayItems.length === 0 ? (
                      <p className="px-1 py-4 text-center text-xs text-slate-400">Vuoto</p>
                    ) : (
                      dayItems.slice(0, 4).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openEdit(item)}
                          className={cn(
                            "w-full rounded-lg border px-2 py-1.5 text-left text-xs",
                            item.completed && "opacity-60",
                            item.priority === "HIGH"
                              ? "border-red-200 bg-red-50"
                              : "border-slate-100 bg-slate-50",
                          )}
                        >
                          <p className="truncate font-medium">{item.title}</p>
                          {!item.allDay ? (
                            <p className="text-slate-500">{toRomeTime(item.scheduledAt)}</p>
                          ) : null}
                        </button>
                      ))
                    )}
                    {dayItems.length > 4 ? (
                      <p className="text-center text-[10px] text-slate-400">
                        +{dayItems.length - 4} altri
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {view === "tasks" ? (
        <AgendaItemList
          items={tasks}
          emptyLabel="Nessuna attività in sospeso"
          onToggle={toggleComplete}
          onEdit={openEdit}
          pending={pending}
          showDate
        />
      ) : null}

      <button
        type="button"
        onClick={() => openCreate()}
        className="fixed bottom-6 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 md:right-8"
        aria-label="Nuovo impegno"
      >
        <Plus className="h-6 w-6" />
      </button>

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {form.id ? "Modifica" : "Nuovo impegno"}
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
                  placeholder="Es. Richiamare cliente, visita in sede..."
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
                        allDay: type === "TASK" ? f.allDay : false,
                      }));
                    }}
                  >
                    <option value="TASK">Da fare</option>
                    <option value="APPOINTMENT">Appuntamento</option>
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
                    <option value="HIGH">Alta</option>
                  </Select>
                </Field>
              </div>

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

function AgendaItemList({
  items,
  emptyLabel,
  onToggle,
  onEdit,
  pending,
  showDate = false,
}: {
  items: AgendaItemDto[];
  emptyLabel: string;
  onToggle: (item: AgendaItemDto) => void;
  onEdit: (item: AgendaItemDto) => void;
  pending: boolean;
  showDate?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
        <StickyNote className="mx-auto mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex gap-3 rounded-xl border bg-white p-3 shadow-sm",
            item.completed && "opacity-60",
            item.priority === "HIGH" ? "border-red-200" : "border-slate-200",
          )}
        >
          <button
            type="button"
            onClick={() => onToggle(item)}
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
            onClick={() => onEdit(item)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-medium text-slate-900",
                  item.completed && "line-through",
                )}
              >
                {item.title}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                  PRIORITY_STYLES[item.priority],
                )}
              >
                {PRIORITY_LABELS[item.priority]}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {item.type === "APPOINTMENT" ? "Appuntamento" : "Da fare"}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {showDate ? formatItemWhen(item) : item.allDay ? "Tutto il giorno" : toRomeTime(item.scheduledAt)}
            </p>
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
  );
}
