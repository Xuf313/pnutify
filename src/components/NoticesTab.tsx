"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, Pin, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { BoardIcon } from "./BoardIcon";
import { cn, EmptyState, Pill } from "./ui";
import { isNewNotice } from "@/lib/client/notices";
import { relative } from "@/lib/client/time";
import type { AlertCategories, Notice, NoticeSource } from "@/lib/client/types";
import { boardInfo, SOURCE_LABEL } from "@/lib/client/types";

type Filter = "all" | NoticeSource;
const PAGE = 20;

type Props = {
  now: number;
  notices: Notice[];
  /** The boards this device shows (already applied to `notices`). */
  boards: NoticeSource[];
  readIds: Set<string>;
  loading: boolean;
  error: boolean;
  updatedAt: number;
  staleSources: string[];
  alerts: AlertCategories;
  alertsReady: boolean;
  onOpenNotice: (id: string) => void;
  onMarkRead: (ids: string[], value?: boolean) => void;
  onRetry: () => void;
  openSettings: () => void;
};

export function NoticesTab(p: Props) {
  const [chosen, setFilter] = useState<Filter>("all");
  // A board hidden in Settings can't stay selected here.
  const filter: Filter = chosen === "all" || p.boards.includes(chosen) ? chosen : "all";
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.notices.filter(
      (n) =>
        (filter === "all" || n.source === filter) &&
        (!unreadOnly || !p.readIds.has(n.id)) &&
        (!q || n.title.toLowerCase().includes(q)),
    );
  }, [p.notices, p.readIds, filter, unreadOnly, query]);

  const unreadInView = filtered.filter((n) => !p.readIds.has(n.id));
  const counts: Record<string, number> = { all: 0 };
  for (const n of p.notices) {
    if (p.readIds.has(n.id)) continue;
    counts.all++;
    counts[n.source] = (counts[n.source] ?? 0) + 1;
  }

  const alertOn = filter === "all" ? p.boards.length > 0 && p.boards.every((b) => p.alerts.boards.includes(b)) : p.alerts.boards.includes(filter);

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-pixel text-3xl font-bold text-foreground">Notices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {counts.all} unread{p.updatedAt ? ` · updated ${relative(p.updatedAt, p.now)}` : ""}
          </p>
        </div>
        {p.alertsReady && (
          <button
            onClick={p.openSettings}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors",
              alertOn ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {alertOn ? <Bell size={14} /> : <BellOff size={14} />} Alerts {alertOn ? "on" : "off"}
          </button>
        )}
      </div>

      <div className="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label="Notice board">
        {(["all", ...p.boards] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE);
            }}
            className={cn(
              "relative shrink-0 whitespace-nowrap flex items-center gap-1.5 pt-1 pb-2.5 text-[15px] transition-colors",
              filter === f ? "text-foreground font-semibold" : "text-muted-foreground font-medium hover:text-foreground",
            )}
          >
            {f === "all" ? "All" : boardInfo(f)?.short ?? f}
            {(counts[f] ?? 0) > 0 && <span className={cn("text-xs tabular-nums", filter === f ? "text-primary" : "")}>{counts[f]}</span>}
            <span className={cn("absolute -bottom-px inset-x-0 h-[3px] rounded-t-full bg-signal", filter === f ? "opacity-100" : "opacity-0")} aria-hidden />
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search notices</span>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search notices"
            className="w-full bg-card border border-border rounded-[10px] pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-primary"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          aria-pressed={unreadOnly}
          className={cn("cozy-btn px-3.5 py-2 text-sm font-medium", unreadOnly ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}
        >
          Unread
        </button>
      </div>

      {p.staleSources.length > 0 && (
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <TriangleAlert size={14} />
          The {p.staleSources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ")} site didn&apos;t respond on the last check, so its list may be a little behind.
        </p>
      )}

      {unreadInView.length > 1 && (
        <button onClick={() => p.onMarkRead(unreadInView.map((n) => n.id))} className="self-end text-sm font-semibold text-primary flex items-center gap-1.5 hover:underline">
          <CheckCheck size={16} /> Mark {unreadInView.length} as read
        </button>
      )}

      {p.loading && p.notices.length === 0 ? (
        <ul className="flex flex-col divide-y divide-border" aria-busy="true" aria-label="Loading notices">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="py-4">
              <div className="h-4 w-4/5 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted animate-pulse mt-2" />
            </li>
          ))}
        </ul>
      ) : p.error && p.notices.length === 0 ? (
        <EmptyState title="Couldn't load notices">
          <button onClick={p.onRetry} className="font-semibold text-primary inline-flex items-center gap-1 hover:underline">
            <RefreshCw size={14} /> Try again
          </button>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title={query ? "No matches" : unreadOnly ? "No unread notices" : "No notices yet"}>
          {query ? `Nothing matches "${query}".` : unreadOnly ? "You've read everything here." : "Check back soon."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-border -mt-1">
          {filtered.slice(0, limit).map((n) => {
            const isRead = p.readIds.has(n.id);
            return (
              <li key={n.id} className="flex items-start">
                <button onClick={() => p.onOpenNotice(n.id)} className="group flex-1 min-w-0 text-left py-3.5 flex gap-3 items-start">
                  <span className={cn("mt-[0.55rem] w-2 h-2 rounded-full shrink-0", isRead ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <span className="flex-1 min-w-0">
                    <span className={cn("block leading-snug group-hover:underline underline-offset-[3px] decoration-1", isRead ? "text-muted-foreground" : "font-semibold text-foreground")}>{n.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[13px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                        <BoardIcon source={n.source} size={13} className="text-muted-foreground" />
                        {SOURCE_LABEL[n.source]}
                      </span>
                      <span className="tabular-nums">{n.date}</span>
                      {!isRead && isNewNotice(n, p.now) && <Pill tone="primary">New</Pill>}
                      {n.pinned && (
                        <Pill>
                          <Pin size={10} /> Pinned
                        </Pill>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => p.onMarkRead([n.id], !isRead)}
                  className="mt-2.5 ml-1 p-2 rounded-full text-muted-foreground hover:text-primary hover:bg-muted"
                  aria-label={isRead ? `Mark "${n.title}" as unread` : `Mark "${n.title}" as read`}
                  title={isRead ? "Mark as unread" : "Mark as read"}
                >
                  <CheckCheck size={18} className={isRead ? "text-secondary" : ""} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="cozy-btn bg-card font-medium py-2.5 text-sm">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </button>
      )}
    </div>
  );
}
