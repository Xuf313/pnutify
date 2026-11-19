"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, Globe, Monitor, Pin, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { cn, EmptyState, Pill } from "./ui";
import { isNewNotice } from "@/lib/client/notices";
import { relative } from "@/lib/client/time";
import type { AlertCategories, Notice, NoticeSource } from "@/lib/client/types";
import { SOURCE_LABEL } from "@/lib/client/types";

type Filter = "all" | NoticeSource;
const PAGE = 20;

type Props = {
  now: number;
  notices: Notice[];
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
  const [filter, setFilter] = useState<Filter>("all");
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
  const counts = {
    all: p.notices.filter((n) => !p.readIds.has(n.id)).length,
    cse: p.notices.filter((n) => n.source === "cse" && !p.readIds.has(n.id)).length,
    international: p.notices.filter((n) => n.source === "international" && !p.readIds.has(n.id)).length,
  };

  const alertOn = filter === "all" ? p.alerts.cse && p.alerts.international : p.alerts[filter];

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-pixel text-3xl font-bold text-foreground">Notices</h1>
          <p className="text-sm font-bold text-muted-foreground">
            {counts.all} unread{p.updatedAt ? ` · updated ${relative(p.updatedAt, p.now)}` : ""}
          </p>
        </div>
        {p.alertsReady && (
          <button
            onClick={p.openSettings}
            className={cn(
              "cozy-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold",
              alertOn ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
            )}
          >
            {alertOn ? <Bell size={14} /> : <BellOff size={14} />} Alerts {alertOn ? "on" : "off"}
          </button>
        )}
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Notice board">
        {(["all", "cse", "international"] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(PAGE);
            }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm font-extrabold border-2 transition-all",
              filter === f
                ? "bg-foreground text-background border-foreground shadow-[3px_3px_0px_var(--color-primary)] -translate-y-0.5"
                : "bg-card text-muted-foreground border-border shadow-[2px_2px_0px_var(--color-border)] hover:bg-muted",
            )}
          >
            {f === "cse" ? <Monitor size={15} /> : f === "international" ? <Globe size={15} /> : null}
            {f === "all" ? "All" : f === "cse" ? "CSE" : "Intl."}
            {counts[f] > 0 && <span className="text-[10px] opacity-70">{counts[f]}</span>}
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
            className="w-full bg-card border-2 border-border rounded-xl pl-9 pr-9 py-2 text-sm font-bold focus:outline-none focus:border-primary"
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
          className={cn("cozy-btn px-3 py-2 text-xs font-extrabold", unreadOnly ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}
        >
          Unread
        </button>
      </div>

      {p.staleSources.length > 0 && (
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
          <TriangleAlert size={14} />
          The {p.staleSources.map((s) => SOURCE_LABEL[s as NoticeSource] ?? s).join(" and ")} site didn&apos;t respond on the last check, so its list may be a little behind.
        </p>
      )}

      {unreadInView.length > 1 && (
        <button onClick={() => p.onMarkRead(unreadInView.map((n) => n.id))} className="self-end text-sm font-bold text-primary flex items-center gap-1.5 hover:underline">
          <CheckCheck size={16} /> Mark {unreadInView.length} as read
        </button>
      )}

      {p.loading && p.notices.length === 0 ? (
        <ul className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading notices">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="cozy-card bg-card p-4 h-[74px] animate-pulse" />
          ))}
        </ul>
      ) : p.error && p.notices.length === 0 ? (
        <EmptyState title="Couldn't load notices">
          <button onClick={p.onRetry} className="font-bold text-primary inline-flex items-center gap-1 hover:underline">
            <RefreshCw size={14} /> Try again
          </button>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title={query ? "No matches" : unreadOnly ? "No unread notices" : "No notices yet"}>
          {query ? `Nothing matches "${query}".` : unreadOnly ? "You've read everything here." : "Check back soon."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.slice(0, limit).map((n) => {
            const isRead = p.readIds.has(n.id);
            return (
              <li key={n.id} className={cn("cozy-card bg-card flex items-stretch", isRead && "opacity-65 border-dashed shadow-none")}>
                <button onClick={() => p.onOpenNotice(n.id)} className="flex-1 min-w-0 text-left p-3.5 flex gap-3 items-start">
                  <span className="w-9 h-9 rounded-xl bg-background border-2 border-border flex items-center justify-center shrink-0" aria-hidden>
                    {n.source === "cse" ? <Monitor size={16} className="text-secondary" /> : <Globe size={16} className="text-primary" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={cn("block font-bold text-foreground leading-snug", isRead && "font-semibold")}>{n.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {!isRead && isNewNotice(n, p.now) && <Pill tone="primary">New</Pill>}
                      {n.pinned && (
                        <Pill>
                          <Pin size={10} /> Pinned
                        </Pill>
                      )}
                      <span className="text-xs font-bold text-muted-foreground">
                        {SOURCE_LABEL[n.source]} · {n.date}
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => p.onMarkRead([n.id], !isRead)}
                  className="px-3 border-l-2 border-dashed border-border/30 text-muted-foreground hover:text-primary"
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
        <button onClick={() => setLimit((l) => l + PAGE)} className="cozy-btn bg-card font-extrabold py-2.5 text-sm">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </button>
      )}
    </div>
  );
}
