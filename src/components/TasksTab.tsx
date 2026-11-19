"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn, EmptyState, Pill } from "./ui";
import { addDays, formatDue, fromKst, kstDay, relative } from "@/lib/client/time";
import type { AlertCategories, Task } from "@/lib/client/types";

type Actions = {
  add: (t: Omit<Task, "id" | "status" | "createdAt">) => void;
  update: (id: string, patch: Partial<Task>) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clearCompleted: () => void;
};

type Props = { now: number; tasks: Task[]; actions: Actions; alerts: AlertCategories; openSettings: () => void };

const DAY = 86_400_000;

function kstTime(t: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
}

export function TasksTab({ now, tasks, actions, alerts, openSettings }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pending = useMemo(() => tasks.filter((t) => t.status === "pending").sort((a, b) => a.dueDate - b.dueDate), [tasks]);
  const completed = useMemo(() => tasks.filter((t) => t.status === "completed").sort((a, b) => b.dueDate - a.dueDate), [tasks]);
  const courses = useMemo(() => [...new Set(tasks.map((t) => t.course).filter((c) => c && c !== "General"))].slice(0, 12), [tasks]);

  const groups: { label: string; items: Task[] }[] = [];
  const push = (label: string, items: Task[]) => items.length && groups.push({ label, items });
  const today = kstDay(now);
  push("Overdue", pending.filter((t) => t.dueDate < now));
  push("Today", pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) === today));
  push("This week", pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) !== today && t.dueDate < now + 7 * DAY));
  push("Later", pending.filter((t) => t.dueDate >= now + 7 * DAY));

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-pixel text-3xl font-bold text-foreground">Tasks</h1>
          <p className="text-sm font-bold text-muted-foreground">{pending.length} to do · saved on this device</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="cozy-btn bg-primary text-primary-foreground font-pixel font-bold px-3 py-2 flex items-center gap-1.5"
          aria-expanded={adding}
        >
          {adding ? <X size={18} /> : <Plus size={18} />} {adding ? "Close" : "Add"}
        </button>
      </div>

      <button onClick={openSettings} className="self-start text-sm font-bold flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
        {alerts.tasks ? <Bell size={15} className="text-primary" /> : <BellOff size={15} />}
        {alerts.tasks ? "Reminders on: 24 hours and 1 hour before each deadline" : "Reminders off. Turn them on in Settings."}
      </button>

      {adding && (
        <TaskForm
          now={now}
          courses={courses}
          submitLabel="Add task"
          onSubmit={(t) => {
            actions.add(t);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
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
            <h2 className={cn("font-pixel text-sm font-bold uppercase tracking-wider mb-2", g.label === "Overdue" ? "text-[#E5484D]" : "text-muted-foreground")}>
              {g.label}
            </h2>
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
                    />
                  </li>
                ) : (
                  <TaskItem key={t.id} task={t} now={now} onToggle={actions.toggle} onEdit={() => setEditingId(t.id)} onDelete={() => actions.remove(t.id)} />
                ),
              )}
            </ul>
          </section>
        ))
      )}

      {completed.length > 0 && (
        <section className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-pixel text-sm font-bold uppercase tracking-wider text-muted-foreground">Done ({completed.length})</h2>
            <button onClick={actions.clearCompleted} className="text-sm font-bold text-primary hover:underline">
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

function TaskItem({ task, now, onToggle, onEdit, onDelete }: { task: Task; now: number; onToggle: (id: string) => void; onEdit?: () => void; onDelete: () => void }) {
  const done = task.status === "completed";
  const overdue = !done && task.dueDate < now;
  const soon = !done && !overdue && task.dueDate - now < DAY;
  return (
    <li className={cn("cozy-card bg-card p-3 flex items-center gap-3", done && "opacity-60 border-dashed shadow-none")}>
      <button
        onClick={() => onToggle(task.id)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={cn(
          "w-7 h-7 rounded-lg border-2 border-border flex items-center justify-center shrink-0",
          done ? "bg-secondary text-secondary-foreground" : "bg-background hover:bg-primary/15",
        )}
      >
        {done && <Check size={16} strokeWidth={3.5} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("font-bold text-foreground leading-snug", done && "line-through")}>{task.title}</p>
        <p className="text-xs font-bold text-muted-foreground mt-0.5">
          {task.course && task.course !== "General" ? `${task.course} · ` : ""}
          {formatDue(task.dueDate, now)}
        </p>
      </div>
      {!done && (
        <Pill tone={overdue ? "danger" : soon ? "primary" : "muted"} className="shrink-0 hidden sm:inline-flex">
          {overdue ? "Overdue" : relative(task.dueDate, now)}
        </Pill>
      )}
      <div className="flex shrink-0">
        {onEdit && (
          <button onClick={onEdit} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`Edit "${task.title}"`}>
            <Pencil size={16} />
          </button>
        )}
        <button onClick={onDelete} className="p-1.5 rounded-md text-muted-foreground hover:text-[#E5484D] hover:bg-muted" aria-label={`Delete "${task.title}"`}>
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}

function TaskForm({
  now,
  courses,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  now: number;
  courses: string[];
  initial?: Task;
  submitLabel: string;
  onSubmit: (t: { title: string; course: string; dueDate: number }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [course, setCourse] = useState(initial?.course && initial.course !== "General" ? initial.course : "");
  const [day, setDay] = useState(initial ? kstDay(initial.dueDate) : addDays(kstDay(now), 1));
  const [time, setTime] = useState(initial ? kstTime(initial.dueDate) : "23:59");
  const quick = [
    { label: "Today", day: kstDay(now) },
    { label: "Tomorrow", day: addDays(kstDay(now), 1) },
    { label: "In a week", day: addDays(kstDay(now), 7) },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const due = fromKst(day, time || "23:59");
        if (!title.trim() || Number.isNaN(due)) return;
        onSubmit({ title: title.trim().slice(0, 200), course: course.trim().slice(0, 80) || "General", dueDate: due });
      }}
      className="cozy-card bg-card p-4 border-dashed flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">What&apos;s due</span>
        <input
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Data Structures HW 5"
          className="bg-background border-2 border-border rounded-lg px-3 py-2 font-bold focus:outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">Course (optional)</span>
        <input
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          list="course-options"
          placeholder="e.g. 자료구조"
          className="bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary"
        />
        <datalist id="course-options">
          {courses.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">Due (KST)</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required className="bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold text-foreground" />
        </label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Due time" className="bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold text-foreground" />
        <div className="flex gap-1.5">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setDay(q.day)}
              className={cn("px-2.5 py-1.5 rounded-lg border-2 text-xs font-bold", day === q.day ? "bg-foreground text-background border-foreground" : "border-border/40 text-muted-foreground")}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 font-bold text-sm text-muted-foreground">
          Cancel
        </button>
        <button type="submit" className="cozy-btn bg-primary text-primary-foreground font-extrabold px-4 py-2 text-sm">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
