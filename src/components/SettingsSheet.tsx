"use client";

import { useState } from "react";
import { Bell, Download, ExternalLink, Palette, Send, Share, ShieldCheck, Smartphone, SquarePlus } from "lucide-react";
import { cn, Sheet, Switch } from "./ui";
import { isIOS, isStandalone, pushSupport, sendTest } from "@/lib/client/push";
import { THEMES, type AlertCategories, type Theme } from "@/lib/client/types";

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
};

const ALERT_ROWS: { key: keyof AlertCategories; title: string; body: string }[] = [
  { key: "cse", title: "CSE notices", body: "New posts on the 정보컴퓨터공학부 board" },
  { key: "international", title: "International notices", body: "New posts on the 국제처 board" },
  { key: "tasks", title: "Deadline reminders", body: "24 hours and 1 hour before your tasks are due" },
];

export function SettingsSheet(p: Props) {
  const [busy, setBusy] = useState<keyof AlertCategories | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const support = pushSupport();
  const anyOn = p.alerts.cse || p.alerts.international || p.alerts.tasks;

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
              {ALERT_ROWS.map((row) => (
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
                  "flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-pixel text-xs font-bold",
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
      </div>
    </Sheet>
  );
}
