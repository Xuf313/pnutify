"use client";

import { useState } from "react";
import { Bell, BookOpen, CircleCheck, Copy, Link2, Newspaper, Download, ExternalLink, KeyRound, LogOut, Palette, RefreshCw, Send, Share, ShieldCheck, Smartphone, SquarePlus, Stethoscope, TriangleAlert } from "lucide-react";
import { cn, Sheet, Switch } from "./ui";
import { anyAlertOn, isIOS, isStandalone, pushSupport, sendTest } from "@/lib/client/push";
import { formatDue, relative } from "@/lib/client/time";
import { fetchAlertStatus, type AlertStatus } from "@/lib/client/owner";
import { BOARDS, THEMES, type AlertCategories, type BoardInfo, type NoticeSource, type OwnerData, type OwnerSource, type Theme } from "@/lib/client/types";
import { BoardPicker } from "./BoardPicker";

export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

type Props = {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  alerts: AlertCategories;
  alertsReady: boolean;
  changeAlerts: (patch: Partial<AlertCategories>) => Promise<AlertCategories>;
  installPrompt: InstallPrompt | null;
  clearInstallPrompt: () => void;
  /** Boards this device shows. */
  boards: NoticeSource[];
  setBoards: (b: NoticeSource[]) => void;
  syncCode: string | null;
  syncActions: {
    create: () => Promise<string | null>;
    join: (code: string) => Promise<"ok" | "unknown" | "error">;
    leave: () => void;
    wipe: () => Promise<void>;
  };
  isOwner: boolean;
  ownerData: OwnerData | null;
  ownerActions: {
    unlock: (key: string) => Promise<"ok" | "wrong-key" | "locked" | "not-configured" | "error">;
    lock: () => Promise<void>;
    syncNow: () => Promise<boolean>;
  };
};

type Toggle = "tasks" | "weekly" | "courses";
/** A switch: one of the plain toggles, or a board. */
type AlertRow = { key: string; title: string; body: string; checked: (a: AlertCategories) => boolean; patch: (a: AlertCategories, on: boolean) => Partial<AlertCategories> };
const toggleRow = (key: Toggle, title: string, body: string): AlertRow => ({ key, title, body, checked: (a) => a[key], patch: (_, on) => ({ [key]: on }) });
const TASK_ROW = toggleRow("tasks", "Deadline reminders", "24 hours and 1 hour before your tasks are due");
const WEEKLY_ROW = toggleRow("weekly", "Weekly preview", "Sunday at 8 pm: the coming week's deadlines, day by day");
const COURSE_ROW = toggleRow("courses", "PLATO & NESPA posts", "New course announcements and NESPA notices (owner only)");
const boardRow = (b: BoardInfo): AlertRow => ({
  key: `board:${b.id}`,
  title: b.core ? `${b.label} notices` : b.name,
  body: b.core ? `New posts on the ${b.name} board` : `New posts on the ${b.college} · ${b.name} board`,
  checked: (a) => a.boards.includes(b.id),
  patch: (a, on) => ({ boards: on ? [...a.boards.filter((x) => x !== b.id), b.id] : a.boards.filter((x) => x !== b.id) }),
});

