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
import { BOARD_IDS, DEFAULT_BOARDS, MAX_SHOWN_BOARDS, TABS, type AlertCategories, type Notice, type NoticeSource, type OwnerData, type Tab, type Task, type Theme } from "@/lib/client/types";
import { coursePosts, externalTasks, fetchOwnerData, lockOwner, pushOwnerState, syncOwnerNow, unlockOwner, type SyncState } from "@/lib/client/owner";
import { createSyncCode, deleteSyncCode, pushSyncCode, readSyncCode } from "@/lib/client/syncCode";
import { formatDate } from "@/lib/client/time";
import { isFreshNotice } from "@/lib/client/notices";

/** While the app is open and visible. The server checks the boards every minute. */
const REFRESH_MS = 60 * 1000;

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
  /**
   * Set until this device has had its first notice list: everything that isn't
   * new by then is marked read, so a first visit shows the few new notices
   * instead of 100+ unread ones.
   */
  seedReadSince: number | null;
  /** Boards this device shows. */
  boards: NoticeSource[];
  /** Boards whose older notices were already marked read when they first appeared here. */
  seededBoards: string[];
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

/** Saved boards in list order (core first), or the core boards for a new device. */
function shownBoards(stored: unknown): NoticeSource[] {
  if (!Array.isArray(stored)) return DEFAULT_BOARDS;
  const list = BOARD_IDS.filter((b) => stored.includes(b)).slice(0, MAX_SHOWN_BOARDS);
  return list.length > 0 ? list : DEFAULT_BOARDS;
}

