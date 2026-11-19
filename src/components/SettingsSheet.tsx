"use client";

import { useState } from "react";
import { Bell, BookOpen, Download, ExternalLink, KeyRound, LogOut, Palette, RefreshCw, Send, Share, ShieldCheck, Smartphone, SquarePlus } from "lucide-react";
import { cn, Sheet, Switch } from "./ui";
import { isIOS, isStandalone, pushSupport, sendTest } from "@/lib/client/push";
import { relative } from "@/lib/client/time";
import { THEMES, type AlertCategories, type OwnerData, type OwnerSource, type Theme } from "@/lib/client/types";

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
  isOwner: boolean;
  ownerData: OwnerData | null;
  ownerActions: {
    unlock: (key: string) => Promise<"ok" | "wrong-key" | "locked" | "not-configured" | "error">;
    lock: () => Promise<void>;
    syncNow: () => Promise<boolean>;
  };
};

const ALERT_ROWS: { key: keyof AlertCategories; title: string; body: string }[] = [
  { key: "cse", title: "CSE notices", body: "New posts on the 정보컴퓨터공학부 board" },
  { key: "international", title: "International notices", body: "New posts on the 국제처 board" },
  { key: "tasks", title: "Deadline reminders", body: "24 hours and 1 hour before your tasks are due" },
];

const COURSE_ROW = { key: "courses" as const, title: "PLATO & NESPA posts", body: "New course announcements and NESPA notices (owner only)" };

export function SettingsSheet(p: Props) {
  const [busy, setBusy] = useState<keyof AlertCategories | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const support = pushSupport();
  const anyOn = p.alerts.cse || p.alerts.international || p.alerts.tasks || p.alerts.courses;
  const rows = p.isOwner ? [...ALERT_ROWS, COURSE_ROW] : ALERT_ROWS;

  const toggle = async (key: keyof AlertCategories, value: boolean) => {
    setBusy(key);
    setMessage(null);
    try {
      await p.changeAlerts({ [key]: value });
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
            <p className="text-sm font-bold text-muted-foreground bg-muted rounded-lg p-3">{unsupportedText}</p>
          ) : (
            <ul className="flex flex-col divide-y-2 divide-dashed divide-border/20">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-bold text-foreground">{row.title}</p>
                    <p className="text-sm text-muted-foreground">{row.body}</p>
                  </div>
                  <Switch
                    label={row.title}
                    checked={p.alerts[row.key]}
                    disabled={!p.alertsReady || busy !== null}
                    onChange={(v) => toggle(row.key, v)}
                  />
                </li>
              ))}
            </ul>
          )}
          {anyOn && support.ok && (
            <button onClick={test} disabled={busy !== null} className="mt-2 text-sm font-bold text-primary flex items-center gap-1.5 hover:underline disabled:opacity-50">
              <Send size={14} /> Send me a test alert
            </button>
          )}
          {message && (
            <p role="status" className="mt-2 text-sm font-bold text-foreground">
              {message}
            </p>
          )}
        </section>

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
              <ol className="text-sm text-foreground flex flex-col gap-2 list-decimal pl-5 font-bold">
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
              <p className="text-sm text-muted-foreground font-bold">
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
                  "flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-extrabold",
                  p.theme === t.id ? "border-border bg-card shadow-[2px_2px_0px_var(--color-border)] text-foreground" : "border-border/30 text-muted-foreground",
                )}
              >
                <span className="w-4 h-4 rounded-full border-2 border-border" style={{ background: t.swatch }} aria-hidden />
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
            <li>Your tasks and read notices stay in this browser.</li>
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
            className="mt-3 text-sm font-bold text-[#E5484D] hover:underline"
          >
            Delete all my data on this device
          </button>
        </section>

        <p className="text-xs text-muted-foreground font-bold flex flex-wrap gap-x-3 gap-y-1 border-t-2 border-dashed border-border/20 pt-4">
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
      <ul className="text-sm font-bold text-foreground flex flex-col gap-1.5 mb-3">
        <li>
          {line(
            "PLATO",
            plato,
            `${plato?.data?.name ?? ""} · ${plato?.data?.courses.length ?? 0} courses · ${plato?.data?.deadlines.length ?? 0} upcoming deadlines`,
          )}
        </li>
        <li>
          {line(
            "NESPA",
            nespa,
            `${nespa?.data?.assignments.length ?? 0} assignments · ${nespa?.data?.loggedIn ? "scores included" : "public list only (no scores)"}`,
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
          className="cozy-btn bg-card px-3 py-2 text-sm font-extrabold flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Sync now
        </button>
        <button
          onClick={() => {
            if (window.confirm("Sign this device out of owner mode? PLATO and NESPA will disappear from it.")) actions.lock();
          }}
          className="cozy-btn bg-card px-3 py-2 text-sm font-extrabold flex items-center gap-1.5 text-[#E5484D]"
        >
          <LogOut size={15} /> Sign out this device
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2 text-sm font-bold">
          {note}
        </p>
      )}
    </section>
  );
}

function OwnerSignIn({ unlock }: { unlock: Props["ownerActions"]["unlock"] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="self-start -mt-4 text-xs font-bold text-muted-foreground/70 hover:text-foreground flex items-center gap-1">
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
      <label className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider" htmlFor="owner-key">
        Owner key
      </label>
      <div className="flex gap-2">
        <input
          id="owner-key"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 min-w-0 rounded-xl border-2 border-border bg-background px-3 py-2 text-sm"
        />
        <button disabled={busy || key.length === 0} className="cozy-btn bg-primary text-primary-foreground px-3 py-2 text-sm font-extrabold disabled:opacity-50">
          Sign in
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm font-bold">
          {note}
        </p>
      )}
    </form>
  );
}
