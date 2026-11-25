"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Check, ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn, DdaySticker, EmptyState } from "./ui";
import { addDays, formatDue, fromKst, kstDay } from "@/lib/client/time";
import type { AlertCategories, Task } from "@/lib/client/types";

export type TaskActions = {
  add: (t: Omit<Task, "id" | "status" | "createdAt">) => void;
  update: (id: string, patch: Partial<Task>) => void;
  toggle: (id: string) => void;
  /** Deletes an own task (with an Undo). */
  remove: (id: string) => void;
  /** Clears these finished items from the list (own tasks are deleted; PLATO/NESPA items are hidden). */
  clearCompleted: (ids: string[]) => void;
  /** Moves an overdue task to tomorrow, same time. */
  postpone: (id: string) => void;
};

type Props = {
  now: number;
  tasks: Task[];
  actions: TaskActions;
  alerts: AlertCategories;
  openSettings: () => void;
  /** Owner mode: tasks sync across devices. */
  synced?: boolean;
  /** Open the add form straight away, due on this day ("YYYY-MM-DD"), e.g. from the Calendar. */
  draft?: { day: string | null } | null;
  onDraftDone?: () => void;
};

const isExternal = (t: Task) => t.source === "plato" || t.source === "nespa";

const DAY = 86_400_000;

function kstTime(t: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
}

/** Group labels: small, in the text font so they stay easy to read. */
const groupLabel = "text-xs font-extrabold uppercase tracking-wider";

