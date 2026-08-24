"use client";

import { useState, useEffect, useRef } from "react"
import { format, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday, getDay } from "date-fns"
import { CalendarDays, Check, MapPin, MessageSquare, Scroll, Star, Globe, Monitor, GraduationCap, Sparkles, ExternalLink, X, ChevronLeft, ChevronRight, Eye, EyeOff, Bell, User, LogOut, LogIn, Plus, Edit2, Trash2 } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`
    localStorage.setItem('device_id', id)
  }
  return id
}

const safeDate = (d: any) => {
  if (!d) return new Date();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const formatNoticeDate = (dateStr: string) => {
  try {
    const cleanDate = dateStr.replace(/\./g, '-');
    const d = new Date(cleanDate);
    if(isNaN(d.getTime())) return dateStr;
    return format(d, "MMM dd");
  } catch(e) { return dateStr; }
}

const POLL_INTERVAL_MS = 3 * 60 * 1000;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type Theme = "pnu" | "cherry" | "midnight" | "autumn"
const THEMES: { id: Theme; label: string; emoji: string }[] = [
  { id: "pnu", label: "PNU Blue", emoji: "🔵" },
  { id: "cherry", label: "Blossom", emoji: "🌸" },
  { id: "midnight", label: "Twilight", emoji: "🌙" },
  { id: "autumn", label: "Autumn", emoji: "🍂" },
]

function AppLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={cn("rounded-2xl bg-primary text-primary-foreground border-2 border-border shadow-[2px_2px_0px_var(--color-border)] flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <GraduationCap size={Math.round(size * 0.55)} strokeWidth={2.5} />
    </div>
  )
}

function ThemeSwitcher({ current, onChange, compact }: { current: Theme; onChange: (t: Theme) => void; compact?: boolean }) {
  return (
    <div className={cn("flex gap-1.5", compact ? "flex-row" : "flex-row flex-wrap")}>
      {THEMES.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.label}
          className={cn(
            "flex items-center gap-1.5 transition-all duration-200 font-pixel font-bold",
            compact ? "w-7 h-7 rounded-lg border-2 justify-center" : "px-2 py-1.5 rounded-lg border-2 text-[10px] tracking-wide",
            current === t.id
              ? "border-border shadow-[2px_2px_0px_var(--color-border)] -translate-y-0.5 bg-card text-foreground scale-110"
              : "border-border/40 bg-card/50 text-muted-foreground hover:border-border hover:bg-card"
          )}
        >
          <span className="text-[14px] leading-none shrink-0">{t.emoji}</span>
          {!compact && <span>{t.label}</span>}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"notices" | "calendar" | "tasks" | "profile">("notices")
  const [theme, setTheme] = useState<Theme>("pnu")
  const [noticeCategory, setNoticeCategory] = useState<"international" | "cse" | "classes">("international")
  const [notices, setNotices] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [isLoadingNotices, setIsLoadingNotices] = useState(false)
  const [platoCreds, setPlatoCreds] = useState({ username: '', password: '' })
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isSyncingPlato, setIsSyncingPlato] = useState(false)
  const [selectedNotice, setSelectedNotice] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)

  useEffect(() => {
    if (!selectedNotice || !selectedNotice.url) { setDetail(null); return }
    let cancelled = false
    setDetail(null)
    fetch(`/api/notices/notice-detail?url=${encodeURIComponent(selectedNotice.url)}&title=${encodeURIComponent(selectedNotice.title || '')}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled && data.title) setDetail(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedNotice])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setSelectedNotice(null)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    setIsMounted(true);

    try {
      let initialCreds = { username: '', password: '' };
      let initialLogin = false;

      const savedCreds = localStorage.getItem('plato_creds_v2');
      if (savedCreds) {
        initialCreds = JSON.parse(savedCreds);
        setPlatoCreds(initialCreds);
      }

      const savedLogin = localStorage.getItem('is_logged_in_v2');
      if (savedLogin) {
        initialLogin = JSON.parse(savedLogin);
        setIsLoggedIn(initialLogin);
      }

      const savedTasks = localStorage.getItem('tasks_v2');
      if (savedTasks) {
        const parsed = JSON.parse(savedTasks);
        setTasks(Array.isArray(parsed) ? parsed : []);
      }

      const savedClasses = localStorage.getItem('classes_v2');
      if (savedClasses) {
        const parsed = JSON.parse(savedClasses);
        setClasses(Array.isArray(parsed) ? parsed : []);
      }

      const savedTheme = localStorage.getItem('theme_v1');
      if (savedTheme && ['pnu', 'cherry', 'midnight', 'autumn'].includes(savedTheme)) {
        setTheme(savedTheme as Theme);
      }

      const savedNotices = localStorage.getItem('notices_v2');
      if (savedNotices) {
        const parsed = JSON.parse(savedNotices);
        const validNotices = Array.isArray(parsed) ? parsed : [];
        setNotices(validNotices);
        fetchPublicNotices(validNotices);
      } else {
        fetchPublicNotices([]);
      }

      if (initialLogin && initialCreds.username && initialCreds.password) {
        syncPlato(true, initialCreds);
      }

    } catch (error) {
      localStorage.clear();
      setNotices([]); setTasks([]); setClasses([]);
      fetchPublicNotices([]);
    }
  }, []);

  useEffect(() => {
    if (isMounted) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme_v1', theme);
    }
  }, [theme, isMounted]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('plato_creds_v2', JSON.stringify(platoCreds));
      localStorage.setItem('is_logged_in_v2', JSON.stringify(isLoggedIn));
      localStorage.setItem('tasks_v2', JSON.stringify(tasks));
      localStorage.setItem('classes_v2', JSON.stringify(classes));
      localStorage.setItem('notices_v2', JSON.stringify(notices));
    }
  }, [platoCreds, isLoggedIn, tasks, classes, notices, isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    const t = setTimeout(() => {
      fetch('/api/tasks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks, deviceId: getDeviceId() }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [tasks, isMounted]);

  const noticesRef = useRef<any[]>([]);
  useEffect(() => { noticesRef.current = notices; }, [notices]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPublicNotices(noticesRef.current);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function fetchPublicNotices(existingNotices: any[]) {
    setIsLoadingNotices(true);
    try {
      const res = await fetch('/api/notices');
      const data = await res.json();
      if (data.notices && Array.isArray(data.notices)) {
        const formatted = data.notices.map((n: any) => ({ ...n, iconType: n.source === 'cse' ? 'cse' : 'international' }));
        const platoNotices = existingNotices.filter((n: any) => n.source === 'classes');

        if (existingNotices.length > 0) {
          const publicExisting = existingNotices.filter((n: any) => n.source !== 'classes');
          const existingIds = new Set(publicExisting.map((n: any) => n.id));
          const brandNewNotices = formatted.filter((n: any) => !existingIds.has(n.id));

          if (brandNewNotices.length > 0 && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification("New PNU Notice!", { body: brandNewNotices[0].title, icon: "/favicon.ico" });
          }

          const mergedPublic = formatted.map((fresh: any) => {
            const found = publicExisting.find((ex: any) => ex.id === fresh.id);
            return found ? { ...fresh, status: found.status } : fresh;
          });
          setNotices([...mergedPublic, ...platoNotices]);
        } else { 
          setNotices([...formatted, ...platoNotices]); 
        }
      }
    } catch (e) { console.error(e) } finally { setIsLoadingNotices(false) }
  }

  const syncPlato = async (silent = false, credsToUse = platoCreds) => {
    if (!credsToUse.username || !credsToUse.password) {
      if (!silent) alert("Enter PLATO credentials");
      return;
    }
    
    if (!silent) setIsSyncingPlato(true);
    
    try {
      const res = await fetch('/api/plato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credsToUse)
      });
      const data = await res.json();
      
      if (!res.ok || data.error) { 
        if (!silent) alert(data.error || "Failed to sync PLATO."); 
        if (!silent) setIsSyncingPlato(false); 
        return; 
      }
      
      if (data.announcements && Array.isArray(data.announcements)) {
        const formattedAnns = data.announcements.map((n: any) => ({ ...n, iconType: 'plato' }));
        
        setNotices(prev => {
          const prevSafe = prev || [];
          const publicNotices = prevSafe.filter(n => n.source !== 'classes');
          const oldPlato = prevSafe.filter(n => n.source === 'classes');

          const oldPlatoTitles = new Set(oldPlato.map((n: any) => n.title));
          const brandNewPlato = formattedAnns.filter((n: any) => !oldPlatoTitles.has(n.title));
          if (oldPlato.length > 0 && brandNewPlato.length > 0 && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification("New PLATO Announcement!", { body: brandNewPlato[0].title, icon: "/favicon.ico" });
          }

          const mergedPlato = formattedAnns.map((fresh: any) => {
            const found = oldPlato.find((ex: any) => ex.title === fresh.title);
            return found ? { ...fresh, status: found.status } : fresh;
          });
          
          return [...publicNotices, ...mergedPlato];
        });
      }

      if (data.tasks) {
        setTasks(prev => {
          const prevSafe = prev || [];
          const ownTasks = prevSafe.filter((t: any) => t.source === 'own');
          const oldPlatoTasks = prevSafe.filter((t: any) => t.source !== 'own');
          const incomingTasks = Array.isArray(data.tasks) ? data.tasks : [];
          const mergedPlato = incomingTasks.map((fresh: any) => {
            const found = oldPlatoTasks.find((ex: any) => ex.title === fresh.title);
            return { ...fresh, source: 'plato', status: found ? found.status : fresh.status };
          });
          return [...ownTasks, ...mergedPlato];
        });
      }

      if (data.classes) setClasses(Array.isArray(data.classes) ? data.classes : []);
      
      setIsLoggedIn(true); 
      if (!silent) alert("PLATO Synced Successfully!");
    } catch (e) { 
      if (!silent) alert("Network error: Failed to connect to PLATO."); 
    } 
    finally { if (!silent) setIsSyncingPlato(false); }
  }

  const handleLogout = () => {
    setIsLoggedIn(false); 
    setPlatoCreds({ username: '', password: '' });
    setClasses([]); 
    setTasks(prev => (prev || []).filter(t => t.source === 'own')); 
    setNotices((notices || []).filter(n => n.source !== 'classes'));
    alert("Logged out successfully.");
  }

  const toggleNotice = (id: string | number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setNotices((notices || []).map((n) => n.id === id ? { ...n, status: n.status === "unread" ? "read" : "unread" } : n))
  }

  const openNotice = (notice: any) => {
    setSelectedNotice(notice)
    setNotices((notices || []).map((n) => n.id === notice.id ? { ...n, status: "read" } : n))
  }

  const toggleTask = (id: string | number) => {
    setTasks((tasks || []).map((t) => t.id === id ? { ...t, status: t.status === "pending" ? "completed" : "pending" } : t))
  }

  const addTask = (title: string, course: string, dueDateStr?: string, dueTimeStr?: string) => {
    if (!title.trim()) return;
    const timePart = dueTimeStr || "23:59";
    const dueDate = dueDateStr ? new Date(`${dueDateStr}T${timePart}`) : new Date(Date.now() + 86400000 * 2);
    setTasks([{ id: `own_${Date.now()}`, title, course: course || "General", dueDate, status: "pending", source: "own" }, ...(tasks || [])]);
  }

  const editTask = (id: string | number, newTitle: string, newCourse: string, newDateStr: string, newTimeStr?: string) => {
    const timePart = newTimeStr || "23:59";
    setTasks((tasks || []).map(t => t.id === id ? { ...t, title: newTitle, course: newCourse || "General", dueDate: new Date(`${newDateStr}T${timePart}`) } : t));
  }

  const deleteTask = (id: string | number) => {
    setTasks((tasks || []).filter(t => t.id !== id));
  }

  if (!isMounted) return null;

  return (
    <div className="font-sans selection:bg-primary/20 selection:text-foreground">
      <div className="md:hidden min-h-[100dvh] flex items-center justify-center sm:p-4 bg-background sm:bg-background/95">
        <div className="w-full h-[100dvh] bg-background relative flex flex-col overflow-hidden sm:max-w-[430px] sm:h-[850px] sm:rounded-[2rem] sm:border-4 sm:border-border sm:shadow-[12px_12px_0px_var(--color-border)]">
          
          <div className="hidden sm:flex absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-muted border-b-2 border-x-2 border-border rounded-b-xl z-20 justify-center items-center shadow-sm">
            <div className="w-16 h-1 bg-border rounded-full opacity-30" />
          </div>

          <div 
            className="px-6 pb-4 flex justify-between items-end border-b-2 border-dashed border-border/20 z-10 relative bg-background"
            style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}
          >
            <div>
              <div className="flex items-center gap-3 mb-1">
                <AppLogo size={38} className="transform -rotate-2" />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-primary px-2 py-0.5 rounded-md border-2 border-border shadow-[2px_2px_0px_var(--color-border)]">
                    <GraduationCap size={12} className="text-primary-foreground" />
                    <span className="font-pixel text-[10px] font-bold text-primary-foreground tracking-widest">PNU</span>
                  </div>
                  <div className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-md border-2 border-border shadow-[2px_2px_0px_var(--color-border)]">
                    <span className="font-pixel text-[10px] font-bold text-secondary-foreground tracking-widest">CSE · AI</span>
                  </div>
                </div>
              </div>
              <h1 className="font-pixel text-4xl font-bold tracking-wide text-foreground">PNUtify</h1>
              <p className="text-sm font-bold text-primary mt-0.5">{format(new Date(), "EEEE, MMM d")}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="washi-tape px-3 py-1 font-pixel font-bold text-sm transform rotate-2 text-white">부산대</div>
              <ThemeSwitcher current={theme} onChange={setTheme} compact />
            </div>
          </div>

          <main className="flex-1 overflow-y-auto pb-32 px-6 bg-transparent">
            {activeTab === "notices" && <NoticesTab notices={notices} toggleNotice={toggleNotice} category={noticeCategory} setCategory={setNoticeCategory} isLoading={isLoadingNotices} onSelectNotice={openNotice}/>}
            {activeTab === "calendar" && <CalendarTab tasks={tasks} classes={classes} />}
            {activeTab === "tasks" && <JournalTab tasks={tasks} toggleTask={toggleTask} onAddTask={addTask} onEditTask={editTask} onDeleteTask={deleteTask} />}
            {activeTab === "profile" && <ProfileTab platoCreds={platoCreds} setPlatoCreds={setPlatoCreds} syncPlato={syncPlato} isSyncing={isSyncingPlato} isLoggedIn={isLoggedIn} handleLogout={handleLogout} classes={classes} />}
          </main>

          <div 
            className="absolute bottom-0 left-0 right-0 px-6 z-50 bg-gradient-to-t from-background via-background/90 to-transparent pt-8"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="cozy-card bg-card p-2 flex items-center justify-between relative overflow-hidden mb-2 rounded-3xl">
              <NavItem icon={<MessageSquare size={24} />} label="Notices" isActive={activeTab === "notices"} onClick={() => setActiveTab("notices")} />
              <NavItem icon={<CalendarDays size={24} />} label="Calendar" isActive={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
              <NavItem icon={<Check size={24} strokeWidth={3} />} label="Tasks" isActive={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
              <NavItem icon={<User size={24} />} label="Profile" isActive={activeTab === "profile"} onClick={() => setActiveTab("profile")} />
            </div>
          </div>
        </div>
      </div>

      <div className="hidden md:flex h-screen overflow-hidden bg-background/95">
        <aside className="w-64 lg:w-72 flex-shrink-0 flex flex-col border-r-2 border-border bg-card/80 backdrop-blur-sm relative overflow-hidden">
          <div className="px-6 pt-8 pb-6 border-b-2 border-dashed border-border/30">
            <div className="washi-tape text-white font-pixel text-[10px] font-bold tracking-widest px-3 py-1 inline-block mb-4 transform -rotate-1">부산대학교</div>
            <div className="flex items-center gap-3 mb-3 mt-1">
              <AppLogo size={44} className="transform -rotate-2" />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1 bg-primary px-2 py-0.5 rounded-md border-2 border-border shadow-[2px_2px_0px_var(--color-border)]">
                  <GraduationCap size={11} className="text-primary-foreground" />
                  <span className="font-pixel text-[9px] font-bold text-primary-foreground tracking-widest">PNU</span>
                </div>
                <div className="flex items-center gap-1 bg-secondary px-2 py-0.5 rounded-md border-2 border-border shadow-[2px_2px_0px_var(--color-border)]">
                  <span className="font-pixel text-[9px] font-bold text-secondary-foreground tracking-widest">CSE · AI</span>
                </div>
              </div>
            </div>
            <h1 className="font-pixel text-3xl font-bold text-foreground tracking-wide leading-tight">PNUtify</h1>
            <p className="text-xs font-bold text-muted-foreground mt-2">{format(new Date(), "EEEE")}</p>
            <p className="font-pixel text-2xl font-bold text-primary">{format(new Date(), "MMM d")}</p>
          </div>

          <nav className="flex-1 px-4 py-6 flex flex-col gap-2">
            <p className="font-pixel text-[10px] font-bold text-muted-foreground tracking-widest uppercase px-2 mb-2">Navigation</p>
            <SidebarNavItem icon={<MessageSquare size={20} />} label="Notices" badge={(notices || []).filter(n => n.status === "unread").length} isActive={activeTab === "notices"} onClick={() => setActiveTab("notices")} />
            <SidebarNavItem icon={<CalendarDays size={20} />} label="Calendar" isActive={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
            <SidebarNavItem icon={<Check size={20} strokeWidth={3} />} label="Tasks" badge={(tasks || []).filter(t => t.status === "pending").length} isActive={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
            <SidebarNavItem icon={<User size={20} />} label="Profile" isActive={activeTab === "profile"} onClick={() => setActiveTab("profile")} />
          </nav>

          <div className="px-6 py-5 border-t-2 border-dashed border-border/30 flex flex-col gap-3">
            <div className="cozy-card bg-primary/10 p-3 border-primary/30">
              <p className="font-pixel text-[9px] font-bold text-primary tracking-widest uppercase mb-1">정보의생명공학대학</p>
              <p className="text-xs font-bold text-muted-foreground leading-snug">인공지능전공</p>
            </div>
            <ThemeSwitcher current={theme} onChange={setTheme} />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-8 lg:px-12 py-8">
          <div className="flex items-center justify-between mb-8 max-w-4xl">
            <div>
              <h2 className="font-pixel text-2xl font-bold text-foreground capitalize">{activeTab === "notices" ? "Notices" : activeTab === "calendar" ? "Calendar" : activeTab === "tasks" ? "All Tasks" : "Profile"}</h2>
              <p className="text-sm text-muted-foreground font-bold mt-0.5">
                {activeTab === "notices" && `${(notices || []).filter(n => n.status === "unread").length} unread`}
                {activeTab === "calendar" && format(new Date(), "MMMM yyyy")}
                {activeTab === "tasks" && `${(tasks || []).filter(t => t.status === "pending").length} pending`}
                {activeTab === "profile" && (isLoggedIn ? "PLATO connected" : "Not connected")}
              </p>
            </div>
          </div>

          <div className="max-w-4xl">
             {activeTab === "notices" && <NoticesTab notices={notices} toggleNotice={toggleNotice} category={noticeCategory} setCategory={setNoticeCategory} isLoading={isLoadingNotices} onSelectNotice={openNotice}/>}
             {activeTab === "calendar" && <CalendarTab tasks={tasks} classes={classes} />}
             {activeTab === "tasks" && <JournalTab tasks={tasks} toggleTask={toggleTask} onAddTask={addTask} onEditTask={editTask} onDeleteTask={deleteTask} />}
             {activeTab === "profile" && <ProfileTab platoCreds={platoCreds} setPlatoCreds={setPlatoCreds} syncPlato={() => syncPlato(false, platoCreds)} isSyncing={isSyncingPlato} isLoggedIn={isLoggedIn} handleLogout={handleLogout} classes={classes} />}
          </div>
        </main>

        <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col border-l-2 border-border bg-card/60 overflow-y-auto">
          <TodayPanel tasks={tasks} classes={classes} />
        </aside>
      </div>

      {selectedNotice && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="cozy-card bg-card w-full max-w-md p-6 flex flex-col h-auto relative">
            <button onClick={() => setSelectedNotice(null)} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-lg border-2 border-transparent hover:border-border transition-all">
              <X size={20} />
            </button>

            <h2 className="font-bold text-foreground text-xl leading-snug mt-2 mb-6 pr-6">
              {detail?.title || selectedNotice.title}
            </h2>

            <div className="flex flex-col gap-2 shrink-0">
              {selectedNotice.url && (
                <a href={selectedNotice.url} target="_blank" rel="noopener noreferrer" className="cozy-btn flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 text-sm transition-all">
                  Open in Browser <ExternalLink size={16} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SidebarNavItem({ icon, label, badge, isActive, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-bold text-sm border-2", isActive ? "bg-primary text-primary-foreground border-border shadow-[3px_3px_0px_var(--color-border)] -translate-y-0.5" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
      <span className={cn("transition-transform duration-200", isActive && "scale-110")}>{icon}</span>
      <span className="font-pixel tracking-wide">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={cn("ml-auto font-pixel text-[10px] font-bold px-1.5 py-0.5 rounded-md border", isActive ? "bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30" : "bg-primary text-primary-foreground border-border")}>
          {badge}
        </span>
      )}
    </button>
  )
}

function TodayPanel({ tasks, classes }: any) {
  const today = new Date()
  const todayClasses = (classes || []).filter((c: any) => Array.isArray(c.days) && c.days.includes(getDay(today)))
  const upcomingTasks = (tasks || []).filter((t: any) => t.status === "pending").slice(0, 3)

  return (
    <div className="p-6 flex flex-col gap-6 h-full">
      <div>
        <div className="washi-tape text-white font-pixel text-[10px] font-bold tracking-widest px-3 py-1 inline-block mb-3 transform rotate-1">Today</div>
        <h3 className="font-pixel text-xl font-bold text-foreground">{format(today, "EEEE")}</h3>
        <p className="font-bold text-muted-foreground text-sm">{format(today, "MMMM d, yyyy")}</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays size={14} className="text-primary" />
          <p className="font-pixel text-xs font-bold text-primary tracking-widest uppercase">Today's Classes</p>
        </div>
        {todayClasses.length === 0 ? (
          <div className="cozy-card p-4 text-center border-dashed">
            <p className="text-sm font-bold text-muted-foreground">No classes today 🎉</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {todayClasses.map((cls: any) => (
              <div key={cls.id} className={cn("cozy-card p-3 relative overflow-hidden text-white", cls.color || 'bg-primary')}>
                <div className="relative z-10">
                  <p className="font-bold text-sm leading-tight">{cls.name}</p>
                  <div className="flex items-center gap-2 mt-1 opacity-80">
                    <span className="font-pixel text-[10px]">{cls.time ? cls.time.split(" ")[0] : "Online"}</span>
                    <span className="opacity-50">·</span>
                    <MapPin size={9} />
                    <span className="font-pixel text-[10px]">{cls.location}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Star size={14} className="text-secondary" fill="currentColor" />
          <p className="font-pixel text-xs font-bold text-secondary tracking-widest uppercase">Due Soon</p>
        </div>
        {upcomingTasks.length === 0 ? (
          <div className="cozy-card p-4 text-center border-dashed">
            <p className="text-sm font-bold text-muted-foreground">All caught up!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingTasks.map((task: any) => (
              <div key={task.id} className="cozy-card p-3 bg-background">
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="font-bold text-sm text-foreground leading-tight">{task.title}</p>
                    <p className="font-pixel text-[10px] text-muted-foreground mt-1">Due {format(safeDate(task.dueDate), "MMM d")}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto cozy-card bg-secondary/10 border-secondary/30 p-4">
        <p className="font-pixel text-[10px] tracking-widest text-secondary uppercase font-bold mb-1">Progress</p>
        <div className="flex items-end gap-2">
          <span className="font-pixel text-3xl font-bold text-foreground">{(tasks || []).filter((t: any) => t.status === "completed").length}</span>
          <span className="font-bold text-muted-foreground text-sm mb-1">/ {(tasks || []).length} tasks done</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted border border-border overflow-hidden">
          <div className="h-full bg-secondary rounded-full transition-all duration-500" style={{ width: `${(tasks || []).length === 0 ? 0 : ((tasks || []).filter((t: any) => t.status === "completed").length / (tasks || []).length) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

function NavItem({ icon, label, isActive, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-2xl transition-all duration-300 relative z-10", isActive ? "bg-muted text-foreground border-2 border-border shadow-[2px_2px_0px_var(--color-border)]" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-2 border-transparent")}>
      <div className={cn("transition-transform duration-300", isActive && "scale-110 text-primary")}>{icon}</div>
      <span className={cn("font-pixel text-[10px] tracking-wider font-bold", isActive ? "opacity-100" : "opacity-0 h-0 overflow-hidden")}>{label}</span>
    </button>
  )
}

function NoticesTab({ notices, toggleNotice, category, setCategory, isLoading, onSelectNotice }: any) {
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const filteredNotices = (notices || []).filter((n: any) => n.source === category);
  
  const unreadNotices = filteredNotices.filter((n: any) => n.status === "unread");
  const readNotices = filteredNotices.filter((n: any) => n.status === "read");

  const totalPages = Math.ceil(unreadNotices.length / pageSize) || 1;
  const paginatedUnread = unreadNotices.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      <div className="flex gap-2 mb-6">
        <CategoryTab icon={<Globe size={16} />} label="Intl." active={category === "international"} onClick={() => { setCategory("international"); setPage(1); }} />
        <CategoryTab icon={<Monitor size={16} />} label="CSE" active={category === "cse"} onClick={() => { setCategory("cse"); setPage(1); }} />
        <CategoryTab icon={<GraduationCap size={16} />} label="PLATO" active={category === "classes"} onClick={() => { setCategory("classes"); setPage(1); }} />
      </div>

      <div className="flex flex-col gap-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-primary">
            <Star size={16} fill="currentColor" />
            <h3 className="font-pixel text-lg font-bold">Unread</h3>
          </div>
          {category !== "classes" && (
            <NotificationToggle key={category} category={category} label={category === "cse" ? "CSE" : "Intl."} />
          )}
        </div>

        {isLoading ? (
          <div className="cozy-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card border-dashed">
            <span className="animate-spin text-primary"><Sparkles size={24} /></span>
            <p className="font-bold font-pixel">Connecting...</p>
          </div>
        ) : paginatedUnread.length === 0 ? (
          <div className="cozy-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card border-dashed">
            <p className="font-bold font-pixel">No unread notices here!</p>
          </div>
        ) : (
          paginatedUnread.map((notice: any, i: number) => {
            const iconComponent = notice.iconType === 'cse' ? <Monitor size={16} className="text-secondary" /> : notice.iconType === 'plato' ? <Scroll size={16} className="text-accent" /> : <Globe size={16} className="text-primary" />;
            return (
              <div key={notice.id} onClick={() => onSelectNotice(notice)} className="cozy-card interactive p-4 relative group cursor-pointer bg-card">
                <div className={cn("absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-5 washi-tape z-20", i % 2 === 0 ? "rotate-2" : "-rotate-3")} />
                
                <div className="flex gap-3 pt-2 items-start">
                  <div className="mt-1">
                    <div className="w-10 h-10 rounded-xl bg-background border-2 border-border flex items-center justify-center shadow-[2px_2px_0px_var(--color-border)]">{iconComponent}</div>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-foreground text-base leading-tight mb-2">{notice.title}</h3>
                    
                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      <span>{formatNoticeDate(notice.date)}</span>
                      <span className="opacity-50">•</span>
                      <span 
                        onClick={(e) => { e.stopPropagation(); toggleNotice(notice.id, e); }} 
                        className="text-primary italic hover:underline cursor-pointer normal-case"
                      >
                        Tap to mark read
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between cozy-card p-3 bg-card mb-8">
          <button disabled={page === 1} onClick={() => setPage(p => Math.max(p - 1, 1))} className="flex items-center gap-1 font-pixel text-xs font-bold px-3 py-1.5 rounded-lg border-2 border-border bg-background disabled:opacity-30 disabled:cursor-not-allowed cozy-btn">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="font-pixel text-xs font-bold text-foreground">Page {page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => Math.min(p + 1, totalPages))} className="flex items-center gap-1 font-pixel text-xs font-bold px-3 py-1.5 rounded-lg border-2 border-border bg-background disabled:opacity-30 disabled:cursor-not-allowed cozy-btn">
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      {readNotices.length > 0 && (
        <div className="mt-8 mb-4">
          <div className="flex items-center gap-2 mb-4 text-muted-foreground">
            <h3 className="font-pixel text-lg font-bold">Read</h3>
            <div className="h-0.5 flex-1 bg-border/20 border-dashed" />
          </div>

          <div className="flex flex-col gap-3">
            {readNotices.map((notice: any) => (
              <div
                key={notice.id}
                onClick={() => onSelectNotice(notice)}
                className="cozy-card interactive p-3 flex items-center gap-3 bg-muted/30 opacity-70 hover:opacity-100 transition-opacity border-dashed cursor-pointer"
              >
                <div className="flex-1">
                  <h4 className="font-bold text-foreground line-through decoration-2 mb-1">
                    {notice.title}
                  </h4>
                  <span className="font-pixel text-[10px] text-muted-foreground">
                    {formatNoticeDate(notice.date)}
                  </span>
                </div>
                <div 
                  onClick={(e) => { e.stopPropagation(); toggleNotice(notice.id, e); }} 
                  className="w-6 h-6 shrink-0 rounded bg-background border-2 border-border flex items-center justify-center text-foreground hover:bg-muted"
                >
                  <Check size={12} strokeWidth={3} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryTab({ icon, label, active, onClick }: any) {
  return (
    <button 
      onClick={onClick} 
      className={cn(
        "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl transition-all font-pixel text-sm font-bold border-2", 
        active 
          ? "bg-foreground text-background border-foreground shadow-[3px_3px_0px_var(--color-primary)] -translate-y-1" 
          : "bg-card text-muted-foreground border-border shadow-[2px_2px_0px_var(--color-border)] hover:bg-muted"
      )}
    >
      {icon} {label}
    </button>
  )
}

function CalendarTab({ tasks, classes }: any) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const calendarDays = eachDayOfInterval({ start: startOfWeek(startOfMonth(selectedDate)), end: endOfWeek(endOfMonth(selectedDate)) })
  
  const parsedTasks = (tasks || []).map((t: any) => ({ ...t, dueDate: safeDate(t.dueDate) }));
  const dayTasks = parsedTasks.filter((t: any) => isSameDay(t.dueDate, selectedDate))
  const dayClasses = (classes || []).filter((c: any) => Array.isArray(c.days) && c.days.includes(getDay(selectedDate)))

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      <div className="mb-6 bg-secondary text-secondary-foreground p-4 border-2 border-border shadow-[4px_4px_0px_var(--color-border)] rounded-xl transform rotate-1 relative overflow-hidden">
        <div className="absolute -right-2 -top-2 opacity-20"><CalendarDays size={72} /></div>
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3"><CalendarDays size={28} /><h2 className="font-pixel text-3xl font-bold tracking-wider">{format(selectedDate, "MMMM")}</h2></div>
          <span className="font-bold opacity-80">{format(selectedDate, "yyyy")}</span>
        </div>
      </div>
      <div className="cozy-card bg-card p-3 mb-8">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <div key={d} className="text-center font-pixel text-[10px] font-bold text-muted-foreground">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((date, i) => {
            const isSelected = isSameDay(date, selectedDate);
            const isCurrentMonth = isSameMonth(date, selectedDate);
            const hasTask = parsedTasks.some((t: any) => isSameDay(t.dueDate, date));
            const hasClass = (classes || []).some((c: any) => Array.isArray(c.days) && c.days.includes(getDay(date)));
            return (
              <button key={i} onClick={() => setSelectedDate(date)} className={cn("cozy-btn flex flex-col items-center p-1 h-12 relative transition-all", !isCurrentMonth && "opacity-30", isSelected ? "bg-foreground text-background shadow-[0px_0px_0px]" : "bg-background text-foreground hover:bg-muted", isToday(date) && !isSelected && "border-primary text-primary")}>
                <span className="font-pixel text-sm font-bold mt-1">{format(date, "d")}</span>
                <div className="flex gap-1 mt-auto mb-1">
                  {hasTask && <div className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-accent" : "bg-primary")} />}
                  {hasClass && <div className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-background" : "bg-secondary")} />}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <h3 className="font-pixel text-lg font-bold mb-4 text-foreground border-b-2 border-border/20 pb-2">{format(selectedDate, "EEEE, MMMM d")}</h3>
        <div className="flex flex-col gap-4">
          {dayClasses.map((cls: any) => (
            <div key={cls.id} className={cn("cozy-card p-3 relative overflow-hidden text-white", cls.color || "bg-primary")}>
              <div className="relative z-10 flex gap-3 items-center">
                <div className="font-pixel text-sm font-bold w-12 text-center leading-tight">{cls.time ? cls.time.split(" ")[0] : "Online"}</div>
                <div className="w-0.5 h-8 bg-current opacity-20" />
                <div>
                  <h4 className="font-bold">{cls.name}</h4>
                  <p className="font-pixel text-[10px] flex items-center gap-1 opacity-80"><MapPin size={10} /> {cls.location}</p>
                </div>
              </div>
            </div>
          ))}
          {dayTasks.map((task: any) => (
            <div key={task.id} className="cozy-card p-3 flex flex-col gap-1 border-dashed">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-primary" /><h4 className="font-bold text-foreground text-sm">{task.title}</h4></div>
              <p className="font-pixel text-[10px] text-muted-foreground pl-4 uppercase">Task • {task.course}</p>
            </div>
          ))}
          {dayClasses.length === 0 && dayTasks.length === 0 && (
            <p className="text-center text-sm font-bold text-muted-foreground italic py-4">Nothing scheduled for today.</p>
          )}
        </div>
      </div>
    </div>
  )
}

const notificationCache: Record<string, boolean> = {}

function NotificationToggle({ category, label }: { category: string; label: string }) {
  const [enabled, setEnabled] = useState(() => Boolean(notificationCache[category]))
  const [busy, setBusy] = useState(() => notificationCache[category] === undefined)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    let isMounted = true;

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (isMounted) setSupported(false)
      return
    }

    if (notificationCache[category] === undefined) {
       setBusy(true);
    }

    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        
        if (!sub) { 
          notificationCache[category] = false;
          if (isMounted) {
            setEnabled(false); 
            setBusy(false);
          }
          return; 
        }
        
        const res = await fetch(`/api/push/categories?deviceId=${encodeURIComponent(getDeviceId())}`)
        const data = await res.json()
        
        if (data?.categories) {
          Object.assign(notificationCache, data.categories)
        }

        if (isMounted) {
          setEnabled(Boolean(data?.categories?.[category]))
        }
      } catch {
        if (isMounted) setEnabled(false)
      } finally {
        if (isMounted) setBusy(false)
      }
    })()

    return () => { isMounted = false; }
  }, [category])

  const setCategory = async (value: boolean) => {
    setEnabled(value)
    notificationCache[category] = value
    
    await fetch('/api/push/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), category, enabled: value }),
    })
  }

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (enabled) {
        await setCategory(false)
        return
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') return
      let reg = await navigator.serviceWorker.getRegistration()
      if (!reg) reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) { alert("Push isn't configured yet."); return }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
        await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, deviceId: getDeviceId() }) })
      }
      await setCategory(true)
    } catch (e) {
      console.error('Notification toggle failed', e)
      setEnabled(Boolean(notificationCache[category])) 
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return null

  return (
    <button 
      onClick={toggle} 
      disabled={busy} 
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-border font-pixel text-[10px] font-bold shrink-0 transition-all", 
        enabled && !busy ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
        busy ? "opacity-60 cursor-not-allowed" : "" 
      )}
    >
      <Bell size={12} /> {label}: {busy ? "..." : enabled ? "On" : "Off"}
    </button>
  )
}

function ProfileTab({ platoCreds, setPlatoCreds, syncPlato, isSyncing, isLoggedIn, handleLogout, classes }: any) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4 max-w-2xl">

      {isLoggedIn ? (
        <div className="cozy-card bg-card p-6 mb-8 flex flex-col items-center relative overflow-hidden">
          <div className="absolute top-0 w-full h-24 bg-primary/20 border-b-2 border-border" />
          <div className="w-24 h-24 rounded-full border-4 border-card bg-background shadow-[4px_4px_0px_var(--color-border)] relative z-10 flex items-center justify-center text-primary mt-8 mb-4">
            <GraduationCap size={40} strokeWidth={2.5} />
          </div>
          <h2 className="font-pixel text-2xl font-bold text-foreground">{platoCreds.username}</h2>
          <p className="font-bold text-muted-foreground mb-6">PLATO Connected</p>

          <div className="w-full space-y-3 mb-6">
            <div className="bg-muted/50 p-3 rounded-lg flex items-center justify-between border-2 border-transparent">
              <span className="font-pixel text-xs font-bold text-muted-foreground uppercase tracking-widest">Status</span>
              <span className="font-bold text-foreground text-sm">Synced</span>
            </div>
            <div className="bg-muted/50 p-3 rounded-lg flex items-center justify-between border-2 border-transparent">
              <span className="font-pixel text-xs font-bold text-muted-foreground uppercase tracking-widest">Classes</span>
              <span className="font-bold text-foreground text-sm">{(classes || []).length} registered</span>
            </div>
          </div>

          <button onClick={handleLogout} className="cozy-btn w-full py-3 bg-background border-2 border-border text-foreground font-pixel font-bold flex items-center justify-center gap-2 hover:bg-muted">
            <LogOut size={18} /> Disconnect / Logout
          </button>
        </div>
      ) : (
        <div className="mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center border-2 border-border shadow-[4px_4px_0px_var(--color-border)] transform -rotate-3 mb-4">
            <LogIn size={32} />
          </div>
          <h2 className="font-pixel text-3xl font-bold text-foreground">Welcome back!</h2>
          <p className="font-bold text-muted-foreground mb-6">Sign in to sync your schedule.</p>

          <div className="cozy-card bg-card p-6 flex flex-col gap-4">
            <div>
              <label className="font-pixel text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 block">Student ID</label>
              <input type="text" placeholder="e.g. 202412345" className="w-full bg-background border-2 border-border rounded-lg p-3 text-sm focus:outline-none focus:border-primary" value={platoCreds.username} onChange={e => setPlatoCreds({...platoCreds, username: e.target.value})} />
            </div>
            <div>
              <label className="font-pixel text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 block">Password</label>
              <div className="relative w-full">
                <input type={showPassword ? "text" : "password"} className="w-full bg-background border-2 border-border rounded-lg p-3 pr-10 text-sm focus:outline-none focus:border-primary" value={platoCreds.password} onChange={e => setPlatoCreds({...platoCreds, password: e.target.value})} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">{showPassword ? <Eye size={18} /> : <EyeOff size={18} />}</button>
              </div>
            </div>
            <button onClick={syncPlato} disabled={isSyncing} className="cozy-btn w-full py-3 bg-primary border-2 border-border text-primary-foreground shadow-[4px_4px_0px_var(--color-border)] font-pixel font-bold flex items-center justify-center gap-2 hover:bg-primary/90">
              {isSyncing ? 'Scraping...' : 'Login'}
            </button>
          </div>
        </div>
      )}

      {isLoggedIn && (classes || []).length > 0 && (
        <div>
          <h3 className="font-pixel text-lg font-bold text-foreground mb-3 border-b-2 border-border/20 pb-2">Registered Classes</h3>
          <div className="flex flex-col gap-3">
            {classes.map((cls: any) => (
              <div key={cls.id} className={cn("cozy-card p-3 relative overflow-hidden text-white", cls.color || "bg-primary")}>
                <div className="relative z-10 text-left">
                  <p className="font-bold text-sm leading-tight">{cls.name}</p>
                  <div className="flex items-center gap-2 mt-1 opacity-80">
                    <span className="font-pixel text-[10px]">{cls.time ? cls.time.split(" ")[0] : "Online"}</span>
                    <span className="opacity-50">·</span>
                    <MapPin size={9} />
                    <span className="font-pixel text-[10px]">{cls.location}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function JournalTab({ tasks, toggleTask, onAddTask, onEditTask, onDeleteTask }: any) {
  const [filter, setFilter] = useState<"own" | "plato">("own")
  const filteredTasks = (tasks || []).filter((t: any) => (t.source || 'plato') === filter)
  const pending = filteredTasks.filter((a: any) => a.status === "pending")
  const completed = filteredTasks.filter((a: any) => a.status === "completed")

  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newCourse, setNewCourse] = useState("")
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [newTime, setNewTime] = useState("23:59")

  const [editingId, setEditingId] = useState<string | number | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editCourse, setEditCourse] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editTime, setEditTime] = useState("23:59")

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAddTask(newTitle, newCourse, newDate, newTime)
    setNewTitle(""); setNewCourse(""); setNewDate(format(new Date(), "yyyy-MM-dd")); setNewTime("23:59"); setIsAdding(false)
  }

  const startEdit = (id: string | number, currentTitle: string, currentCourse: string, currentDueDate: any, e: React.MouseEvent) => {
    e.stopPropagation()
    const d = safeDate(currentDueDate)
    setEditingId(id); setEditTitle(currentTitle); setEditCourse(currentCourse); setEditDate(format(d, "yyyy-MM-dd")); setEditTime(format(d, "HH:mm"))
  }

  const saveEdit = (id: string | number, e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation()
    if (e.type === "submit") e.preventDefault()
    if (editTitle.trim()) onEditTask(id, editTitle, editCourse, editDate, editTime)
    setEditingId(null)
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4 max-w-2xl">
      <div className="mb-6 bg-primary text-primary-foreground p-4 border-2 border-border shadow-[4px_4px_0px_var(--color-border)] rounded-xl transform -rotate-1 relative overflow-hidden flex justify-between items-center">
        <div className="absolute -left-4 -top-4 opacity-20"><Check size={80} strokeWidth={4} /></div>
        <div className="flex items-center gap-3 relative z-10"><Check size={28} strokeWidth={3} /><h2 className="font-pixel text-3xl font-bold tracking-wider">Tasks</h2></div>
        <div className="relative z-10 flex items-center gap-2">
          <div className="bg-secondary border-2 border-border text-secondary-foreground font-pixel font-bold px-3 py-1 rounded-lg shadow-[2px_2px_0px_var(--color-border)] rotate-3">{pending.length} Left</div>
          {filter === "own" && (
            <button onClick={() => setIsAdding(!isAdding)} className="w-10 h-10 bg-background text-foreground border-2 border-border shadow-[2px_2px_0px_var(--color-border)] rounded-xl flex items-center justify-center hover:bg-muted transition-colors active:translate-y-0.5 active:translate-x-0.5 active:shadow-[0px_0px_0px_var(--color-border)]">
              <Plus size={20} strokeWidth={3} />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-6 items-center justify-between">
        <div className="flex gap-2">
          <CategoryTab icon={<User size={16} />} label="Mine" active={filter === "own"} onClick={() => setFilter("own")} />
          <CategoryTab icon={<GraduationCap size={16} />} label="PLATO" active={filter === "plato"} onClick={() => setFilter("plato")} />
        </div>
        <NotificationToggle key="tasks" category="tasks" label="Deadlines" />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          {isAdding && filter === "own" && (
            <form onSubmit={handleAddSubmit} className="cozy-card bg-card p-4 border-2 border-dashed border-primary">
              <div className="flex flex-col gap-3">
                <input type="text" placeholder="Task title..." required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full bg-background border-2 border-border rounded-lg px-3 py-2 font-bold focus:outline-none focus:border-primary" />
                <div className="flex flex-wrap gap-2">
                  <input type="text" placeholder="Course (optional)" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} className="flex-1 min-w-[120px] bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary" />
                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary text-foreground min-w-[130px]" />
                  <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="bg-background border-2 border-border rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-primary text-foreground min-w-[100px]" />
                  <button type="submit" className="cozy-btn bg-primary text-primary-foreground font-pixel font-bold px-4 py-2 flex items-center justify-center gap-2 grow sm:grow-0">
                    <Plus size={16} /> Add
                  </button>
                </div>
              </div>
            </form>
          )}

          {pending.length === 0 && !isAdding && (
            <div className="cozy-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card border-dashed">
              <p className="font-bold font-pixel">{filter === "own" ? "No tasks yet — tap + to add one." : "No PLATO tasks synced."}</p>
            </div>
          )}

          {pending.map((task: any) => (
            <div key={task.id} onClick={() => { if (editingId !== task.id) toggleTask(task.id) }} className={cn("cozy-card p-4 flex gap-4 items-start group bg-card", editingId !== task.id && "interactive cursor-pointer")}>
              <div className="w-8 h-8 rounded-lg border-2 border-border cozy-btn group-hover:bg-primary/20 flex items-center justify-center shrink-0 transition-colors mt-0.5"></div>
              <div className="flex-1">
                {editingId === task.id ? (
                  <form onSubmit={(e) => saveEdit(task.id, e)} className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                    <input type="text" autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full bg-background border-2 border-border rounded-lg px-2 py-1 font-bold focus:outline-none focus:border-primary" />
                    <div className="flex flex-wrap gap-2">
                      <input type="text" placeholder="Course" value={editCourse} onChange={(e) => setEditCourse(e.target.value)} className="flex-1 min-w-[120px] bg-background border-2 border-border rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:border-primary" />
                      <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="bg-background border-2 border-border rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:border-primary text-foreground min-w-[130px]" />
                      <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="bg-background border-2 border-border rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:border-primary text-foreground min-w-[100px]" />
                      <button type="submit" className="cozy-btn bg-primary text-primary-foreground p-1.5 rounded-lg flex items-center justify-center shrink-0"><Check size={16} /></button>
                    </div>
                  </form>
                ) : (
                  <>
                    <h4 className="font-bold text-foreground text-xl leading-tight mb-2 flex items-start justify-between gap-4">
                      {task.title}
                      {task.source === "own" && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={(e) => startEdit(task.id, task.title, task.course, task.dueDate, e)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground transition-colors"><Edit2 size={16} /></button>
                          <button onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"><Trash2 size={16} /></button>
                        </div>
                      )}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-pixel text-[10px] uppercase font-bold text-primary-foreground bg-primary px-2 py-1 rounded-md border-2 border-border shadow-[1px_1px_0px_var(--color-border)]">{task.course}</span>
                      <span className="font-pixel text-xs font-bold text-secondary flex items-center gap-1 border-2 border-secondary/30 bg-secondary/10 px-2 py-0.5 rounded-md">Due {format(safeDate(task.dueDate), "MMM d, h:mm a")}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {completed.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-4 text-muted-foreground"><h3 className="font-pixel text-lg font-bold">Done</h3><div className="h-0.5 flex-1 bg-border/20 border-dashed" /></div>
            <div className="flex flex-col gap-3">
              {completed.map((task: any) => (
                <div key={task.id} onClick={() => toggleTask(task.id)} className="cozy-card p-4 flex gap-4 items-center cursor-pointer opacity-70 bg-muted/20 hover:opacity-100 transition-opacity border-dashed">
                  <div className="w-8 h-8 rounded-lg bg-secondary border-2 border-border flex items-center justify-center shrink-0 cozy-btn text-white"><Check size={20} strokeWidth={4} /></div>
                  <div className="flex-1"><h4 className="font-bold text-foreground text-lg line-through decoration-2 mb-1 opacity-60">{task.title}</h4></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}