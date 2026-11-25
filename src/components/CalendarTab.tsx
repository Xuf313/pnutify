"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn, EmptyState } from "./ui";
import { TaskRow } from "./BriefingTab";
import { formatDate, fromKst, kstDay } from "@/lib/client/time";
import type { Task } from "@/lib/client/types";

type Props = {
  now: number;
  tasks: Task[];
  onToggleTask: (id: string) => void;
  /** Opens Tasks with the add form, due on this day. */
  onAddTask: (day: string) => void;
  /** Start on this day (e.g. tapped in the Briefing's week strip). */
  focusDay?: string | null;
};

const dayLabel = (day: string) => formatDate(fromKst(day, "12:00"), { weekday: "long", month: "long", day: "numeric" });

/** Month grid in KST. Days are "YYYY-MM-DD" strings so the device timezone never shifts them. */
export function CalendarTab({ now, tasks, onToggleTask, onAddTask, focusDay }: Props) {
  const today = kstDay(now);
  const [selected, setSelected] = useState(focusDay ?? today);
  const [month, setMonth] = useState((focusDay ?? today).slice(0, 7)); // "YYYY-MM"

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const d = kstDay(t.dueDate);
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);

  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const dayTasks = (byDay.get(selected) ?? []).sort((a, b) => a.dueDate - b.dueDate);
  const monthDate = fromKst(`${month}-15`, "12:00");

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 font-pixel text-3xl font-bold text-foreground">
          <span className="sm:hidden">{formatDate(monthDate, { month: "short", year: "numeric" })}</span>
          <span className="hidden sm:inline">{formatDate(monthDate, { month: "long", year: "numeric" })}</span>
        </h1>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={() => shift(-1)} className="cozy-btn bg-card p-2" aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
            className="cozy-btn bg-card px-3 text-sm font-extrabold whitespace-nowrap"
          >
            Today
          </button>
          <button onClick={() => shift(1)} className="cozy-btn bg-card p-2" aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="cozy-card bg-card p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-xs font-extrabold text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const list = byDay.get(day) ?? [];
            const open = list.filter((t) => t.status === "pending").length;
            const isSel = day === selected;
            return (
              <button
                key={day}
                onClick={() => setSelected(day)}
                aria-pressed={isSel}
                aria-label={`${dayLabel(day)}${day === today ? " (today)" : ""}${open ? `: ${open} due` : ""}`}
                className={cn(
                  "h-12 rounded-lg border-2 flex flex-col items-center pt-1 transition-[background-color,border-color,transform] duration-150 active:scale-95",
                  isSel ? "bg-primary text-primary-foreground border-border" : "bg-background border-transparent hover:border-border/40",
                  day === today && !isSel && "border-primary text-primary",
                )}
              >
                <span className="text-sm font-extrabold tabular-nums">{Number(day.slice(8))}</span>
                {list.length > 0 && (
                  <span className="flex items-center gap-0.5 mt-auto mb-1 h-2">
                    {list.length > 3 ? (
                      <span className={cn("text-[10px] font-extrabold leading-none tabular-nums", isSel ? "text-primary-foreground" : "text-primary")}>{list.length}</span>
                    ) : (
                      list.map((t) => (
                        <span
                          key={t.id}
                          className={cn("w-1.5 h-1.5 rounded-full", t.status === "completed" ? (isSel ? "bg-primary-foreground/50" : "bg-muted-foreground/45") : isSel ? "bg-primary-foreground" : "bg-primary")}
                        />
                      ))
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" /> to do
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/45" /> done
          </span>
          <span>A number means more than 3</span>
        </p>
      </div>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-sans text-lg font-extrabold text-foreground">{dayLabel(selected)}</h2>
          {dayTasks.length > 0 && (
            <button onClick={() => onAddTask(selected)} className="shrink-0 text-sm font-bold text-primary flex items-center gap-1 hover:underline">
              <Plus size={15} /> Add task
            </button>
          )}
        </div>
        {dayTasks.length === 0 ? (
          <EmptyState title="Nothing due">
            <button onClick={() => onAddTask(selected)} className="font-bold text-primary hover:underline">
              Add a task for this day
            </button>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {dayTasks.map((t) => (
              <TaskRow key={t.id} task={t} now={now} onToggle={onToggleTask} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
