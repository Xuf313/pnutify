"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CalendarDays, ListTodo, Newspaper, Settings, Sunrise } from "lucide-react";
import { AppLogo, cn, Toast } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { BriefingTab } from "@/components/BriefingTab";
import { NoticesTab } from "@/components/NoticesTab";
import { TasksTab, type TaskActions } from "@/components/TasksTab";
import { CalendarTab } from "@/components/CalendarTab";
import { SettingsSheet, type InstallPrompt, type SettingsSection } from "@/components/SettingsSheet";
import { NoticeSheet } from "@/components/NoticeSheet";
import { KEYS, getDeviceId, loadTasks, loadTheme, migrateStorage, read, saveTheme, write, type NoticeCache } from "@/lib/client/storage";
import { getAlertState, NO_ALERTS, refreshSubscription, registerServiceWorker, setAlerts } from "@/lib/client/push";
import { BOARD_IDS, DEFAULT_BOARDS, MAX_SHOWN_BOARDS, TABS, type AlertCategories, type Notice, type NoticeSource, type OwnerData, type Tab, type Task, type Theme } from "@/lib/client/types";
import { cachedCalendar, calendarTasks, linkCalendar, loadCalendar, unlinkCalendar, type CalendarView } from "@/lib/client/platoCalendar";
import { coursePosts, externalTasks, fetchOwnerData, lockOwner, pushOwnerState, syncOwnerNow, unlockOwner, type SyncState } from "@/lib/client/owner";
import { createSyncCode, deleteSyncCode, pushSyncCode, readSyncCode } from "@/lib/client/syncCode";
import { addDays, formatDate, formatDue, fromKst, kstDay } from "@/lib/client/time";
import { isFreshNotice } from "@/lib/client/notices";

/** While the app is open and visible. The server checks the boards every minute. */
const REFRESH_MS = 60 * 1000;

const NAV: { id: Tab; label: string; icon: typeof Sunrise }[] = [
  { id: "briefing", label: "Briefing", icon: Sunrise },
  { id: "notices", label: "Notices", icon: Newspaper },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "HH:mm" in Korea time. */
const kstClock = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);

/** How long Undo stays possible (the toast shows for 5 s). */
const UNDO_MS = 5500;

type ToastState = { id: number; message: string; action?: string; onAction?: () => void };

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