export function TasksTab({ now, tasks, actions, alerts, openSettings, synced, draft, onDraftDone }: Props) {
  const [adding, setAdding] = useState(Boolean(draft));
  const [editingId, setEditingId] = useState<string | null>(null);

  const pending = useMemo(() => tasks.filter((t) => t.status === "pending").sort((a, b) => a.dueDate - b.dueDate), [tasks]);
  const completed = useMemo(() => tasks.filter((t) => t.status === "completed").sort((a, b) => b.dueDate - a.dueDate), [tasks]);
  const courses = useMemo(() => [...new Set(tasks.filter((t) => !isExternal(t)).map((t) => t.course).filter((c) => c && c !== "General"))].slice(0, 12), [tasks]);

  const groups: { label: string; items: Task[] }[] = [];
  const push = (label: string, items: Task[]) => items.length && groups.push({ label, items });
  const today = kstDay(now);
  push("Overdue", pending.filter((t) => t.dueDate < now));
  push("Today", pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) === today));
  push("This week", pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) !== today && t.dueDate < now + 7 * DAY));
  push("Later", pending.filter((t) => t.dueDate >= now + 7 * DAY));

  const closeForm = () => {
    setAdding(false);
    onDraftDone?.();
  };

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-pixel text-3xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm font-bold text-muted-foreground">
            {pending.length} to do · {synced ? "synced across your devices" : "saved on this device"}
          </p>
        </div>
        <button
          onClick={() => (adding ? closeForm() : setAdding(true))}
          className="cozy-btn bg-primary text-primary-foreground font-pixel text-lg font-bold px-3 py-1.5 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          aria-expanded={adding}
          aria-keyshortcuts="n"
        >
          {adding ? <X size={18} /> : <Plus size={18} />} {adding ? "Close" : "Add"}
        </button>
      </div>

      <button onClick={openSettings} className="self-start text-left text-sm font-bold flex items-start gap-1.5 text-muted-foreground hover:text-foreground">
        {alerts.tasks ? <Bell size={15} className="text-primary shrink-0 mt-0.5" /> : <BellOff size={15} className="shrink-0 mt-0.5" />}
        {alerts.tasks ? "Reminders on: 24 hours and 1 hour before each deadline" : "Reminders off. Turn them on in Settings."}
      </button>

      {adding && (
        <TaskForm
          now={now}
          courses={courses}
          initialDay={draft?.day ?? undefined}
          submitLabel="Add task"
          onSubmit={(t) => {
            actions.add(t);
            closeForm();
          }}
          onCancel={closeForm}
        />
      )}

      {pending.length === 0 && !adding ? (
        <EmptyState title="Nothing to do">
          <button onClick={() => setAdding(true)} className="font-bold text-primary hover:underline">
            Add your first assignment, exam or reminder.
          </button>
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <h2 className={cn(groupLabel, "mb-2", g.label === "Overdue" ? "text-danger" : "text-muted-foreground")}>{g.label}</h2>
            <ul className="flex flex-col gap-2.5">
              {g.items.map((t) =>
                editingId === t.id ? (
                  <li key={t.id}>
                    <TaskForm
                      now={now}
                      courses={courses}
                      initial={t}
                      submitLabel="Save"
                      onSubmit={(patch) => {
                        actions.update(t.id, patch);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                      onDelete={() => {
                        setEditingId(null);
                        actions.remove(t.id);
                      }}
                    />
                  </li>
                ) : (
                  <TaskItem key={t.id} task={t} now={now} onToggle={actions.toggle} onEdit={() => setEditingId(t.id)} onPostpone={() => actions.postpone(t.id)} />
                ),
              )}
            </ul>
          </section>
        ))
      )}

      {completed.length > 0 && (
        <section className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className={cn(groupLabel, "text-muted-foreground")}>Done ({completed.length})</h2>
            <button onClick={() => actions.clearCompleted(completed.map((t) => t.id))} className="text-sm font-bold text-primary hover:underline">
              Clear done
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {completed.slice(0, 15).map((t) => (
              <TaskItem key={t.id} task={t} now={now} onToggle={actions.toggle} onDelete={() => actions.remove(t.id)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One task. Every row has exactly one action on the right (edit, open on PLATO, or delete when done),
 * so the D-day stickers line up. Ticking it off shows the check for a moment before it moves to Done.
 */
function TaskItem({ task, now, onToggle, onEdit, onDelete, onPostpone }: { task: Task; now: number; onToggle: (id: string) => void; onEdit?: () => void; onDelete?: () => void; onPostpone?: () => void }) {
  const done = task.status === "completed";
  const [ticking, setTicking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const shownDone = done || ticking;
  const overdue = !done && task.dueDate < now;
  const toggle = () => {
    if (done) return onToggle(task.id);
    if (ticking) return;
    setTicking(true);
    timer.current = setTimeout(() => onToggle(task.id), 320);
  };
  const external = isExternal(task);

  return (
    <li className={cn("cozy-card bg-card p-3 flex items-center gap-3", done && "opacity-60 border-dashed shadow-none", ticking && "opacity-70")}>
      <button
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={cn(
          "w-8 h-8 rounded-lg border-2 border-border flex items-center justify-center shrink-0 transition-[background-color,transform] duration-150 active:scale-90",
          shownDone ? "bg-secondary text-secondary-foreground" : "bg-background hover:bg-primary/15",
        )}
      >
        {shownDone && <Check size={16} strokeWidth={3.5} className={cn(ticking && "check-pop")} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("font-bold text-foreground leading-snug", shownDone && "line-through")}>{task.title}</p>
        <p className="text-xs font-bold text-muted-foreground mt-0.5">
          {external ? `${task.source === "plato" ? "PLATO" : "NESPA"} · ` : ""}
          {task.course && task.course !== "General" && task.course !== "NESPA" ? `${task.course} · ` : ""}
          <span className="whitespace-nowrap">{formatDue(task.dueDate, now)}</span>
        </p>
        {overdue && !external && onPostpone && (
          <button onClick={onPostpone} className="mt-1.5 text-xs font-extrabold text-primary underline underline-offset-2 decoration-2 decoration-primary/40">
            Move to tomorrow
          </button>
        )}
      </div>
      {!done && <DdaySticker due={task.dueDate} now={now} />}
      <div className="w-9 flex justify-center shrink-0">
        {external ? (
          task.url && (
            <a href={task.url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted" aria-label={`Open "${task.title}" on ${task.source === "plato" ? "PLATO" : "NESPA"}`}>
              <ExternalLink size={17} />
            </a>
          )
        ) : done ? (
          onDelete && (
            <button onClick={onDelete} className="p-2 rounded-md text-muted-foreground hover:text-danger hover:bg-muted" aria-label={`Delete "${task.title}"`}>
              <Trash2 size={17} />
            </button>
          )
        ) : (
          onEdit && (
            <button onClick={onEdit} className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Edit "${task.title}"`}>
              <Pencil size={17} />
            </button>
          )
        )}
      </div>
    </li>
  );
}

function TaskForm({
  now,
  courses,
  initial,
  initialDay,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  now: number;
  courses: string[];
  initial?: Task;
  initialDay?: string;
  submitLabel: string;
  onSubmit: (t: { title: string; course: string; dueDate: number }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [course, setCourse] = useState(initial?.course && initial.course !== "General" ? initial.course : "");
  const [day, setDay] = useState(initial ? kstDay(initial.dueDate) : initialDay ?? addDays(kstDay(now), 1));
  const [time, setTime] = useState(initial ? kstTime(initial.dueDate) : "23:59");
  const quick = [
    { label: "Today", day: kstDay(now) },
    { label: "Tomorrow", day: addDays(kstDay(now), 1) },
    { label: "In a week", day: addDays(kstDay(now), 7) },
  ];
  const field = "bg-background border-2 border-border rounded-lg px-3 py-2 text-base sm:text-sm font-bold text-foreground";
  const label = "text-xs font-extrabold text-muted-foreground uppercase tracking-wider";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const due = fromKst(day, time || "23:59");
        if (!title.trim() || Number.isNaN(due)) return;
        onSubmit({ title: title.trim().slice(0, 200), course: course.trim().slice(0, 80) || "General", dueDate: due });
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="cozy-card bg-card p-4 border-dashed flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className={label}>What&apos;s due</span>
        <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data Structures HW 5" className={cn(field, "sm:text-base")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Course (optional)</span>
        <input value={course} onChange={(e) => setCourse(e.target.value)} list="course-options" placeholder="e.g. 자료구조" className={field} />
        <datalist id="course-options">
          {courses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className={label}>Due (KST)</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
        </label>
        <div className="flex gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setDay(q.day)}
              aria-pressed={day === q.day}
              className={cn(
                "px-2.5 py-2 rounded-lg border-2 text-xs font-bold transition-colors",
                day === q.day ? "bg-primary text-primary-foreground border-border" : "border-border/40 text-muted-foreground hover:border-border",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 items-center">
        {onDelete && (
          <button type="button" onClick={onDelete} className="mr-auto px-2 py-2 font-bold text-sm text-danger flex items-center gap-1.5 hover:underline">
            <Trash2 size={15} /> Delete
          </button>
        )}
        <button type="button" onClick={onCancel} className={cn("px-3 py-2 font-bold text-sm text-muted-foreground", !onDelete && "ml-auto")}>
          Cancel
        </button>
        <button type="submit" className="cozy-btn bg-primary text-primary-foreground font-extrabold px-4 py-2 text-sm">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
