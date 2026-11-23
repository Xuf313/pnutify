"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight, BellRing, Check, ExternalLink, Smartphone, TriangleAlert } from "lucide-react";
import { cn, Pill } from "./ui";
import { addDays, formatDate, formatDue, fromKst, greeting, kstDay, kstHour, relative } from "@/lib/client/time";
import { isIOS, isStandalone } from "@/lib/client/push";
import { paintingCaption, paintingOfTheDay } from "@/lib/client/paintings";
import type { AlertCategories, CoursePost, Notice, OwnerData, Tab, Task } from "@/lib/client/types";
import { boardInfo, SOURCE_LABEL } from "@/lib/client/types";
import { BoardIcon } from "./BoardIcon";
import { isFreshNotice } from "@/lib/client/notices";

const DAY = 86_400_000;

type Props = {
  now: number;
  sinceTs: number;
  notices: Notice[];
  readIds: Set<string>;
  tasks: Task[];
  /** Owner mode only: PLATO announcements and NESPA notices, newest first. */
  posts: CoursePost[];
  ownerData: OwnerData | null;
  onOpenPost: (post: CoursePost) => void;
  alerts: AlertCategories;
  alertsReady: boolean;
  canInstall: boolean;
  onOpenNotice: (id: string) => void;
  onToggleTask: (id: string) => void;
  goTo: (t: Tab) => void;
  openSettings: () => void;
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const sourceName = (t: Task) => (t.source === "plato" ? "PLATO" : t.source === "nespa" ? "NESPA" : null);

/** One entry in "New updates": a course post or a board notice. */
type Update = {
  id: string;
  title: string;
  tag: string;
  tone: "primary" | "secondary" | "muted";
  text: string;
  at: number;
  url?: string;
  /** Set for board notices, to show the board's icon. */
  source?: string;
  open: () => void;
};

/** The one thing most worth doing next. */
type Push = { label: string; topic: string; text: string; cta: string; act: () => void };

export function BriefingTab(p: Props) {
  const { now } = p;
  const today = kstDay(now);

  const pending = useMemo(() => p.tasks.filter((t) => t.status === "pending").sort((a, b) => a.dueDate - b.dueDate), [p.tasks]);
  const overdue = pending.filter((t) => t.dueDate < now);
  const dueToday = pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) === today);
  const thisWeek = pending.filter((t) => t.dueDate >= now && kstDay(t.dueDate) !== today && t.dueDate < now + 7 * DAY);
  const doneToday = p.tasks.filter((t) => t.status === "completed" && kstDay(t.dueDate) === today);

  const freshNotices = useMemo(
    () => p.notices.filter((n) => !p.readIds.has(n.id) && isFreshNotice(n, now, p.sinceTs)),
    [p.notices, p.readIds, p.sinceTs, now],
  );
  const newPosts = useMemo(
    () => p.posts.filter((x) => !p.readIds.has(x.id) && x.postedAt !== null && now - x.postedAt < 7 * DAY),
    [p.posts, p.readIds, now],
  );

  // ---------- the blurb under the painting ----------
  const parts: string[] = [];
  if (overdue.length) parts.push(`${plural(overdue.length, "task")} overdue`);
  if (dueToday.length) parts.push(`${plural(dueToday.length, "deadline")} today`);
  if (freshNotices.length) parts.push(plural(freshNotices.length, "new notice"));
  if (newPosts.length) parts.push(plural(newPosts.length, "new course post"));
  const blurb =
    parts.length === 0
      ? thisWeek.length
        ? `Nothing due today, and ${plural(thisWeek.length, "deadline")} later this week. A good day to get ahead.`
        : "Nothing due and nothing new. Today is yours to spend however you like."
      : `${greeting(now)}. You have ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;

  // ---------- "Push your work forward" ----------
  const openTask = (t: Task) => () => (t.url ? window.open(t.url, "_blank", "noopener,noreferrer") : p.goTo("tasks"));
  const nextUp = overdue[0] ?? pending.find((t) => t.dueDate >= now && t.dueDate < now + 2 * DAY);
  const push: Push | null = nextUp
    ? {
        label: nextUp.dueDate < now ? "Overdue: catch up" : "Next stop",
        topic: nextUp.title,
        text: [
          sourceName(nextUp),
          nextUp.course && nextUp.course !== "General" && nextUp.course !== "NESPA" ? nextUp.course : null,
          nextUp.dueDate < now ? `was due ${relative(nextUp.dueDate, now)}` : `due ${formatDue(nextUp.dueDate, now)} (${relative(nextUp.dueDate, now)})`,
        ]
          .filter(Boolean)
          .join(" · "),
        cta: nextUp.url ? "Open it" : "Let's do it",
        act: openTask(nextUp),
      }
    : newPosts[0]
      ? {
          label: `New from ${newPosts[0].source}`,
          topic: newPosts[0].title,
          text: newPosts[0].excerpt || [newPosts[0].course, newPosts[0].postedAt ? relative(newPosts[0].postedAt, now) : ""].filter(Boolean).join(" · "),
          cta: "Read it",
          act: () => p.onOpenPost(newPosts[0]),
        }
      : null;

  // ---------- to-dos: overdue, today, then the rest of the week ----------
  const todos = [...overdue, ...dueToday, ...thisWeek].slice(0, 6);

  // ---------- "New updates" ----------
  const updates: Update[] = useMemo(() => {
    const fromPosts: Update[] = newPosts.map((x) => ({
      id: x.id,
      title: x.title,
      tag: x.source === "PLATO" ? x.course || "PLATO" : "NESPA",
      tone: x.source === "PLATO" ? "secondary" : "muted",
      text: x.excerpt || `${x.source}${x.course && x.course !== x.source ? ` · ${x.course}` : ""}`,
      at: x.postedAt ?? 0,
      url: x.url,
      open: () => p.onOpenPost(x),
    }));
    const fromNotices: Update[] = freshNotices.map((n) => ({
      id: n.id,
      title: n.title,
      tag: SOURCE_LABEL[n.source],
      tone: "primary",
      text: boardInfo(n.source)?.core ? `${boardInfo(n.source)?.name} · posted ${n.date}` : `Posted ${n.date}`,
      at: n.firstSeenAt,
      url: n.url,
      source: n.source,
      open: () => p.onOpenNotice(n.id),
    }));
    return [...fromPosts, ...fromNotices].sort((a, b) => b.at - a.at).slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPosts, freshNotices]);

  // ---------- "Your day": today's deadlines by time ----------
  const todayAll = [...dueToday, ...doneToday.filter((t) => t.dueDate >= now - 12 * 3600_000)].sort((a, b) => a.dueDate - b.dueDate);
  const dayParts = [
    { label: "Morning", items: todayAll.filter((t) => kstHour(t.dueDate) < 12) },
    { label: "Afternoon", items: todayAll.filter((t) => kstHour(t.dueDate) >= 12 && kstHour(t.dueDate) < 18) },
    { label: "Evening", items: todayAll.filter((t) => kstHour(t.dueDate) >= 18) },
  ].filter((x) => x.items.length > 0);

  // ---------- looking ahead ----------
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    const count = pending.filter((t) => kstDay(t.dueDate) === day).length;
    return { day, count, label: i === 0 ? "Today" : formatDate(fromKst(day, "12:00"), { weekday: "short" }), date: Number(day.slice(8)) };
  });

  const alertsOff = p.alertsReady && p.alerts.boards.length === 0 && !p.alerts.tasks;
  const showInstall = !isStandalone() && (p.canInstall || isIOS());

  const painting = paintingOfTheDay(now);
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const weekday = formatDate(now, { weekday: "long" });

  const problems = p.ownerData ? ([p.ownerData.plato, p.ownerData.nespa].map((s) => s.error).filter(Boolean) as string[]) : [];
  const sources = [
    p.ownerData?.plato.configured && "PLATO",
    p.ownerData?.nespa.configured && "NESPA",
    "CSE",
    "International",
  ].filter(Boolean) as string[];

  return (
    <div className="brief pb-4">
      {/* ---------- hero: the painting of the day ---------- */}
      <header>
        <figure className="brief-frame">
          <div className="brief-frame__canvas">
            <Image
              key={painting.slug}
              src={`/paintings/${painting.slug}.jpg`}
              alt=""
              fill
              priority
              sizes="(min-width: 768px) 640px, 100vw"
              className={cn(loadedSlug === painting.slug && "is-loaded")}
              style={{ objectPosition: painting.focus ?? "50% 50%" }}
              onLoad={() => setLoadedSlug(painting.slug)}
            />
            <div className="brief-frame__overlay">
              <h1 className="brief-day">{weekday} Brief</h1>
            </div>
          </div>
        </figure>
        <p className="brief-caption">{paintingCaption(painting)}</p>
        <p className="brief-blurb">{blurb}</p>
      </header>

      {problems.map((msg) => (
        <p key={msg} className="mt-4 text-xs font-semibold text-signal flex items-start gap-1.5">
          <TriangleAlert size={14} className="shrink-0 mt-px" /> {msg}
        </p>
      ))}

      {/* ---------- push your work forward ---------- */}
      {push && (
        <section className="brief-push" aria-label="Next stop">
          <div className="brief-push__rail" aria-hidden>
            <span className="brief-push__stop" />
          </div>
          <div className="min-w-0">
            <p className="brief-push__label">{push.label}</p>
            <h2 className="brief-push__topic">{push.topic}</h2>
            <p className="brief-push__text">{push.text}</p>
            <button onClick={push.act} className="brief-push__cta" aria-label={`${push.cta}: ${push.topic}`}>
              {push.cta} <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}

      {/* ---------- to-dos ---------- */}
      <section className="brief-section">
        <h2 className="brief-h2">
          To-dos
          {pending.length > 0 && <small>{plural(pending.length, "open task")}</small>}
        </h2>
        {todos.length > 0 ? (
          <div>
            {todos.map((t) => (
              <TodoItem key={t.id} task={t} now={now} onToggle={p.onToggleTask} />
            ))}
            {pending.length > todos.length && (
              <button onClick={() => p.goTo("tasks")} className="mt-2 text-sm font-semibold text-primary flex items-center gap-1 hover:underline">
                {plural(pending.length - todos.length, "more task")} <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : doneToday.length > 0 ? (
          <div className="brief-alldone">
            <h3>You completed all your to-dos!</h3>
            <p className="text-sm font-semibold text-muted-foreground mt-1">Nice work. The day is yours.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing due this week.{" "}
            <button onClick={() => p.goTo("tasks")} className="text-primary hover:underline">
              Add an assignment or exam
            </button>{" "}
            and you&apos;ll get a reminder before it&apos;s due.
          </p>
        )}
      </section>

      {/* ---------- new updates ---------- */}
      <section className="brief-section">
        <h2 className="brief-h2">New updates</h2>
        {updates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You&apos;re all caught up.{" "}
            <button onClick={() => p.goTo("notices")} className="text-primary hover:underline">
              See all notices
            </button>
          </p>
        ) : (
          <div>
            {updates.map((u) => (
              <article key={u.id} className="brief-item">
                <span className="brief-item__dot" aria-hidden />
                <div className="min-w-0">
                  <h3 className="brief-item__title">
                    <button onClick={u.open} className="text-left">
                      {u.title}
                    </button>
                  </h3>
                  <p className="brief-item__text">
                    <span className={cn("brief-tag", u.tone === "primary" && "brief-tag--primary", u.tone === "secondary" && "brief-tag--secondary")}>{u.tag}</span>
                    <span>{u.text}</span>
                    {u.url && (
                      <a href={u.url} target="_blank" rel="noopener noreferrer" className="brief-source" aria-label={`Open "${u.title}" on the original site`}>
                        {u.source ? <BoardIcon source={u.source} size={13} /> : <ExternalLink size={13} />}
                      </a>
                    )}
                  </p>
                </div>
              </article>
            ))}
            <button onClick={() => p.goTo("notices")} className="mt-1 text-sm font-semibold text-primary flex items-center gap-1 hover:underline">
              All notices <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>

      {/* ---------- your day ---------- */}
      {dayParts.length > 0 && (
        <section className="brief-section">
          <h2 className="brief-h2">Your day</h2>
          <div className="brief-day-card">
            {dayParts.map((part) => (
              <div key={part.label}>
                <p className="brief-part">{part.label}</p>
                {part.items.map((t) => (
                  <div key={t.id} className="brief-slot">
                    <span className="brief-slot__time">{formatDate(t.dueDate, { hour: "numeric", minute: "2-digit", hour12: true })}</span>
                    <span className={cn("brief-slot__event", t.status === "completed" && "line-through opacity-55")}>
                      {t.title}
                      <small>{[sourceName(t), t.course !== "General" && t.course !== "NESPA" ? t.course : null, "deadline"].filter(Boolean).join(" · ")}</small>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- looking ahead ---------- */}
      <section className="brief-section">
        <h2 className="brief-h2">Looking ahead</h2>
        <div className="route" role="list">
          {week.map((w, i) => (
            <button
              key={w.day}
              role="listitem"
              onClick={() => p.goTo("calendar")}
              className={cn("route__day", i === 0 && "is-today", w.count > 0 && "has-due")}
              aria-label={`${w.label}: ${plural(w.count, "deadline")}`}
            >
              <span className="route__stop" aria-hidden>
                <span>{w.count > 0 ? w.count : null}</span>
              </span>
              <span className="route__label">
                {w.label}
                <b>{w.date}</b>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ---------- get set up ---------- */}
      {(alertsOff || showInstall) && (
        <section className="brief-section grid gap-3 sm:grid-cols-2">
          {alertsOff && (
            <SetupCard
              icon={<BellRing size={20} />}
              title="Get alerts"
              body="A ping when a new notice goes up, and a reminder before your deadlines."
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

      {/* ---------- footer ---------- */}
      <footer className="brief-footer">
        <p className="brief-footer__credit">
          Made for you by <em>PNUtify</em> using <em>your</em>{" "}
          {sources.map((s, i) => (
            <span key={s}>
              <span className="brief-footer__src">
                {s}
              </span>
              {i < sources.length - 2 ? ", " : i === sources.length - 2 ? " and " : "."}
            </span>
          ))}
        </p>
        <p className="brief-footer__love">With love from a PNU student, for PNU students</p>
      </footer>
    </div>
  );
}

function TodoItem({ task, now, onToggle }: { task: Task; now: number; onToggle: (id: string) => void }) {
  const done = task.status === "completed";
  const overdue = !done && task.dueDate < now;
  const src = sourceName(task);
  return (
    <div className={cn("brief-todo", done && "is-done")}>
      <button
        role="checkbox"
        aria-checked={done}
        onClick={() => onToggle(task.id)}
        className="brief-check"
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      >
        {done && <Check size={14} strokeWidth={3.5} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="brief-todo__label">{task.title}</p>
        <p className="brief-todo__ctx">
          {[src, task.course && task.course !== "General" && task.course !== "NESPA" ? task.course : null, formatDue(task.dueDate, now)].filter(Boolean).join(" · ")}
          {overdue && <span className="text-signal font-semibold"> · overdue</span>}
        </p>
      </div>
      {task.url && (
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="p-1 text-muted-foreground hover:text-primary" aria-label={`Open "${task.title}"`}>
          <ExternalLink size={15} />
        </a>
      )}
    </div>
  );
}

export function TaskRow({ task, now, onToggle }: { task: Task; now: number; onToggle: (id: string) => void }) {
  const overdue = task.status === "pending" && task.dueDate < now;
  const soon = task.status === "pending" && !overdue && task.dueDate - now < DAY;
  const done = task.status === "completed";
  return (
    <li className={cn("stop", done && "is-done")}>
      <button onClick={() => onToggle(task.id)} aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`} className="stop__marker">
        {done && <Check size={13} strokeWidth={3.5} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn("font-semibold text-foreground leading-snug truncate", done && "line-through text-muted-foreground font-normal")}>{task.title}</p>
        <p className="text-[13px] text-muted-foreground mt-0.5 truncate">
          {sourceName(task) ? `${sourceName(task)} · ` : ""}
          {task.course && task.course !== "General" && task.course !== "NESPA" ? `${task.course} · ` : ""}
          {formatDue(task.dueDate, now)}
        </p>
      </div>
      {task.url && (
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md text-muted-foreground hover:text-primary" aria-label={`Open "${task.title}"`}>
          <ExternalLink size={15} />
        </a>
      )}
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
    <div className="rounded-[16px] bg-accent/60 p-4 flex flex-col gap-1.5">
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <button onClick={onClick} className="cozy-btn bg-primary text-primary-foreground font-semibold text-sm px-3.5 py-2 self-start mt-2">
        {cta}
      </button>
    </div>
  );
}