/** PLATO/NESPA items (and PLATO calendar items) are read-only: they can only be ticked off or cleared. */
const isExternalId = (id: string) => /^(plato_|platocal_|nespa_)/.test(id);

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
  let storedBoards = read<string[] | null>(KEYS.boards, null);
  // Before boards could be chosen, everyone saw CSE and International. Devices that have used
  // PNUtify keep that (so nobody loses a board); new devices start with International only.
  const usedBefore = seed === "done" || read<string[] | null>(KEYS.seededBoards, null) !== null;
  if (!Array.isArray(storedBoards) && usedBefore) {
    storedBoards = ["cse", "international"];
    write(KEYS.boards, storedBoards);
  }
  // Boards whose older notices were already marked read on this device.
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
  /** The last tab change came from a keyboard shortcut: switch instantly, without motion. */
  const [instantTab, setInstantTab] = useState(false);
  const goTab = useCallback((t: Tab) => {
    setInstantTab(false);
    setTab(t);
  }, []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** Day the Calendar should open on (from the Briefing's week strip). */
  const [calendarFocus, setCalendarFocus] = useState<{ day: string; n: number } | null>(null);
  /** Open Tasks with its add form, optionally due on a given day. */
  const [taskDraft, setTaskDraft] = useState<{ day: string | null; n: number } | null>(null);
  /** Tasks deleted a moment ago: hidden now, removed for good once Undo has passed. */
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(() => new Set());
  const pendingCommits = useRef(new Map<string, { run: () => void; timer: ReturnType<typeof setTimeout> }>());
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
  // PLATO deadlines from the student's calendar link (not on owner devices, which have PLATO already).
  const [calendar, setCalendar] = useState<CalendarView | null>(() => cachedCalendar());
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

  // ---------- PLATO calendar link: re-read on open, then every 10 minutes while visible ----------
  const lastCalendar = useRef(0);
  useEffect(() => {
    if (isOwner) return;
    const load = async () => {
      if (Date.now() - lastCalendar.current < 2 * 60_000) return;
      lastCalendar.current = Date.now();
      const view = await loadCalendar();
      if (view !== "offline") setCalendar(view);
    };
    load();
    const tick = setInterval(() => document.visibilityState === "visible" && Date.now() - lastCalendar.current > 10 * 60_000 && load(), 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isOwner]);

  const calendarActions = useMemo(
    () => ({
      link: async (url: string) => {
        const r = await linkCalendar(url);
        if (r.ok) {
          lastCalendar.current = Date.now();
          setCalendar(r.calendar);
        }
        return r;
      },
      refresh: async () => {
        const view = await loadCalendar(true);
        if (view === "offline") return false;
        lastCalendar.current = Date.now();
        setCalendar(view);
        return true;
      },
      unlink: async () => {
        await unlinkCalendar();
        setCalendar(null);
      },
    }),
    [],
  );

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
        // PLATO calendar items go too, so ones ticked off here aren't reminded (the owner's are handled on the server).
        body: JSON.stringify({ deviceId: getDeviceId(), tasks: alerts.tasks || alerts.weekly ? [...tasks, ...(isOwner ? [] : calendarTasks(calendar, external, Date.now()))] : [] }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [tasks, calendar, external, isOwner, alerts.tasks, alerts.weekly, alertsReady]);

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

  const externalList = useMemo(
    () => (isOwner ? externalTasks(ownerData, external, now) : calendarTasks(calendar, external, now)),
    [isOwner, ownerData, calendar, external, now],
  );
  const allTasks = useMemo(() => [...tasks, ...externalList], [tasks, externalList]);
  const posts = useMemo(() => (isOwner ? coursePosts(ownerData) : []), [isOwner, ownerData]);

  const taskActions = useMemo(() => {
    const stamp = () => Date.now();
    const tombstone = (ids: string[]) => setDeletedTasks((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, stamp()])) }));
    return {
      add: (t: Omit<Task, "id" | "status" | "createdAt">) => {
        const id = `own_${Date.now().toString(36)}`;
        setTasks((prev) => [{ ...t, id, status: "pending", createdAt: stamp(), updatedAt: stamp(), source: "own" }, ...prev]);
        return id;
      },
      update: (id: string, patch: Partial<Task>) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: stamp() } : t))),
      toggle: (id: string) => {
        // PLATO/NESPA items can't be edited, only ticked off (shared across the owner's devices).
        if (isExternalId(id)) {
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
        const own = new Set(ids.filter((id) => !isExternalId(id)));
        const external = ids.filter(isExternalId);
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

  // ---------- undo: deletions wait a few seconds, and every change says what happened ----------
  const showToast = useCallback((t: Omit<ToastState, "id">) => setToast({ id: Date.now(), ...t }), []);
  const unhide = useCallback((ids: string[]) => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);
  /** Hides `ids` now and runs `commit` once Undo is no longer possible. */
  const deferDelete = useCallback(
    (ids: string[], commit: () => void, message: string) => {
      const key = `${Date.now()}:${ids.join(",")}`;
      setHiddenTasks((prev) => new Set([...prev, ...ids]));
      const run = () => {
        const entry = pendingCommits.current.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingCommits.current.delete(key);
        commit();
        unhide(ids);
      };
      pendingCommits.current.set(key, { run, timer: setTimeout(run, UNDO_MS) });
      showToast({
        message,
        action: "Undo",
        onAction: () => {
          const entry = pendingCommits.current.get(key);
          if (entry) clearTimeout(entry.timer);
          pendingCommits.current.delete(key);
          unhide(ids);
        },
      });
    },
    [showToast, unhide],
  );
  // Leaving the page finishes any pending deletion, so it isn't lost.
  useEffect(() => {
    const flush = () => [...pendingCommits.current.values()].forEach((e) => e.run());
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const uiTaskActions: TaskActions = useMemo(
    () => ({
      add: (t) => {
        const id = taskActions.add(t);
        showToast({ message: `Added "${t.title}" · ${formatDue(t.dueDate, Date.now())}`, action: "Undo", onAction: () => taskActions.remove(id) });
      },
      update: taskActions.update,
      toggle: taskActions.toggle,
      remove: (id) => {
        const t = latest.current.tasks.find((x) => x.id === id);
        deferDelete([id], () => taskActions.remove(id), `Deleted "${t?.title ?? "task"}"`);
      },
      clearCompleted: (ids) => deferDelete(ids, () => taskActions.clearCompleted(ids), `Cleared ${plural(ids.length, "finished task")}`),
      postpone: (id) => {
        const t = latest.current.tasks.find((x) => x.id === id);
        if (!t) return;
        const before = t.dueDate;
        taskActions.update(id, { dueDate: fromKst(addDays(kstDay(Date.now()), 1), kstClock(before)) });
        showToast({ message: `Moved "${t.title}" to tomorrow`, action: "Undo", onAction: () => taskActions.update(id, { dueDate: before }) });
      },
    }),
    [taskActions, deferDelete, showToast],
  );

  const markAllRead = useCallback(
    (ids: string[]) => {
      markRead(ids);
      showToast({ message: `Marked ${plural(ids.length, "notice")} as read`, action: "Undo", onAction: () => markRead(ids, false) });
    },
    [markRead, showToast],
  );

  const openSettings = useCallback((section?: SettingsSection) => {
    setSettingsSection(section ?? null);
    setSettingsOpen(true);
  }, []);
  const addTask = useCallback(
    (day: string | null = null) => {
      setTaskDraft({ day, n: Date.now() });
      goTab("tasks");
    },
    [goTab],
  );
  const openCalendarDay = useCallback(
    (day: string) => {
      setCalendarFocus({ day, n: Date.now() });
      goTab("calendar");
    },
    [goTab],
  );

  // ---------- keyboard shortcuts: / search, n new task, 1-4 sections ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === "/") {
        e.preventDefault();
        setInstantTab(true);
        setTab("notices");
        // The list renders for phone and desktop; focus the one that's showing.
        setTimeout(() => [...document.querySelectorAll<HTMLInputElement>("#notice-search")].find((x) => x.offsetParent !== null)?.focus(), 30);
      } else if (e.key === "n") {
        e.preventDefault();
        addTask();
        setInstantTab(true);
      } else if (/^[1-4]$/.test(e.key)) {
        setInstantTab(true);
        setTab(NAV[Number(e.key) - 1].id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addTask]);

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
  const visibleTasks = useMemo(() => (hiddenTasks.size ? allTasks.filter((t) => !hiddenTasks.has(t.id)) : allTasks), [allTasks, hiddenTasks]);
  const pendingCount = useMemo(() => visibleTasks.filter((t) => t.status === "pending").length, [visibleTasks]);

  const content = (
    <div key={tab} className={instantTab ? undefined : "tab-enter"}>
      {tab === "briefing" && (
        <BriefingTab
          now={now}
          sinceTs={sinceTs}
          notices={shownNotices}
          boards={boards}
          readIds={readIds}
          tasks={visibleTasks}
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
          goTo={goTab}
          openSettings={openSettings}
          openCalendarDay={openCalendarDay}
          addTask={() => addTask()}
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
          onMarkAllRead={markAllRead}
          onRetry={() => fetchNotices()}
          openSettings={() => openSettings("alerts")}
        />
      )}
      {tab === "tasks" && (
        <TasksTab
          key={taskDraft?.n ?? "tasks"}
          now={now}
          tasks={visibleTasks}
          synced={isOwner || Boolean(syncCode)}
          actions={uiTaskActions}
          alerts={alerts}
          openSettings={() => openSettings("alerts")}
          draft={taskDraft}
          onDraftDone={() => setTaskDraft(null)}
        />
      )}
      {tab === "calendar" && (
        <CalendarTab key={calendarFocus?.n ?? "calendar"} now={now} tasks={visibleTasks} onToggleTask={taskActions.toggle} onAddTask={(day) => addTask(day)} focusDay={calendarFocus?.day} />
      )}
    </div>
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
          <button onClick={() => openSettings()} className="cozy-btn bg-card p-2 text-foreground" aria-label="Settings">
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
          <div className="cozy-card bg-card p-1.5 rounded-3xl">
            <Nav variant="bar" items={NAV} active={tab} onSelect={goTab} badge={badge} instant={instantTab} />
          </div>
        </nav>
      </div>

      {/* ---------- tablet / desktop ---------- */}
      <div className="hidden md:flex h-[100dvh] overflow-hidden">
        <aside className="w-64 lg:w-72 shrink-0 flex flex-col border-r-2 border-border bg-card">
          <div className="px-6 pt-8 pb-6 border-b-2 border-dashed border-border/30">
            <div className="washi-tape text-[11px] font-extrabold tracking-widest px-3 py-1 inline-block mb-4 -rotate-1">부산대학교</div>
            <div className="flex items-center gap-3">
              <AppLogo size={44} className="-rotate-2" />
              <h1 className="font-pixel text-3xl font-bold text-foreground">PNUtify</h1>
            </div>
            <p className="text-xs font-bold text-muted-foreground mt-3">{formatDate(now, { weekday: "long" })}</p>
            <p className="text-2xl font-extrabold tabular-nums text-primary">{formatDate(now, { month: "short", day: "numeric" })}</p>
          </div>
          <nav className="flex-1 px-4 py-6" aria-label="Sections">
            <Nav variant="side" items={NAV} active={tab} onSelect={goTab} badge={badge} instant={instantTab} />
          </nav>
          <div className="px-4 py-5 border-t-2 border-dashed border-border/30">
            <button
              onClick={() => openSettings()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm border-2 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <Settings size={20} />
              <span>Settings &amp; alerts</span>
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto px-8 lg:px-12 py-8">
          {/* The Briefing gets the whole width for its two-column front page; the lists stay readable. */}
          <div className={cn("mx-auto", tab === "briefing" ? "max-w-[78rem]" : "max-w-3xl")}>{content}</div>
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

      {toast && <Toast key={toast.id} message={toast.message} action={toast.action} onAction={toast.onAction} onClose={() => setToast((t) => (t?.id === toast.id ? null : t))} />}

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        focusSection={settingsSection}
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
        calendar={isOwner ? null : calendar}
        calendarActions={calendarActions}
        isOwner={isOwner}
        ownerData={ownerData}
        ownerActions={ownerActions}
      />
    </div>
  );
}
