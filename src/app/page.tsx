"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CalendarDays, ListTodo, Newspaper, Settings, Sunrise } from "lucide-react";
import { AppLogo, cn } from "@/components/ui";
import { BriefingTab } from "@/components/BriefingTab";
import { NoticesTab } from "@/components/NoticesTab";
import { TasksTab } from "@/components/TasksTab";
import { CalendarTab } from "@/components/CalendarTab";
import { SettingsSheet, type InstallPrompt } from "@/components/SettingsSheet";
import { NoticeSheet } from "@/components/NoticeSheet";
import { KEYS, getDeviceId, loadTasks, loadTheme, migrateStorage, read, saveTheme, write, type NoticeCache } from "@/lib/client/storage";
import { getAlertState, NO_ALERTS, refreshSubscription, registerServiceWorker, setAlerts } from "@/lib/client/push";
import { TABS, type AlertCategories, type Notice, type Tab, type Task, type Theme } from "@/lib/client/types";
import { formatDate } from "@/lib/client/time";

const REFRESH_MS = 5 * 60 * 1000;

const NAV: { id: Tab; label: string; icon: typeof Sunrise }[] = [
  { id: "briefing", label: "Briefing", icon: Sunrise },
  { id: "notices", label: "Notices", icon: Newspaper },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

function dedupe(list: Notice[]): Notice[] {
  const seen = new Set<string>();
  return list.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

type Boot = {
  theme: Theme;
  tasks: Task[];
  readIds: Set<string>;
  cache: NoticeCache | null;
  sinceTs: number;
  tab: Tab;
  noticeId: string | null;
};

function parseLink(href: string): { tab: Tab | null; noticeId: string | null } {
  try {
    const u = new URL(href, window.location.origin);
    const t = u.searchParams.get("tab") as Tab | null;
    const n = u.searchParams.get("notice");
    return { tab: n ? "notices" : t && TABS.includes(t) ? t : null, noticeId: n };
  } catch {
    return { tab: null, noticeId: null };
  }
}

let bootData: Boot | null = null;
/** Reads everything saved on this device once, on the client only. */
function boot(): Boot {
  if (bootData) return bootData;
  migrateStorage();
  getDeviceId();
  const cache = read<NoticeCache | null>(KEYS.notices, null);
  const link = parseLink(window.location.href);
  bootData = {
    theme: loadTheme(),
    tasks: loadTasks(),
    readIds: new Set(read<string[]>(KEYS.read, [])),
    cache: cache && Array.isArray(cache.notices) ? { updatedAt: cache.updatedAt || 0, notices: dedupe(cache.notices) } : null,
    sinceTs: read<number>(KEYS.lastVisit, 0) || Date.now() - 2 * 86_400_000,
    tab: link.tab ?? "briefing",
    noticeId: link.noticeId,
  };
  return bootData;
}

const noopSubscribe = () => () => {};

/** Everything here depends on this device's saved data, so render only in the browser. */
export default function Page() {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return isClient ? <App /> : <div className="min-h-[100dvh]" />;
}

function App() {
  const [tab, setTab] = useState<Tab>(() => boot().tab);
  const [theme, setTheme] = useState<Theme>(() => boot().theme);
  const [notices, setNotices] = useState<Notice[]>(() => boot().cache?.notices ?? []);
  const [noticesUpdatedAt, setNoticesUpdatedAt] = useState(() => boot().cache?.updatedAt ?? 0);
  const [staleSources, setStaleSources] = useState<string[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(() => !boot().cache);
  const [noticeError, setNoticeError] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => boot().readIds);
  const [tasks, setTasks] = useState<Task[]>(() => boot().tasks);
  const [alerts, setAlertsState] = useState<AlertCategories>(NO_ALERTS);
  const [alertsReady, setAlertsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openNoticeId, setOpenNoticeId] = useState<string | null>(() => boot().noticeId);
  const [sinceTs] = useState(() => boot().sinceTs);
  const [now, setNow] = useState(() => Date.now());
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const lastFetch = useRef(0);

  // ---------- deep links: ?tab=notices&notice=<id> (used by push notifications) ----------
  const applyUrl = useCallback((href: string) => {
    const link = parseLink(href);
    if (link.tab) setTab(link.tab);
    if (link.noticeId) setOpenNoticeId(link.noticeId);
  }, []);

  const fetchNotices = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const res = await fetch("/api/notices", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data.notices)) {
        const list = dedupe(data.notices as Notice[]);
        setNotices(list);
        setNoticesUpdatedAt(Number(data.updatedAt) || Date.now());
        setStaleSources(Array.isArray(data.staleSources) ? data.staleSources : []);
        write(KEYS.notices, { updatedAt: Number(data.updatedAt) || Date.now(), notices: list } satisfies NoticeCache);
        setNoticeError(false);
      }
    } catch {
      setNoticeError(true);
    } finally {
      setLoadingNotices(false);
    }
  }, []);

  // ---------- first load ----------
  useEffect(() => {
    const t = setTimeout(() => write(KEYS.lastVisit, Date.now()), 10_000);
    if (window.location.search) window.history.replaceState({}, "", window.location.pathname);
    const first = setTimeout(fetchNotices, 0);

    (async () => {
      await registerServiceWorker();
      await refreshSubscription();
      const state = await getAlertState();
      setAlertsState(state.categories);
      setAlertsReady(true);
    })();

    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "open" && typeof e.data.url === "string") applyUrl(e.data.url);
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);

    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as unknown as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onInstall);

    return () => {
      clearTimeout(t);
      clearTimeout(first);
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, [applyUrl, fetchNotices]);

  // ---------- keep things fresh while open ----------
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current > REFRESH_MS) fetchNotices();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (Date.now() - lastFetch.current > 2 * 60_000) fetchNotices();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchNotices]);

  // ---------- persistence ----------
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    write(KEYS.tasks, tasks);
  }, [tasks]);

  useEffect(() => {
    write(KEYS.read, [...readIds]);
  }, [readIds]);

  // Deadline reminders need a server-side copy of upcoming tasks — only while that alert is on.
  useEffect(() => {
    if (!alertsReady) return;
    const t = setTimeout(() => {
      fetch("/api/tasks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), tasks: alerts.tasks ? tasks : [] }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [tasks, alerts.tasks, alertsReady]);

  // ---------- actions ----------
  const markRead = useCallback((ids: string[], value = true) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const changeAlerts = useCallback(async (patch: Partial<AlertCategories>) => {
    const next = await setAlerts(patch);
    setAlertsState(next);
    return next;
  }, []);

  const taskActions = useMemo(
    () => ({
      add: (t: Omit<Task, "id" | "status" | "createdAt">) =>
        setTasks((prev) => [{ ...t, id: `own_${Date.now().toString(36)}`, status: "pending", createdAt: Date.now() }, ...prev]),
      update: (id: string, patch: Partial<Task>) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))),
      toggle: (id: string) =>
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: t.status === "pending" ? "completed" : "pending" } : t))),
      remove: (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id)),
      clearCompleted: () => setTasks((prev) => prev.filter((t) => t.status !== "completed")),
    }),
    [],
  );

  const openNotice = useCallback((id: string) => setOpenNoticeId(id), []);
  const selectedNotice = openNoticeId ? notices.find((n) => n.id === openNoticeId) ?? null : null;
  const unreadCount = useMemo(() => notices.filter((n) => !readIds.has(n.id)).length, [notices, readIds]);
  const pendingCount = useMemo(() => tasks.filter((t) => t.status === "pending").length, [tasks]);

  const content = (
    <>
      {tab === "briefing" && (
        <BriefingTab
          now={now}
          sinceTs={sinceTs}
          notices={notices}
          readIds={readIds}
          tasks={tasks}
          alerts={alerts}
          alertsReady={alertsReady}
          canInstall={Boolean(installPrompt)}
          onOpenNotice={openNotice}
          onToggleTask={taskActions.toggle}
          goTo={setTab}
          openSettings={() => setSettingsOpen(true)}
        />
      )}
      {tab === "notices" && (
        <NoticesTab
          now={now}
          notices={notices}
          readIds={readIds}
          loading={loadingNotices}
          error={noticeError}
          updatedAt={noticesUpdatedAt}
          staleSources={staleSources}
          alerts={alerts}
          alertsReady={alertsReady}
          onOpenNotice={openNotice}
          onMarkRead={markRead}
          onRetry={fetchNotices}
          openSettings={() => setSettingsOpen(true)}
        />
      )}
      {tab === "tasks" && <TasksTab now={now} tasks={tasks} actions={taskActions} alerts={alerts} openSettings={() => setSettingsOpen(true)} />}
      {tab === "calendar" && <CalendarTab now={now} tasks={tasks} onToggleTask={taskActions.toggle} goTo={setTab} />}
    </>
  );

  const badge = (id: Tab) => (id === "notices" ? unreadCount : id === "tasks" ? pendingCount : 0);

  return (
    <div className="font-sans selection:bg-primary/20 selection:text-foreground min-h-[100dvh]">
      {/* ---------- phone ---------- */}
      <div className="md:hidden flex flex-col min-h-[100dvh]">
        <header
          className="sticky top-0 z-20 px-5 pb-3 flex items-center justify-between bg-background/95 backdrop-blur border-b-2 border-dashed border-border/20"
          style={{ paddingTop: "max(0.9rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2.5">
            <AppLogo size={34} className="-rotate-2" />
            <div>
              <p className="font-pixel text-2xl font-bold leading-none text-foreground">PNUtify</p>
              <p className="text-xs font-bold text-primary mt-0.5">{formatDate(now, { weekday: "long", month: "short", day: "numeric" })}</p>
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} className="cozy-btn bg-card p-2 text-foreground" aria-label="Settings">
            <Settings size={20} />
          </button>
        </header>

        <main className="flex-1 px-5 pt-4" style={{ paddingBottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}>
          {content}
        </main>

        <nav
          className="fixed bottom-0 inset-x-0 z-30 px-4 pt-6 bg-gradient-to-t from-background via-background/95 to-transparent"
          style={{ paddingBottom: "max(0.9rem, env(safe-area-inset-bottom))" }}
          aria-label="Sections"
        >
          <div className="cozy-card bg-card p-1.5 flex rounded-3xl">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "relative flex-1 flex flex-col items-center gap-0.5 py-2 rounded-2xl border-2 transition-colors",
                  tab === id ? "bg-muted text-primary border-border" : "border-transparent text-muted-foreground",
                )}
              >
                <Icon size={22} />
                <span className="font-pixel text-[10px] font-bold tracking-wide">{label}</span>
                {badge(id) > 0 && (
                  <span className="absolute top-1 right-[22%] min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center border border-border">
                    {badge(id) > 99 ? "99+" : badge(id)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* ---------- tablet / desktop ---------- */}
      <div className="hidden md:flex h-[100dvh] overflow-hidden">
        <aside className="w-64 lg:w-72 shrink-0 flex flex-col border-r-2 border-border bg-card/80 backdrop-blur-sm">
          <div className="px-6 pt-8 pb-6 border-b-2 border-dashed border-border/30">
            <div className="washi-tape font-pixel text-[10px] font-bold tracking-widest px-3 py-1 inline-block mb-4 -rotate-1">부산대학교</div>
            <div className="flex items-center gap-3">
              <AppLogo size={44} className="-rotate-2" />
              <h1 className="font-pixel text-3xl font-bold text-foreground">PNUtify</h1>
            </div>
            <p className="text-xs font-bold text-muted-foreground mt-3">{formatDate(now, { weekday: "long" })}</p>
            <p className="font-pixel text-2xl font-bold text-primary">{formatDate(now, { month: "short", day: "numeric" })}</p>
          </div>
          <nav className="flex-1 px-4 py-6 flex flex-col gap-2" aria-label="Sections">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm border-2 transition-all",
                  tab === id
                    ? "bg-primary text-primary-foreground border-border shadow-[3px_3px_0px_var(--color-border)] -translate-y-0.5"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon size={20} />
                <span className="font-pixel tracking-wide">{label}</span>
                {badge(id) > 0 && (
                  <span
                    className={cn(
                      "ml-auto font-pixel text-[10px] font-bold px-1.5 py-0.5 rounded-md border",
                      tab === id ? "bg-primary-foreground/20 border-primary-foreground/30" : "bg-primary text-primary-foreground border-border",
                    )}
                  >
                    {badge(id)}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="px-4 py-5 border-t-2 border-dashed border-border/30">
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm border-2 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <Settings size={20} />
              <span className="font-pixel tracking-wide">Settings & alerts</span>
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto px-8 lg:px-12 py-8">
          <div className="max-w-3xl mx-auto">{content}</div>
        </main>
      </div>

      <NoticeSheet
        notice={selectedNotice}
        pendingId={openNoticeId}
        loading={loadingNotices}
        isRead={selectedNotice ? readIds.has(selectedNotice.id) : false}
        onClose={() => setOpenNoticeId(null)}
        onMarkRead={markRead}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        alerts={alerts}
        alertsReady={alertsReady}
        changeAlerts={changeAlerts}
        installPrompt={installPrompt}
        clearInstallPrompt={() => setInstallPrompt(null)}
      />
    </div>
  );
}