export function SettingsSheet(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const support = pushSupport();
  const anyOn = anyAlertOn(p.alerts);
  // One switch per board this device shows, then deadlines (and course posts for the owner).
  const rows: AlertRow[] = [...BOARDS.filter((b) => p.boards.includes(b.id)).map(boardRow), TASK_ROW, WEEKLY_ROW, ...(p.isOwner ? [COURSE_ROW] : [])];

  const toggle = async (row: AlertRow, value: boolean) => {
    setBusy(row.key);
    setMessage(null);
    try {
      await p.changeAlerts(row.patch(p.alerts, value));
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMessage(
        m === "permission-denied"
          ? "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again."
          : "Couldn't save that. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setMessage(null);
    const ok = await sendTest().catch(() => false);
    setMessage(ok ? "Sent. It should arrive in a few seconds." : "Couldn't send a test right now. Try again in a minute.");
    setBusy(null);
  };

  const unsupportedText =
    !support.ok &&
    {
      "ios-not-installed": "On iPhone and iPad, alerts only work after you add PNUtify to your home screen (see below), then open it from there.",
      unsupported: "This browser doesn't support notifications. Try Chrome, Edge, Firefox or Safari 16.4+.",
      "not-configured": "Alerts aren't set up on this server yet.",
      denied: "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.",
    }[support.reason];

  return (
    <Sheet open={p.open} onClose={p.onClose} title="Settings">
      <div className="flex flex-col gap-7">
        {/* ---------- alerts ---------- */}
        <section>
          <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-3">
            <Bell size={18} className="text-primary" /> Alerts
          </h3>
          {unsupportedText ? (
            <p className="text-sm font-semibold text-muted-foreground bg-muted rounded-lg p-3">{unsupportedText}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold text-foreground">{row.title}</p>
                    <p className="text-sm text-muted-foreground">{row.body}</p>
                  </div>
                  <Switch
                    label={row.title}
                    checked={row.checked(p.alerts)}
                    disabled={!p.alertsReady || busy !== null}
                    onChange={(v) => toggle(row, v)}
                  />
                </li>
              ))}
            </ul>
          )}
          {anyOn && support.ok && (
            <button onClick={test} disabled={busy !== null} className="mt-2 text-sm font-semibold text-primary flex items-center gap-1.5 hover:underline disabled:opacity-50">
              <Send size={14} /> Send me a test alert
            </button>
          )}
          {message && (
            <p role="status" className="mt-2 text-sm font-semibold text-foreground">
              {message}
            </p>
          )}
        </section>

        {/* ---------- boards ---------- */}
        <section>
          <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-1">
            <Newspaper size={18} className="text-primary" /> Boards
          </h3>
          <p className="text-sm text-muted-foreground mb-2">Choose which notice boards show up in PNUtify on this device.</p>
          <BoardPicker boards={p.boards} setBoards={p.setBoards} />
        </section>

        {/* ---------- sync across devices (owner devices already sync) ---------- */}
        {!p.isOwner && <SyncSection code={p.syncCode} actions={p.syncActions} />}

        {/* ---------- PLATO + NESPA (owner devices only) ---------- */}
        {p.isOwner && <OwnerSection data={p.ownerData} actions={p.ownerActions} />}

        {/* ---------- install ---------- */}
        {!isStandalone() && (
          <section>
            <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-3">
              <Smartphone size={18} className="text-primary" /> Add to home screen
            </h3>
            {p.installPrompt ? (
              <button
                onClick={async () => {
                  await p.installPrompt?.prompt();
                  p.clearInstallPrompt();
                }}
                className="cozy-btn bg-primary text-primary-foreground font-pixel font-bold px-4 py-2.5 flex items-center gap-2"
              >
                <Download size={16} /> Install PNUtify
              </button>
            ) : isIOS() ? (
              <ol className="text-sm text-foreground flex flex-col gap-2 list-decimal pl-5 font-semibold">
                <li>
                  Open this page in <b>Safari</b>.
                </li>
                <li className="flex-wrap">
                  Tap <Share size={14} className="inline -mt-1" /> <b>Share</b> at the bottom of the screen.
                </li>
                <li>
                  Choose <SquarePlus size={14} className="inline -mt-1" /> <b>Add to Home Screen</b>, then open PNUtify from your home screen.
                </li>
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground font-semibold">
                In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.
              </p>
            )}
          </section>
        )}

        {/* ---------- theme ---------- */}
        <section>
          <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-3">
            <Palette size={18} className="text-primary" /> Theme
          </h3>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => p.setTheme(t.id)}
                aria-pressed={p.theme === t.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold",
                  p.theme === t.id ? "border-border bg-card text-foreground" : "border-border text-muted-foreground",
                )}
              >
                <span className="w-4 h-4 rounded-full border border-border" style={{ background: t.swatch }} aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section>
          <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-3">
            <ShieldCheck size={18} className="text-primary" /> Privacy
          </h3>
          <ul className="text-sm text-muted-foreground flex flex-col gap-1.5 list-disc pl-5">
            <li>No account and no PLATO password. PNUtify never asks for your student login.</li>
            <li>Your tasks and read notices stay in this browser, unless you turn on sync. Then a copy is kept on the server under your sync code, and only devices with that code can read it.</li>
            <li>If deadline reminders are on, the titles and due times of your upcoming tasks are stored on the server only to send those reminders.</li>
          </ul>
          <button
            onClick={() => {
              if (!window.confirm("Delete your tasks, read history and settings from this device?")) return;
              try {
                localStorage.clear();
              } catch {}
              window.location.reload();
            }}
            className="mt-3 text-sm font-semibold text-[#E5484D] hover:underline"
          >
            Delete all my data on this device
          </button>
        </section>

        <p className="text-xs text-muted-foreground font-semibold flex flex-wrap gap-x-3 gap-y-1 border-t-2 border-border pt-4">
          <span>Made by a PNU student for PNU students.</span>
          <a href="https://github.com/Xuf313/pnutify/issues/new" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
            Send feedback <ExternalLink size={11} />
          </a>
        </p>
        {!p.isOwner && <OwnerSignIn unlock={p.ownerActions.unlock} />}
      </div>
    </Sheet>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function OwnerSection({ data, actions }: { data: OwnerData | null; actions: Props["ownerActions"] }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Shown when the sheet opens; refreshed by the page's own clock on the next render.
  const [now] = useState(() => Date.now());
  const line = (label: string, src: OwnerSource<unknown> | undefined, detail: string) =>
    !src?.configured ? `${label}: not set up (add its ID and password in Vercel)` : src.ok ? `${label}: ${detail}` : `${label}: ${src.error ?? "error"}`;
  const plato = data?.plato;
  const nespa = data?.nespa;
  return (
    <section>
      <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-3">
        <BookOpen size={18} className="text-primary" /> PLATO & NESPA
      </h3>
      <p className="text-sm text-muted-foreground mb-2">This device is signed in as the owner. Only owner devices can see this.</p>
      <ul className="text-sm font-semibold text-foreground flex flex-col gap-1.5 mb-3">
        <li>
          {line(
            "PLATO",
            plato,
            `${plato?.data?.name ?? ""} · ${count(plato?.data?.courses.length ?? 0, "course")} · ${count(plato?.data?.deadlines.length ?? 0, "upcoming deadline")}`,
          )}
        </li>
        <li>
          {line(
            "NESPA",
            nespa,
            `${count(nespa?.data?.assignments.length ?? 0, "assignment")} · ${nespa?.data?.loggedIn ? "scores included" : "public list only (no scores)"}`,
          )}
        </li>
        <li className="text-muted-foreground">Last checked {data?.checkedAt ? relative(data.checkedAt, now) : "never"} · refreshes every 20 minutes</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote(null);
            const throttled = await actions.syncNow().catch(() => false);
            setNote(throttled ? "Synced less than a minute ago. Try again shortly." : "Synced.");
            setBusy(false);
          }}
          className="cozy-btn bg-card px-3 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Sync now
        </button>
        <button
          onClick={() => {
            if (window.confirm("Sign this device out of owner mode? PLATO and NESPA will disappear from it.")) actions.lock();
          }}
          className="cozy-btn bg-card px-3 py-2 text-sm font-semibold flex items-center gap-1.5 text-[#E5484D]"
        >
          <LogOut size={15} /> Sign out this device
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2 text-sm font-semibold">
          {note}
        </p>
      )}
      <AlertsCheck />
    </section>
  );
}

