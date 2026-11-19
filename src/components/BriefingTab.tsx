"use client";

import { useMemo } from "react";
import { ArrowRight, BellRing, Check, Clock, Globe, Monitor, Newspaper, Smartphone, Sparkles } from "lucide-react";
import { cn, EmptyState, Pill, SectionTitle } from "./ui";
import { addDays, formatDate, formatDue, fromKst, greeting, kstDay, relative } from "@/lib/client/time";
import { isIOS, isStandalone } from "@/lib/client/push";
import type { AlertCategories, Notice, Tab, Task } from "@/lib/client/types";
import { SOURCE_LABEL } from "@/lib/client/types";

const DAY = 86_400_000;

type Props = {
  now: number;
  sinceTs: number;
  notices: Notice[];
  readIds: Set<string>;
  tasks: Task[];
  alerts: AlertCategories;
  alertsReady: boolean;
  canInstall: boolean;
  onOpenNotice: (id: string) => void;
  onToggleTask: (id: string) => void;
  goTo: (t: Tab) => void;
  openSettings: () => void;
};

export function isNewNotice(n: Notice, now: number): boolean {
  const posted = n.postedAt ?? n.firstSeenAt;
  return now - posted < 2 * DAY || now - n.firstSeenAt < DAY;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function BriefingTab(p: Props) {
  const { now } = p;
  const today = kstDay(now);

  const pending = useMemo(() => p.tasks.filter((t) => t.status === "pending").sort((a, b) => a.dueDate - b.dueDate), [p.tasks]);
  const overdue = pending.filter((t) => t.dueDate < now);
  const dueToday = pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) === today);
  const thisWeek = pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) !== today && t.dueDate < now + 7 * DAY);
  const doneToday = p.tasks.filter((t) => t.status === "completed" && kstDay(t.dueDate) === today).length;

  const fresh = useMemo(
    () => p.notices.filter((n) => !p.readIds.has(n.id) && (n.firstSeenAt > p.sinceTs || isNewNotice(n, now))).slice(0, 6),
    [p.notices, p.readIds, p.sinceTs, now],
  );
  const freshCount = p.notices.filter((n) => !p.readIds.has(n.id) && (n.firstSeenAt > p.sinceTs || isNewNotice(n, now))).length;

  // One calm sentence about the shape of the day.
  const parts: string[] = [];
  if (overdue.length) parts.push(`${plural(overdue.length, "task")} overdue`);
  if (dueToday.length) parts.push(`${plural(dueToday.length, "deadline")} today`);
  if (freshCount) parts.push(`${plural(freshCount, "new notice")}`);
  const summary =
    parts.length === 0
      ? thisWeek.length
        ? `Nothing due today. ${plural(thisWeek.length, "deadline")} later this week.`
        : "Nothing due and no new notices. A clear day."
      : `${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;

  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    const count = pending.filter((t) => kstDay(t.dueDate) === day).length;
    return { day, count, label: i === 0 ? "Today" : formatDate(fromKst(day, "12:00"), { weekday: "short" }), date: Number(day.slice(8)) };
  });
  const maxCount = Math.max(1, ...week.map((w) => w.count));

  const alertsOff = p.alertsReady && !p.alerts.cse && !p.alerts.international && !p.alerts.tasks;
  const showInstall = !isStandalone() && (p.canInstall || isIOS());

  return (
    <div className="flex flex-col gap-7 pb-4">
      {/* ---------- hero ---------- */}
      <section className="cozy-card bg-primary text-primary-foreground p-5 relative overflow-hidden -rotate-[0.4deg]">
        <div className="absolute -right-6 -top-6 opacity-15" aria-hidden>
          <Sparkles size={120} />
        </div>
        <p className="font-pixel text-sm font-bold opacity-80">{formatDate(now, { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="font-pixel text-3xl font-bold leading-tight mt-1">{greeting(now)}!</h1>
        <p className="font-bold mt-2 text-[15px] leading-snug max-w-md">{summary}</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Stat label="Due today" value={dueToday.length + overdue.length} />
          <Stat label="This week" value={thisWeek.length} />
          <Stat label="New notices" value={freshCount} />
        </div>
      </section>

      {/* ---------- deadlines ---------- */}
      <section>
        <SectionTitle
          icon={<Clock size={18} />}
          action={
            <button onClick={() => p.goTo("tasks")} className="text-sm font-bold text-primary flex items-center gap-1 hover:underline">
              All tasks <ArrowRight size={14} />
            </button>
          }
        >
          Coming up
        </SectionTitle>
        {overdue.length + dueToday.length + thisWeek.length === 0 ? (
          <EmptyState title={doneToday ? "All done for today 🎉" : "No deadlines this week"}>
            <button onClick={() => p.goTo("tasks")} className="font-bold text-primary hover:underline">
              Add an assignment or exam
            </button>{" "}
            and PNUtify will remind you before it&apos;s due.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {[...overdue, ...dueToday, ...thisWeek].slice(0, 6).map((t) => (
              <TaskRow key={t.id} task={t} now={now} onToggle={p.onToggleTask} />
            ))}
          </ul>
        )}
      </section>

      {/* ---------- week strip ---------- */}
      <section aria-label="Deadlines over the next 7 days">
        <div className="cozy-card bg-card p-3 grid grid-cols-7 gap-1">
          {week.map((w, i) => (
            <button
              key={w.day}
              onClick={() => p.goTo("calendar")}
              className={cn("flex flex-col items-center gap-1 py-1.5 rounded-lg", i === 0 && "bg-muted")}
              aria-label={`${w.label}: ${plural(w.count, "deadline")}`}
            >
              <span className="font-pixel text-[10px] font-bold text-muted-foreground">{w.label}</span>
              <span className="font-pixel text-sm font-bold text-foreground">{w.date}</span>
              <span className="h-8 w-3 rounded-full bg-muted relative overflow-hidden" aria-hidden>
                <span
                  className={cn("absolute bottom-0 inset-x-0 rounded-full", w.count ? "bg-primary" : "")}
                  style={{ height: `${(w.count / maxCount) * 100}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ---------- notices ---------- */}
      <section>
        <SectionTitle
          icon={<Newspaper size={18} />}
          action={
            <button onClick={() => p.goTo("notices")} className="text-sm font-bold text-primary flex items-center gap-1 hover:underline">
              All notices <ArrowRight size={14} />
            </button>
          }
        >
          New for you
        </SectionTitle>
        {fresh.length === 0 ? (
          <EmptyState title="You're all caught up">No new CSE or International notices since your last visit.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {fresh.map((n) => (
              <li key={n.id}>
                <button onClick={() => p.onOpenNotice(n.id)} className="cozy-card interactive bg-card w-full text-left p-3.5 flex gap-3 items-start">
                  <span className="w-9 h-9 rounded-xl bg-background border-2 border-border flex items-center justify-center shrink-0" aria-hidden>
                    {n.source === "cse" ? <Monitor size={16} className="text-secondary" /> : <Globe size={16} className="text-primary" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-foreground leading-snug line-clamp-2">{n.title}</span>
                    <span className="flex items-center gap-2 mt-1.5">
                      <Pill tone="primary">New</Pill>
                      <span className="text-xs font-bold text-muted-foreground">
                        {SOURCE_LABEL[n.source]} · {n.date}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- get set up ---------- */}
      {(alertsOff || showInstall) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {alertsOff && (
            <SetupCard
              icon={<BellRing size={20} />}
              title="Get alerts"
              body="A ping when a new CSE or International notice goes up, and a reminder before your deadlines."
              cta="Turn on alerts"
              onClick={p.openSettings}
            />
          )}
          {showInstall && (
            <SetupCard
              icon={<Smartphone size={20} />}
              title="Add to your home screen"
              body={isIOS() ? "Opens like an app, and it's needed for alerts on iPhone." : "Opens like an app, full screen, one tap away."}
              cta="Show me how"
              onClick={p.openSettings}
            />
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="bg-primary-foreground/15 border-2 border-primary-foreground/30 rounded-xl px-3 py-1.5 flex items-baseline gap-1.5">
      <span className="font-pixel text-xl font-bold tabular-nums">{value}</span>
      <span className="text-xs font-bold opacity-85">{label}</span>
    </span>
  );
}

export function TaskRow({ task, now, onToggle }: { task: Task; now: number; onToggle: (id: string) => void }) {
  const overdue = task.status === "pending" && task.dueDate < now;
  const soon = task.status === "pending" && !overdue && task.dueDate - now < DAY;
  const done = task.status === "completed";
  return (
    <li className={cn("cozy-card bg-card p-3 flex items-center gap-3", done && "opacity-60 border-dashed")}>
      <button
        onClick={() => onToggle(task.id)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={cn(
          "w-7 h-7 rounded-lg border-2 border-border flex items-center justify-center shrink-0 transition-colors",
          done ? "bg-secondary text-secondary-foreground" : "bg-background hover:bg-primary/15",
        )}
      >
        {done && <Check size={16} strokeWidth={3.5} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("font-bold text-foreground leading-snug truncate", done && "line-through")}>{task.title}</p>
        <p className="text-xs font-bold text-muted-foreground mt-0.5 truncate">
          {task.course && task.course !== "General" ? `${task.course} · ` : ""}
          {formatDue(task.dueDate, now)}
        </p>
      </div>
      {!done && (
        <Pill tone={overdue ? "danger" : soon ? "primary" : "muted"} className="shrink-0">
          {overdue ? "Overdue" : relative(task.dueDate, now)}
        </Pill>
      )}
    </li>
  );
}

function SetupCard({ icon, title, body, cta, onClick }: { icon: React.ReactNode; title: string; body: string; cta: string; onClick: () => void }) {
  return (
    <div className="cozy-card bg-card p-4 flex flex-col gap-2 border-dashed">
      <p className="flex items-center gap-2 font-pixel font-bold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <button onClick={onClick} className="cozy-btn bg-primary text-primary-foreground font-pixel font-bold text-sm px-3 py-2 self-start mt-1">
        {cta}
      </button>
    </div>
  );
}