let bootData: Boot | null = null;
/** Reads everything saved on this device once, on the client only. */
function boot(): Boot {
  if (bootData) return bootData;
  migrateStorage();
  getDeviceId();
  const cache = read<NoticeCache | null>(KEYS.notices, null);
  const link = parseLink(window.location.href);
  const sinceTs = read<number>(KEYS.lastVisit, 0) || Date.now() - 2 * 86_400_000;
  const seed = read<number | "done" | null>(KEYS.readSeed, null);
  const seedReadSince = seed === "done" ? null : typeof seed === "number" ? seed : sinceTs;
  if (seedReadSince !== null) write(KEYS.readSeed, seedReadSince);
  const storedBoards = read<string[] | null>(KEYS.boards, null);
  // Before boards could be added, everyone had CSE and International; those are already "seeded".
  const seededBoards = read<string[] | null>(KEYS.seededBoards, null) ?? (seed === "done" ? ["cse", "international"] : []);
  bootData = {
    theme: loadTheme(),
    tasks: loadTasks(),
    readIds: new Set(read<string[]>(KEYS.read, [])),
    cache: cache && Array.isArray(cache.notices) ? { updatedAt: cache.updatedAt || 0, notices: dedupe(cache.notices) } : null,
    sinceTs,
    seedReadSince,
    boards: shownBoards(storedBoards),
    seededBoards,
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

  // ---------- owner mode (PLATO + NESPA, only on the owner's devices) ----------
  const [isOwner, setIsOwner] = useState(() => read<boolean>(KEYS.isOwner, false));
  const [ownerData, setOwnerData] = useState<OwnerData | null>(() => (read<boolean>(KEYS.isOwner, false) ? read<OwnerData | null>(KEYS.ownerData, null) : null));
  const [external, setExternal] = useState<SyncState["external"]>(() => read(KEYS.external, {}));
  const [deletedTasks, setDeletedTasks] = useState<Record<string, number>>(() => read(KEYS.deletedTasks, {}));
  const seedReadSince = useRef<number | null>(boot().seedReadSince);
  const seededBoards = useRef(new Set(boot().seededBoards));
  const [boards, setBoardsState] = useState<NoticeSource[]>(() => boot().boards);
  const boardsRef = useRef(boards);
  const pendingRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetch = useRef<((bypassCache?: boolean) => Promise<void>) | null>(null);

  // ---------- deep links: ?tab=notices&notice=<id> (used by push notifications) ----------
  const applyUrl = useCallback((href: string) => {
    const link = parseLink(href);
    if (link.tab) setTab(link.tab);
    if (link.noticeId) setOpenNoticeId(link.noticeId);
  }, []);

  const fetchNotices = useCallback(async (bypassCache = false) => {
    lastFetch.current = Date.now();
    try {
      // After a push the shared CDN copy may be up to 30 s old; ask the server directly.
      // Sorted, so every device showing the same boards shares one CDN copy.
      const query = `boards=${[...boardsRef.current].sort().join(",")}`;
      const res = await fetch(bypassCache ? `/api/notices?${query}&t=${Date.now()}` : `/api/notices?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data.notices)) {
        const list = dedupe(data.notices as Notice[]);
        setNotices(list);
        setNoticesUpdatedAt(Number(data.updatedAt) || Date.now());
        setStaleSources(Array.isArray(data.staleSources) ? data.staleSources : []);
        write(KEYS.notices, { updatedAt: Number(data.updatedAt) || Date.now(), notices: list } satisfies NoticeCache);
        setNoticeError(false);
        const since = seedReadSince.current;
        if (since !== null && list.length > 0) {
          const t = Date.now();
          const old = list.filter((n) => !isFreshNotice(n, t, since)).map((n) => n.id);
          setReadIds((prev) => new Set([...prev, ...old]));
          seedReadSince.current = null;
          write(KEYS.readSeed, "done");
          for (const n of list) seededBoards.current.add(n.source);
        }
        // A board that's new to this device (e.g. one added in an update) starts with its older
        // notices marked read, so it doesn't arrive with 100+ unread.
        const fresh = [...new Set(list.map((n) => n.source))].filter((s) => !seededBoards.current.has(s));
        if (fresh.length > 0 && seedReadSince.current === null) {
          const t = Date.now();
          const old = list.filter((n) => fresh.includes(n.source) && !isFreshNotice(n, t, t - 2 * 86_400_000)).map((n) => n.id);
          setReadIds((prev) => new Set([...prev, ...old]));
          fresh.forEach((s) => seededBoards.current.add(s));
        }
        write(KEYS.seededBoards, [...seededBoards.current]);
        // A board read for the first time arrives on the next check; look again shortly.
        if (Array.isArray(data.pending) && data.pending.length > 0 && !pendingRetry.current) {
          pendingRetry.current = setTimeout(() => {
            pendingRetry.current = null;
            refetch.current?.(true);
          }, 20_000);
        }
      }
    } catch {
      setNoticeError(true);
    } finally {
      setLoadingNotices(false);
    }
  }, []);

  useEffect(() => {
    refetch.current = fetchNotices;
  }, [fetchNotices]);

  // ---------- first load ----------
  useEffect(() => {
    const t = setTimeout(() => write(KEYS.lastVisit, Date.now()), 10_000);
    if (window.location.search) window.history.replaceState({}, "", window.location.pathname);
    const first = setTimeout(() => fetchNotices(), 0);

    (async () => {
      await registerServiceWorker();
      await refreshSubscription();
      const state = await getAlertState();
      setAlertsState(state.categories);
      setAlertsReady(true);
    })();

    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "open" && typeof e.data.url === "string") applyUrl(e.data.url);
      // A push just arrived: show the new notice right away.
      if (e.data?.type === "refresh") fetchNotices(true);
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
      // Small margin so a fetch that ran a moment under a minute ago still counts as due.
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current > REFRESH_MS - 5_000) fetchNotices();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (Date.now() - lastFetch.current > 30_000) fetchNotices();
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
    // Status bar / browser chrome colour = this theme's page background, so the top of the
    // screen matches the header instead of showing a different colour above it.
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--t-background").trim();
    if (bg) {
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = bg;
      document.head.appendChild(meta);
    }
  }, [theme]);

  useEffect(() => {
    write(KEYS.tasks, tasks);
  }, [tasks]);

  useEffect(() => {
    write(KEYS.read, [...readIds]);
  }, [readIds]);

  useEffect(() => {
    write(KEYS.external, external);
    write(KEYS.deletedTasks, deletedTasks);
  }, [external, deletedTasks]);

  // ---------- syncing across devices: the owner's devices, or any student's via a sync code ----------
  const [syncCode, setSyncCodeState] = useState<string | null>(() => read<string | null>(KEYS.syncCode, null));
  const setSyncCode = useCallback((code: string | null) => {
    setSyncCodeState(code);
    write(KEYS.syncCode, code);
  }, []);
  const latest = useRef({ tasks, readIds, external, deletedTasks, isOwner, syncCode });
  // Declared before the effects below, so they always see this render's values.
  useEffect(() => {
    latest.current = { tasks, readIds, external, deletedTasks, isOwner, syncCode };
  });
  const localVersion = useRef(0);
  const applyingRemote = useRef(false);

  const loadOwnerData = useCallback(async () => {
    const result = await fetchOwnerData();
    if (result === "not-owner") {
      setIsOwner(false);
      setOwnerData(null);
      write(KEYS.isOwner, false);
      write(KEYS.ownerData, null);
    } else if (result) {
      setIsOwner(true);
      setOwnerData(result);
      write(KEYS.isOwner, true);
      write(KEYS.ownerData, result);
    }
  }, []);

  const adoptMerged = useCallback((merged: SyncState) => {
    applyingRemote.current = true;
    setTasks(merged.tasks.map((t) => ({ ...t, source: "own" as const })));
    setReadIds(new Set(merged.readIds));
    setExternal(merged.external ?? {});
    setDeletedTasks(merged.deleted ?? {});
  }, []);

  /** Sends this device's tasks and read state; adopts the merged copy unless something changed meanwhile. */
  const syncState = useCallback(async () => {
    const cur = latest.current;
    if (!cur.isOwner && !cur.syncCode) return;
    const version = localVersion.current;
    const mine: SyncState = { tasks: cur.tasks, deleted: cur.deletedTasks, readIds: [...cur.readIds], external: cur.external };
    // The owner's devices sync through owner mode; everyone else through their sync code.
    const merged = cur.isOwner ? await pushOwnerState(mine) : await pushSyncCode(cur.syncCode!, mine);
    if (merged === "unknown") {
      // The synced copy was deleted from another device: stop syncing here, keep the local data.
      setSyncCode(null);
      return;
    }
    if (!merged || localVersion.current !== version) return;
    adoptMerged(merged);
  }, [adoptMerged, setSyncCode]);

  const syncActions = useMemo(
    () => ({
      /** Starts syncing: uploads this device's data and returns the new code. */
      create: async () => {
        const cur = latest.current;
        const made = await createSyncCode({ tasks: cur.tasks, deleted: cur.deletedTasks, readIds: [...cur.readIds], external: cur.external });
        if (!made) return null;
        setSyncCode(made.code);
        return made.code;
      },
      /** Joins another device's code; this device's data is merged in. */
      join: async (code: string) => {
        const clean = code.trim().toUpperCase();
        const found = await readSyncCode(clean);
        if (found === "unknown") return "unknown" as const;
        if (!found) return "error" as const;
        latest.current = { ...latest.current, syncCode: clean };
        setSyncCode(clean);
        await syncState();
        return "ok" as const;
      },
      /** Stops syncing on this device only. */
      leave: () => setSyncCode(null),
      /** Deletes the synced copy for every device using the code. */
      wipe: async () => {
        const code = latest.current.syncCode;
        if (code) await deleteSyncCode(code);
        setSyncCode(null);
      },
    }),
    [setSyncCode, syncState],
  );

  useEffect(() => {
    const first = setTimeout(loadOwnerData, 0);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      loadOwnerData();
      syncState();
    };
    const every = setInterval(() => document.visibilityState === "visible" && loadOwnerData(), 5 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadOwnerData, syncState]);

  // First sync as soon as this device is known to be the owner's, or has a sync code.
  useEffect(() => {
    if (isOwner || syncCode) syncState();
  }, [isOwner, syncCode, syncState]);

  // Local edits: send them a moment later (several quick edits go as one).
  useEffect(() => {
    if (applyingRemote.current) {
      applyingRemote.current = false;
      return;
    }
    localVersion.current++;
    if (!latest.current.isOwner && !latest.current.syncCode) return;
    const t = setTimeout(syncState, 1500);
    return () => clearTimeout(t);
  }, [tasks, readIds, external, deletedTasks, syncState]);

  // Deadline reminders and the weekly preview need a server-side copy of upcoming tasks; only while one of them is on.
  useEffect(() => {
    if (!alertsReady) return;
    const t = setTimeout(() => {
      fetch("/api/tasks/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), tasks: alerts.tasks || alerts.weekly ? tasks : [] }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [tasks, alerts.tasks, alerts.weekly, alertsReady]);

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

  const setBoards = useCallback(
    (next: NoticeSource[]) => {
      const list = shownBoards(next);
      boardsRef.current = list;
      setBoardsState(list);
      write(KEYS.boards, list);
      fetchNotices();
      // A hidden board stops alerting too.
      if (alerts.boards.some((b) => !list.includes(b))) changeAlerts({ boards: alerts.boards.filter((b) => list.includes(b)) }).catch(() => {});
    },
    [alerts.boards, changeAlerts, fetchNotices],
  );

  const externalList = useMemo(() => (isOwner ? externalTasks(ownerData, external, now) : []), [isOwner, ownerData, external, now]);
  const allTasks = useMemo(() => [...tasks, ...externalList], [tasks, externalList]);
  const posts = useMemo(() => (isOwner ? coursePosts(ownerData) : []), [isOwner, ownerData]);

  const taskActions = useMemo(() => {
    const stamp = () => Date.now();
    const tombstone = (ids: string[]) => setDeletedTasks((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, stamp()])) }));
    return {
      add: (t: Omit<Task, "id" | "status" | "createdAt">) =>
        setTasks((prev) => [{ ...t, id: `own_${Date.now().toString(36)}`, status: "pending", createdAt: stamp(), updatedAt: stamp(), source: "own" }, ...prev]),
      update: (id: string, patch: Partial<Task>) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: stamp() } : t))),
      toggle: (id: string) => {
        // PLATO/NESPA items can't be edited, only ticked off (shared across the owner's devices).
        if (id.startsWith("plato_") || id.startsWith("nespa_")) {
          setExternal((prev) => ({ ...prev, [id]: { done: !prev[id]?.done, at: stamp() } }));
          return;
        }
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: t.status === "pending" ? "completed" : "pending", updatedAt: stamp() } : t)));
      },
      remove: (id: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        tombstone([id]);
      },
      clearCompleted: (ids: string[]) => {
        const isExternal = (id: string) => id.startsWith("plato_") || id.startsWith("nespa_");
        const own = new Set(ids.filter((id) => !isExternal(id)));
        const external = ids.filter(isExternal);
        if (own.size > 0) {
          setTasks((prev) => prev.filter((t) => !own.has(t.id)));
          tombstone([...own]);
        }
        // PLATO/NESPA items can't be deleted from there; hide them here (and on the owner's other devices).
        if (external.length > 0) {
          const at = stamp();
          setExternal((prev) => ({ ...prev, ...Object.fromEntries(external.map((id) => [id, { done: true, cleared: true, at }])) }));
        }
      },
    };
  }, []);

  const ownerActions = useMemo(
    () => ({
      unlock: async (key: string) => {
        const result = await unlockOwner(key);
        if (result === "ok") await loadOwnerData();
        return result;
      },
      lock: async () => {
        await lockOwner();
        setIsOwner(false);
        setOwnerData(null);
        write(KEYS.isOwner, false);
        write(KEYS.ownerData, null);
      },
      syncNow: async () => {
        const { data, throttled } = await syncOwnerNow();
        if (data) {
          setOwnerData(data);
          write(KEYS.ownerData, data);
        }
        return throttled;
      },
    }),
    [loadOwnerData],
  );

  const openNotice = useCallback((id: string) => setOpenNoticeId(id), []);
  const selectedNotice = openNoticeId ? notices.find((n) => n.id === openNoticeId) ?? null : null;
  // Only the boards this device shows count anywhere (lists, Briefing, badges).
  const shownNotices = useMemo(() => notices.filter((n) => boards.includes(n.source)), [notices, boards]);
  const unreadCount = useMemo(() => shownNotices.filter((n) => !readIds.has(n.id)).length, [shownNotices, readIds]);
  const pendingCount = useMemo(() => allTasks.filter((t) => t.status === "pending").length, [allTasks]);

  const content = (
    <>
      {tab === "briefing" && (
        <BriefingTab
          now={now}
          sinceTs={sinceTs}
          notices={shownNotices}
          readIds={readIds}
          tasks={allTasks}
          posts={posts}
          ownerData={isOwner ? ownerData : null}
          onOpenPost={(post) => {
            markRead([post.id]);
            window.open(post.url, "_blank", "noopener,noreferrer");
          }}
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
          notices={shownNotices}
          boards={boards}
          readIds={readIds}
          loading={loadingNotices}
          error={noticeError}
          updatedAt={noticesUpdatedAt}
          staleSources={staleSources}
          alerts={alerts}
          alertsReady={alertsReady}
          onOpenNotice={openNotice}
          onMarkRead={markRead}
          onRetry={() => fetchNotices()}
          openSettings={() => setSettingsOpen(true)}
        />
      )}
      {tab === "tasks" && (
        <TasksTab now={now} tasks={allTasks} synced={isOwner || Boolean(syncCode)} actions={taskActions} alerts={alerts} openSettings={() => setSettingsOpen(true)} />
      )}
      {tab === "calendar" && <CalendarTab now={now} tasks={allTasks} onToggleTask={taskActions.toggle} goTo={setTab} />}
    </>
  );

  const badge = (id: Tab) => (id === "notices" ? unreadCount : id === "tasks" ? pendingCount : 0);

  return (
    <div className="font-sans selection:bg-primary/20 selection:text-foreground min-h-[100dvh]">
      {/* ---------- phone ---------- */}
      <div className="md:hidden flex flex-col min-h-[100dvh]">
        <header
          // Solid, not translucent: iOS treats an opaque bar at the top as the top bar and doesn't
          // blur it into the status bar area (a see-through, blurred header came out fuzzy there).
          className="sticky top-0 z-20 px-5 pb-3 flex items-center justify-between bg-background border-b-2 border-dashed border-border/20"
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
                <span className="text-[11px] font-extrabold">{label}</span>
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
            <div className="washi-tape text-[11px] font-extrabold tracking-widest px-3 py-1 inline-block mb-4 -rotate-1">부산대학교</div>
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
                      "ml-auto text-[11px] font-extrabold px-1.5 py-0.5 rounded-md border",
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
        boards={boards}
        setBoards={setBoards}
        syncCode={syncCode}
        syncActions={syncActions}
        isOwner={isOwner}
        ownerData={ownerData}
        ownerActions={ownerActions}
      />
    </div>
  );
}