type Line = { ok: boolean; text: string; fix?: string };

/** Owner-only: answers "why didn't I get an alert?" for this device. */
function AlertsCheck() {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const run = async () => {
    setState("loading");
    const s = await fetchAlertStatus();
    setStatus(s);
    setState(s ? "idle" : "error");
  };

  const lines: Line[] = [];
  if (status) {
    const { now, device: d } = status;
    const ago = (t: number | null) => (t ? relative(t, now) : "never");
    const cronOk = status.lastDeadlineCheckAt !== null && now - status.lastDeadlineCheckAt < 15 * 60_000;
    lines.push(
      cronOk
        ? { ok: true, text: `The scheduled check is running (deadlines checked ${ago(status.lastDeadlineCheckAt)}).` }
        : {
            ok: false,
            text: `Deadlines were last checked ${ago(status.lastDeadlineCheckAt)}. Reminders are only sent when the scheduled check runs.`,
            fix: "Set up the cron-job.org schedule from the README (every 1–2 minutes), and check its history for errors.",
          },
    );
    lines.push(
      d.subscribed && d.inSendList
        ? { ok: true, text: "This device is subscribed to alerts." }
        : { ok: false, text: "This device isn't subscribed to alerts.", fix: "Turn on an alert above. On iPhone, do it in the home-screen app, not in Safari." },
    );
    lines.push(
      d.categories.tasks
        ? { ok: true, text: "Deadline reminders are on for this device." }
        : { ok: false, text: "Deadline reminders are off for this device.", fix: "Turn on Deadline reminders above." },
    );
    lines.push(
      d.ownerDevice
        ? { ok: true, text: "This device is registered as an owner device, so PLATO and NESPA deadlines get reminders here." }
        : {
            ok: false,
            text: "This device isn't registered as an owner device, so PLATO and NESPA deadlines aren't sent here.",
            fix: "Tap Sign out this device above, then sign in again here with your owner key.",
          },
    );
    if (d.lastPush) {
      lines.push(
        d.lastPush.ok
          ? { ok: true, text: `Last alert to this device: "${d.lastPush.title}", ${ago(d.lastPush.at)}. It was accepted for delivery.` }
          : {
              ok: false,
              text: `Last alert to this device ("${d.lastPush.title}", ${ago(d.lastPush.at)}) was rejected${d.lastPush.status ? ` (${d.lastPush.status})` : ""}.`,
              fix:
                d.lastPush.status === 403
                  ? "The server's alert keys don't match this subscription. Turn all alerts off and on again here."
                  : "Turn all alerts off and on again here, then send a test alert.",
            },
      );
    } else {
      lines.push({ ok: true, text: "No alert has been sent to this device yet." });
    }
  }

  const reminderText = (sent: boolean, at: number, now: number) =>
    sent ? "sent" : at <= now ? "due at the next check" : `in ${relative(at, now).replace(/^in /, "")}`;

  return (
    <div className="mt-4 border-t-2 border-border pt-3">
      <button onClick={run} disabled={state === "loading"} className="text-sm font-semibold text-primary flex items-center gap-1.5 hover:underline disabled:opacity-50">
        <Stethoscope size={15} /> {state === "loading" ? "Checking…" : status ? "Check alerts again" : "Why didn't I get an alert? Check now"}
      </button>
      {state === "error" && <p className="mt-2 text-sm font-semibold text-[#E5484D]">Couldn&apos;t run the check. Try again in a moment.</p>}
      {status && (
        <div className="mt-3 flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.text} className="flex gap-2 text-sm">
                {l.ok ? <CircleCheck size={16} className="text-secondary shrink-0 mt-0.5" /> : <TriangleAlert size={16} className="text-[#E5484D] shrink-0 mt-0.5" />}
                <span>
                  <span className="font-semibold text-foreground">{l.text}</span>
                  {l.fix && <span className="block text-muted-foreground font-semibold">{l.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
          {status.upcoming.length > 0 && (
            <div className="mt-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Next reminders for this device</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {status.upcoming.map((u) => (
                  <li key={u.id} className="font-semibold">
                    {u.title} <span className="text-muted-foreground">({u.source}, due {formatDue(u.dueAt, status.now)})</span>
                    <span className="block text-xs text-muted-foreground">
                      24 h reminder: {reminderText(u.sent24, u.at24, status.now)} · 1 h reminder: {reminderText(u.sent1, u.at1, status.now)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OwnerSignIn({ unlock }: { unlock: Props["ownerActions"]["unlock"] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="self-start -mt-4 text-xs font-semibold text-muted-foreground/70 hover:text-foreground flex items-center gap-1">
        <KeyRound size={12} /> Owner sign-in
      </button>
    );
  }
  return (
    <form
      className="-mt-3 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNote(null);
        const r = await unlock(key);
        setBusy(false);
        if (r === "ok") {
          setKey("");
          setNote("Signed in. PLATO and NESPA will appear in a moment.");
        } else {
          setNote(
            r === "wrong-key"
              ? "That key isn't right."
              : r === "locked"
                ? "Too many wrong tries. Wait 15 minutes."
                : r === "not-configured"
                  ? "Owner mode isn't set up on the server (OWNER_SECRET)."
                  : "Couldn't reach the server. Try again.",
          );
        }
      }}
    >
      <label className="text-xs font-semibold text-muted-foreground" htmlFor="owner-key">
        Owner key
      </label>
      <div className="flex gap-2">
        <input
          id="owner-key"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
        <button disabled={busy || key.length === 0} className="cozy-btn bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-50">
          Sign in
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm font-semibold">
          {note}
        </p>
      )}
    </form>
  );
}

function SyncSection({ code, actions }: { code: string | null; actions: Props["syncActions"] }) {
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const [input, setInput] = useState("");
  const [shown, setShown] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setNote("Copied. Enter it on your other device: Settings → Sync across devices → Enter a code.");
    } catch {
      setShown(true);
    }
  };

  return (
    <section>
      <h3 className="flex items-center gap-2 font-pixel font-bold text-foreground mb-1">
        <Link2 size={18} className="text-primary" /> Sync across devices
      </h3>
      {code ? (
        <>
          <p className="text-sm text-muted-foreground mb-2">Your tasks and read notices sync with every device that uses this code.</p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <code className="rounded-lg bg-muted px-2.5 py-1.5 text-sm font-semibold text-foreground" aria-label="Your sync code">
              {shown ? code : code.replace(/[^-]/g, "•")}
            </code>
            <button onClick={() => setShown((v) => !v)} className="text-sm font-semibold text-primary hover:underline">
              {shown ? "Hide" : "Show"}
            </button>
            <button onClick={copy} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
              <Copy size={14} /> Copy
            </button>
          </div>
          <p className="text-xs font-semibold text-muted-foreground mb-3">Anyone with this code can see and change your tasks. Don&apos;t share it with anyone else.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button onClick={actions.leave} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
              Stop syncing on this device
            </button>
            <button
              onClick={async () => {
                if (!window.confirm("Delete the synced copy? Your other devices will stop syncing too. Each keeps its own data.")) return;
                await actions.wipe();
              }}
              className="text-sm font-semibold text-[#E5484D] hover:underline"
            >
              Delete synced data
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-3">Keep your tasks and read notices the same on your phone and laptop. No account needed: you get a code to enter on your other device.</p>
          {entering ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setNote(null);
                const r = await actions.join(input);
                setBusy(false);
                if (r === "ok") {
                  setEntering(false);
                  setInput("");
                  setNote("Linked. This device now syncs.");
                } else setNote(r === "unknown" ? "That code doesn't exist. Check it and try again." : "Couldn't reach the server. Try again.");
              }}
            >
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="sync-code">
                Sync code from your other device
              </label>
              <div className="flex gap-2">
                <input
                  id="sync-code"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
                />
                <button disabled={busy || input.replace(/[\s-]/g, "").length < 20} className="cozy-btn bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-50">
                  Link
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setNote(null);
                  const made = await actions.create();
                  setBusy(false);
                  if (made) setShown(true);
                  else setNote("Couldn't create a code right now. Try again.");
                }}
                className="cozy-btn bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Create a sync code
              </button>
              <button onClick={() => setEntering(true)} className="cozy-btn bg-card px-3 py-2 text-sm font-semibold">
                Enter a code
              </button>
            </div>
          )}
        </>
      )}
      {note && (
        <p role="status" className="mt-2 text-sm font-semibold">
          {note}
        </p>
      )}
    </section>
  );
}
