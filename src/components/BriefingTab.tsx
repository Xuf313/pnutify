"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight, BellRing, Check, ExternalLink, Smartphone, TriangleAlert } from "lucide-react";
import { cn, DdaySticker } from "./ui";
import { addDays, formatDate, formatDue, fromKst, greeting, kstDay, kstHour, relative } from "@/lib/client/time";
import { isIOS, isStandalone } from "@/lib/client/push";
import { paintingCaption, paintingOfTheDay } from "@/lib/client/paintings";
import type { AlertCategories, CoursePost, Notice, OwnerData, Tab, Task } from "@/lib/client/types";
import { boardInfo, SOURCE_LABEL } from "@/lib/client/types";
import { BoardIcon } from "./BoardIcon";
import { isFreshNotice } from "@/lib/client/notices";
import { classDigest, classSentence, summarize } from "@/lib/client/classSummary";

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

  // ---------- class announcements (owner: PLATO course news and NESPA notices) ----------
  const hasClasses = Boolean(p.ownerData && (p.ownerData.plato.configured || p.ownerData.nespa.configured));
  const classes = useMemo(() => classDigest(p.posts, now), [p.posts, now]);

  // ---------- the blurb under the painting ----------
  const parts: string[] = [];
  if (overdue.length) parts.push(`${plural(overdue.length, "task")} overdue`);
  if (dueToday.length) parts.push(`${plural(dueToday.length, "deadline")} today`);
  if (freshNotices.length) parts.push(plural(freshNotices.length, "new notice"));
  const dayLine =
    parts.length === 0
      ? thisWeek.length
        ? `Nothing due today, and ${plural(thisWeek.length, "deadline")} later this week. A good day to get ahead.`
        : "Nothing due and nothing new. Today is yours to spend however you like."
      : `${greeting(now)}. You have ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
  // Classes always get a line of their own, even in a quiet week.
  const blurb = hasClasses ? `${dayLine} ${classSentence(classes)}` : dayLine;

  // ---------- "Push your work forward" ----------
  const openTask = (t: Task) => () => (t.url ? window.open(t.url, "_blank", "noopener,noreferrer") : p.goTo("tasks"));
  const nextUp = overdue[0] ?? pending.find((t) => t.dueDate >= now && t.dueDate < now + 2 * DAY);
  const push: Push | null = nextUp
    ? {
        label: nextUp.dueDate < now ? "Catch up" : "Next deadline",
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
    const fromNotices: Update[] = freshNotices.map((n) => ({
      id: n.id,
      title: n.title,
      tag: SOURCE_LABEL[n.source],
      tone: "primary",
      text: `${boardInfo(n.source)?.name ?? "PNU"} · posted ${n.date}`,
      at: n.firstSeenAt,
      url: n.url,
      source: n.source,
      open: () => p.onOpenNotice(n.id),
    }));
    return fromNotices.sort((a, b) => b.at - a.at).slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshNotices]);

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
  const maxCount = Math.max(1, ...week.map((w) => w.count));

  const alertsOff = p.alertsReady && p.alerts.boards.length === 0 && !p.alerts.tasks;
  const showInstall = !isStandalone() && (p.canInstall || isIOS());

  const painting = paintingOfTheDay(now);
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const weekday = formatDate(now, { weekday: "long" });
  // "19 NOV 2026", in Korea time.
  const edgeDate = formatDate(now, { year: "numeric", month: "long", day: "numeric" });

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
      {/* A newspaper clipping taped into the notebook */}
      <header className="brief-clip">
        <span className="tape tape--l" aria-hidden />
        <span className="tape tape--r" aria-hidden />
        <p className="brief-dateline">
          <span>{edgeDate}</span>
          <span>Pusan National University</span>
        </p>
        <span className="brief-the brief-day-kicker">The</span>
        <h1 className="brief-day">{weekday} Brief</h1>
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
          </div>
        </figure>
        <p className="brief-caption">{paintingCaption(painting)}</p>
        <p className="brief-blurb">{blurb}</p>
      </header>

      {problems.map((msg) => (
        <p key={msg} className="mt-4 text-xs font-bold text-[#E5484D] flex items-start gap-1.5">
          <TriangleAlert size={14} className="shrink-0 mt-px" /> {msg}
        </p>
      ))}

      {/* ---------- push your work forward ---------- */}
      {push && (
        <section className="brief-push" aria-label="Push your work forward">
          <div className="flex-1 min-w-0">
            <p className="brief-push__label">Push your work forward · {push.label}</p>
            <h2 className="brief-push__topic">{push.topic}</h2>
            <p className="brief-push__text">{push.text}</p>
          </div>
          <button onClick={push.act} className="brief-star" aria-label={`${push.cta}: ${push.topic}`}>
            <span>
              {push.cta}
              <br />→
            </span>
          </button>
        </section>
      )}

      {/* ---------- from your classes: always there, even in a quiet week ---------- */}
      {hasClasses && (
        <section className="brief-section" aria-labelledby="brief-classes">
          <h2 id="brief-classes" className="brief-h2">
            From your classes
            <small>{classes.week.length > 0 ? `${plural(classes.week.length, "announcement")} this week` : "nothing new this week"}</small>
          </h2>
          {classes.byCourse.length > 1 && (
            <p className="brief-class__digest">
              {classes.byCourse.map(([course, n]) => (
                <span key={course} className="brief-tag brief-tag--secondary">
                  {course} {n}
                </span>
              ))}
            </p>
          )}
          {classes.week.length === 0 ? (
            <p className="mx-1 text-sm font-bold text-muted-foreground">
              No new announcements from your classes this week.
              {classes.latest && (
                <>
                  {" "}
                  The last one:{" "}
                  <button onClick={() => p.onOpenPost(classes.latest!)} className="text-primary hover:underline">
                    {classes.latest.title}
                  </button>{" "}
                  ({classes.latest.course}, {relative(classes.latest.postedAt ?? now, now)}).
                </>
              )}
            </p>
          ) : (
            <div>
              {classes.week.slice(0, 5).map((x) => {
                const read = p.readIds.has(x.id);
                const summary = summarize(x.excerpt);
                return (
                  <article key={x.id} className={cn("brief-class", read && "is-read")}>
                    <p className="brief-class__meta">
                      <span className="brief-tag brief-tag--secondary">{x.course || x.source}</span>
                      <span>{x.postedAt ? relative(x.postedAt, now) : ""}</span>
                      {!read && <span className="dday dday--soon brief-class__new">NEW</span>}
                    </p>
                    <h3 className="brief-item__title">
                      <button onClick={() => p.onOpenPost(x)} className="text-left">
                        {x.title}
                      </button>
                    </h3>
                    {summary && <p className="brief-class__summary">{summary}</p>}
                  </article>
                );
              })}
              {classes.week.length > 5 && <p className="mx-1 mt-1 text-sm font-bold text-muted-foreground">and {plural(classes.week.length - 5, "more")} this week</p>}
            </div>
          )}
        </section>
      )}

      <div className="brief-cols">
      <div>
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
              <button onClick={() => p.goTo("tasks")} className="mt-2 ml-1 text-sm font-bold text-primary flex items-center gap-1 hover:underline">
                {plural(pending.length - todos.length, "more task")} <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : doneToday.length > 0 ? (
          <div className="brief-alldone">
            <p className="text-3xl" aria-hidden>
              🎉
            </p>
            <h3>You completed all your to-dos!</h3>
            <p className="text-sm font-bold text-muted-foreground mt-1">Nice work. The day is yours.</p>
          </div>
        ) : (
          <p className="mx-1 text-sm font-bold text-muted-foreground">
            Nothing due this week.{" "}
            <button onClick={() => p.goTo("tasks")} className="text-primary hover:underline">
              Add an assignment or exam
            </button>{" "}
            and you&apos;ll get a reminder before it&apos;s due.
          </p>
        )}
      </section>

      </div>
      {/* ---------- new updates ---------- */}
      <section className="brief-section">
        <h2 className="brief-h2">New updates</h2>
        {updates.length === 0 ? (
          <p className="mx-1 text-sm font-bold text-muted-foreground">
            You&apos;re all caught up.{" "}
            <button onClick={() => p.goTo("notices")} className="text-primary hover:underline">
              See all notices
            </button>
          </p>
        ) : (
          <div>
            {updates.map((u, i) => (
              <article key={u.id} className="brief-item">
                <span className="brief-item__num">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h3 className="brief-item__title">
                    <button onClick={u.open} className="text-left">
                      {u.title}
                    </button>
                    <span className={cn("brief-tag", u.tone === "primary" && "brief-tag--primary", u.tone === "secondary" && "brief-tag--secondary")}>{u.tag}</span>
                  </h3>
                  <p className="brief-item__text">
                    {u.text}
                    {u.url && (
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brief-source"
                        style={{ ["--tilt" as string]: `${(i % 3) - 1.5}deg` }}
                        aria-label={`Open "${u.title}" on the original site`}
                      >
                        {u.source ? <BoardIcon source={u.source} size={11} /> : <ExternalLink size={11} />}
                      </a>
                    )}
                  </p>
                </div>
              </article>
            ))}
            <button onClick={() => p.goTo("notices")} className="mt-1 ml-1 text-sm font-bold text-primary flex items-center gap-1 hover:underline">
              All notices <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>

      </div>

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
        <div className="cozy-card bg-card p-3 grid grid-cols-7 gap-1 text-center">
          {week.map((w, i) => (
            <button
              key={w.day}
              onClick={() => p.goTo("calendar")}
              className={cn("flex flex-col items-center gap-1 py-1.5 rounded-lg", i === 0 && "bg-muted")}
              aria-label={`${w.label}: ${plural(w.count, "deadline")}`}
            >
              <span className="text-[11px] font-bold text-muted-foreground">{w.label}</span>
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
              <span className="brief-footer__src" style={{ ["--tilt" as string]: `${(i % 2 ? 1 : -1) * 0.8}deg` }}>
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
          {overdue && <span className="text-[#E5484D]"> · overdue</span>}
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
        <DdaySticker due={task.dueDate} now={now} />
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
      <button onClick={onClick} className="cozy-btn bg-primary text-primary-foreground font-extrabold text-sm px-3 py-2 self-start mt-1">
        {cta}
      </button>
    </div>
  );
}
