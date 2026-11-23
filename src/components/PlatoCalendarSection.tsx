"use client";

import { useState } from "react";
import { CalendarClock, ExternalLink, RefreshCw, Unlink } from "lucide-react";
import { relative } from "@/lib/client/time";
import { PLATO_EXPORT_PAGE, type CalendarView, type LinkError } from "@/lib/client/platoCalendar";

export type CalendarActions = {
  link: (url: string) => Promise<{ ok: true; calendar: CalendarView } | { ok: false; error: LinkError }>;
  refresh: () => Promise<boolean>;
  unlink: () => Promise<void>;
};

const ERRORS: Record<LinkError, string> = {
  "invalid-link": "That isn't a PLATO calendar link. Use 달력 URL 가져옴 and copy the whole link.",
  rejected: "PLATO didn't accept that link. Get a fresh one with 달력 URL 가져옴.",
  unreachable: "PLATO didn't respond. Try again in a minute.",
  "too-many-tries": "Too many tries. Wait an hour, then try again.",
  "not-configured": "PLATO linking isn't set up on this server yet.",
  error: "Couldn't link. Check your connection and try again.",
};

/** Settings → PLATO deadlines: link PLATO's private calendar link (no password), see its status, remove it. */
export function PlatoCalendarSection({ calendar, actions }: { calendar: CalendarView | null; actions: CalendarActions }) {
  // When Settings was opened; enough for "checked 3 min ago".
  const [now] = useState(() => Date.now());
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"link" | "refresh" | "unlink" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const expired = calendar?.error === "expired";

  const link = async () => {
    setBusy("link");
    setMessage(null);
    const r = await actions.link(url);
    setBusy(null);
    if (r.ok) {
      setUrl("");
      setMessage(`Linked. Found ${r.calendar.deadlines.length} upcoming deadline${r.calendar.deadlines.length === 1 ? "" : "s"}.`);
    } else setMessage(ERRORS[r.error]);
  };

  const upcoming = calendar ? calendar.deadlines.filter((d) => d.dueAt > now).length : 0;

  return (
    <section aria-labelledby="plato-calendar">
      <h3 id="plato-calendar" className="flex items-center gap-2 font-pixel font-bold text-foreground mb-1">
        <CalendarClock size={18} className="text-primary" /> PLATO deadlines
      </h3>

      {calendar && !expired ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground">
            Linked · {upcoming} upcoming deadline{upcoming === 1 ? "" : "s"} · checked {relative(calendar.checkedAt, now)}
          </p>
          {calendar.error === "unreachable" && <p className="text-sm text-muted-foreground">PLATO didn&apos;t respond on the last check. PNUtify will try again shortly.</p>}
          <p className="text-sm text-muted-foreground">New assignments and changed due dates show up within about 15 minutes, as PLATO tasks in Tasks. Turn on Deadline reminders above to get alerts.</p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={async () => {
                setBusy("refresh");
                setMessage((await actions.refresh()) ? null : "Couldn't reach PNUtify. Try again in a minute.");
                setBusy(null);
              }}
              disabled={busy !== null}
              className="cozy-btn bg-card px-3 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={15} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh now
            </button>
            <button
              onClick={async () => {
                setBusy("unlink");
                await actions.unlink();
                setBusy(null);
                setMessage("Removed. PNUtify deleted the link and your PLATO deadlines.");
              }}
              disabled={busy !== null}
              className="cozy-btn bg-card px-3 py-2 text-sm font-semibold flex items-center gap-1.5 text-muted-foreground disabled:opacity-50"
            >
              <Unlink size={15} /> Remove link
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-muted-foreground">
            {expired
              ? "PLATO no longer accepts your link. It changes when you change your PLATO password. Get a new one and paste it below."
              : "Bring your PLATO assignment and quiz deadlines into PNUtify, with reminders. No password: you paste PLATO's private calendar link, which can only read your calendar."}
          </p>
          <ol className="text-sm text-foreground list-decimal pl-5 flex flex-col gap-1">
            <li>
              Open PLATO&apos;s{" "}
              <a href={PLATO_EXPORT_PAGE} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline inline-flex items-center gap-0.5">
                달력 내보냄 page <ExternalLink size={12} />
              </a>{" "}
              (log in if asked).
            </li>
            <li>
              Choose <b>모든 이벤트</b> and <b>현재와 추후 2달</b>.
            </li>
            <li>
              Tap <b>달력 URL 가져옴</b> (not 내보냄) and copy the link it shows.
            </li>
            <li>Paste it here.</li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) link();
            }}
            className="flex gap-2"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://plato.pusan.ac.kr/calendar/export_execute.php?…"
              aria-label="PLATO calendar link"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-background border border-border rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
            <button type="submit" disabled={busy !== null || !url.trim()} className="cozy-btn bg-primary text-primary-foreground px-3.5 py-2 text-sm font-semibold shrink-0 disabled:opacity-50">
              {busy === "link" ? "Checking…" : "Link PLATO"}
            </button>
          </form>
          <p className="text-xs text-muted-foreground">
            Stored encrypted and only used to read your calendar about every 15 minutes. Remove it any time; changing your PLATO password also cancels it.
          </p>
        </div>
      )}

      {message && (
        <p role="status" className="mt-2 text-sm font-semibold text-foreground">
          {message}
        </p>
      )}
    </section>
  );
}
