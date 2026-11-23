"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, EmptyState } from "./ui";
import { TaskRow } from "./BriefingTab";
import { formatDate, fromKst, kstDay } from "@/lib/client/time";
import type { Tab, Task } from "@/lib/client/types";

type Props = { now: number; tasks: Task[]; onToggleTask: (id: string) => void; goTo: (t: Tab) => void };

/** Month grid in KST. Days are "YYYY-MM-DD" strings so the device timezone never shifts them. */
export function CalendarTab({ now, tasks, onToggleTask, goTo }: Props) {
  const today = kstDay(now);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7)); // "YYYY-MM"

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

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="font-pixel text-[1.6rem] sm:text-3xl font-bold text-foreground whitespace-nowrap">{formatDate(fromKst(`${month}-15`, "12:00"), { month: "long", year: "numeric" })}</h1>
        <div className="flex gap-1.5">
          <button onClick={() => shift(-1)} className="cozy-btn bg-card p-1.5" aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
            className="cozy-btn bg-card px-2.5 text-xs font-semibold whitespace-nowrap"
          >
            Today
          </button>
          <button onClick={() => shift(1)} className="cozy-btn bg-card p-1.5" aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="rounded-[16px] border border-border bg-card p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground">
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
                aria-label={`${day}${open ? `, ${open} due` : ""}`}
                className={cn(
                  "h-12 rounded-[10px] flex flex-col items-center pt-1.5 transition-colors",
                  isSel ? "bg-foreground text-background" : "hover:bg-muted",
                  day === today && !isSel && "ring-[1.5px] ring-inset ring-foreground",
                )}
              >
                <span className="text-sm font-medium tabular-nums">{Number(day.slice(8))}</span>
                {list.length > 0 && (
                  <span className="flex gap-0.5 mt-auto mb-1">
                    {list.slice(0, 3).map((t) => (
                      <span key={t.id} className={cn("w-1.5 h-1.5 rounded-full", t.status === "completed" ? "bg-muted-foreground/40" : isSel ? "bg-background" : "bg-signal")} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section>
        <h2 className="font-pixel text-lg font-bold mb-3 text-foreground">{formatDate(fromKst(selected, "12:00"), { weekday: "long", month: "long", day: "numeric" })}</h2>
        {dayTasks.length === 0 ? (
          <EmptyState title="Nothing due">
            <button onClick={() => goTo("tasks")} className="font-semibold text-primary hover:underline">
              Add a task
            </button>
          </EmptyState>
        ) : (
          <ul className="stops">
            {dayTasks.map((t) => (
              <TaskRow key={t.id} task={t} now={now} onToggle={onToggleTask} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
