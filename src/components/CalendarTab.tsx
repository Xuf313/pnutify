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
      <div className="flex items-center justify-between">
        <h1 className="font-pixel text-3xl font-bold text-foreground">{formatDate(fromKst(`${month}-15`, "12:00"), { month: "long", year: "numeric" })}</h1>
        <div className="flex gap-1.5">
          <button onClick={() => shift(-1)} className="cozy-btn bg-card p-1.5" aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
            className="cozy-btn bg-card px-2.5 text-xs font-extrabold"
          >
            Today
          </button>
          <button onClick={() => shift(1)} className="cozy-btn bg-card p-1.5" aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="cozy-card bg-card p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-[11px] font-extrabold text-muted-foreground">
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
                  "h-12 rounded-lg border-2 flex flex-col items-center pt-1 transition-colors",
                  isSel ? "bg-foreground text-background border-foreground" : "bg-background border-transparent hover:border-border/40",
                  day === today && !isSel && "border-primary text-primary",
                )}
              >
                <span className="font-pixel text-sm font-bold">{Number(day.slice(8))}</span>
                {list.length > 0 && (
                  <span className="flex gap-0.5 mt-auto mb-1">
                    {list.slice(0, 3).map((t) => (
                      <span key={t.id} className={cn("w-1.5 h-1.5 rounded-full", t.status === "completed" ? "bg-muted-foreground/40" : isSel ? "bg-background" : "bg-primary")} />
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
            <button onClick={() => goTo("tasks")} className="font-bold text-primary hover:underline">
              Add a task
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
