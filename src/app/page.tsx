"use client";

import { useState, useEffect } from "react"
import { format, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday, getDay } from "date-fns"
import { CalendarDays, Check, MapPin, MessageSquare, Scroll, Star, Coffee, BookOpen, Globe, Monitor, GraduationCap, Sparkles } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"notices" | "calendar" | "tasks">("notices")
  const [noticeCategory, setNoticeCategory] = useState<"international" | "cse" | "classes">("international")
  
  // Dynamic State replacing MOCK DATA
  const [notices, setNotices] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [isLoadingNotices, setIsLoadingNotices] = useState(true)

  const [platoCreds, setPlatoCreds] = useState({ username: '', password: '' })
  const [isSyncingPlato, setIsSyncingPlato] = useState(false)

  // Fetch Public Notices
  useEffect(() => {
    async function fetchNotices() {
      try {
        const res = await fetch('/api/notices');
        const data = await res.json();
        if (data.notices) {
          const formatted = data.notices.map((n: any) => ({
            ...n,
            icon: n.source === 'cse' ? <Monitor size={16} className="text-primary" /> : <Globe size={16} className="text-accent" />
          }));
          setNotices(formatted);
        }
      } catch (e) { console.error(e) } 
      finally { setIsLoadingNotices(false) }
    }
    fetchNotices();
  }, []);

  // Sync PLATO
  const syncPlato = async () => {
    if (!platoCreds.username || !platoCreds.password) return alert("Enter PLATO credentials");
    setIsSyncingPlato(true);
    try {
      const res = await fetch('/api/plato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(platoCreds)
      });
      const data = await res.json();
      
      if (data.announcements) {
        const formattedAnns = data.announcements.map((n: any) => ({
          ...n, icon: <GraduationCap size={16} className="text-secondary" />
        }));
        setNotices(prev => [...prev, ...formattedAnns]);
      }
      if (data.tasks) setTasks(data.tasks);
      if (data.classes) setClasses(data.classes);
      
      alert("PLATO Synced Successfully!");
    } catch (e) { alert("Failed to sync PLATO"); } 
    finally { setIsSyncingPlato(false); }
  }

  const toggleNotice = (id: number) => {
    setNotices(notices.map((n) => n.id === id ? { ...n, status: n.status === "unread" ? "read" : "unread" } : n))
  }

  const toggleTask = (id: number) => {
    setTasks(tasks.map((t) => t.id === id ? { ...t, status: t.status === "pending" ? "completed" : "pending" } : t))
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans selection:bg-accent selection:text-foreground">
      {/* 
        Mobile Constraint Wrapper 
        I removed the "sm:" prefixes here so the thick border and rounded corners render 
        perfectly in your Chrome mobile emulator, just like Figma! 
      */}
      <div className="w-full max-w-[430px] h-[850px] bg-background/95 relative flex flex-col overflow-hidden rounded-[2rem] border-4 border-border shadow-[12px_12px_0px_var(--color-border)]">
        
        {/* Planner Binder Clip Header */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-muted border-b-2 border-x-2 border-border rounded-b-xl z-20 flex justify-center items-center shadow-sm">
          <div className="w-16 h-1 bg-border rounded-full opacity-30" />
        </div>

        {/* Soft Header */}
        <div className="px-6 pt-10 pb-4 flex justify-between items-end border-b-2 border-dashed border-border/20 z-10 relative">
          <div>
            <h1 className="font-pixel text-4xl font-bold tracking-wide text-foreground">
              Student OS.
            </h1>
            <p className="text-sm font-bold text-primary mt-1">
              Vol 2 • {format(new Date(), "EEEE")}
            </p>
          </div>
          <div className="washi-tape px-3 py-1 font-pixel font-bold text-sm transform rotate-2">
            {format(new Date(), "MMM d")}
          </div>
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto pb-32 px-6">
          {activeTab === "notices" && (
            <NoticesTab notices={notices} toggleNotice={toggleNotice} category={noticeCategory} setCategory={setNoticeCategory} isLoading={isLoadingNotices} />
          )}
          {activeTab === "calendar" && <CalendarTab tasks={tasks} classes={classes} />}
          {activeTab === "tasks" && (
            <JournalTab tasks={tasks} toggleTask={toggleTask} platoCreds={platoCreds} setPlatoCreds={setPlatoCreds} syncPlato={syncPlato} isSyncing={isSyncingPlato} />
          )}
        </main>

        {/* Floating Graphical Navigation Dock */}
        <div className="absolute bottom-6 left-0 right-0 px-6 z-50">
          <div className="cozy-card bg-card p-2 flex items-center justify-between relative overflow-hidden">
            <NavItem icon={<MessageSquare size={24} />} label="Notices" isActive={activeTab === "notices"} onClick={() => setActiveTab("notices")} />
            <NavItem icon={<CalendarDays size={24} />} label="Calendar" isActive={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
            <NavItem icon={<Check size={24} strokeWidth={3} />} label="Tasks" isActive={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
          </div>
        </div>
      </div>
    </div>
  )
}

function NavItem({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-xl transition-all duration-300 relative z-10",
        isActive
          ? "bg-accent text-accent-foreground border-2 border-border shadow-[2px_2px_0px_var(--color-border)] -translate-y-1"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-2 border-transparent",
      )}
    >
      <div className={cn("transition-transform duration-300", isActive && "scale-110")}>{icon}</div>
      <span className={cn("font-pixel text-xs tracking-wider font-bold", isActive ? "opacity-100" : "opacity-0 h-0 overflow-hidden")}>{label}</span>
    </button>
  )
}

function NoticesTab({ notices, toggleNotice, category, setCategory, isLoading }: any) {
  const filteredNotices = notices.filter((n: any) => n.source === category)
  const unreadNotices = filteredNotices.filter((n: any) => n.status === "unread")
  const readNotices = filteredNotices.filter((n: any) => n.status === "read")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      <div className="flex gap-2 mb-6">
        <CategoryTab icon={<Globe size={16} />} label="Intl." active={category === "international"} onClick={() => setCategory("international")} />
        <CategoryTab icon={<Monitor size={16} />} label="CSE" active={category === "cse"} onClick={() => setCategory("cse")} />
        <CategoryTab icon={<GraduationCap size={16} />} label="Class" active={category === "classes"} onClick={() => setCategory("classes")} />
      </div>

      <div className="flex flex-col gap-5 mb-8">
        <div className="flex items-center gap-2 mb-1 text-primary">
          <Star size={16} fill="currentColor" />
          <h3 className="font-pixel text-lg font-bold">Unread</h3>
        </div>

        {isLoading ? (
          <div className="cozy-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card border-dashed">
            <span className="animate-spin text-primary"><Sparkles size={24} /></span>
            <p className="font-bold">Fetching notices...</p>
          </div>
        ) : unreadNotices.length === 0 ? (
          <div className="cozy-card p-6 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card border-dashed">
            <p className="font-bold">No unread notices here!</p>
          </div>
        ) : (
          unreadNotices.map((notice: any, i: number) => (
            <div key={notice.id} onClick={() => toggleNotice(notice.id)} className="cozy-card interactive p-4 relative group bg-[#FFFCF2] cursor-pointer">
              <div className={cn("absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-5 washi-tape z-20", i % 2 === 0 ? "rotate-2" : "-rotate-3", i % 3 === 0 ? "bg-[#81B29A]/80" : "")} />
              <div className="flex gap-3 pt-2">
                <div className="mt-1">
                  <div className="w-10 h-10 rounded-xl bg-background border-2 border-border flex items-center justify-center shadow-[2px_2px_0px_var(--color-border)]">
                    {notice.icon}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-lg leading-tight mb-2 line-clamp-2">{notice.title}</h3>
                  <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                    <span>{notice.date}</span>
                    <span className="opacity-50">•</span>
                    <span className="text-primary italic">Tap to mark read</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {readNotices.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-4 text-muted-foreground">
            <h3 className="font-pixel text-lg font-bold">Read</h3>
            <div className="h-0.5 flex-1 bg-border/20 border-dashed" />
          </div>
          <div className="flex flex-col gap-3">
            {readNotices.map((notice: any) => (
              <div key={notice.id} onClick={() => toggleNotice(notice.id)} className="cozy-card interactive p-3 flex items-center gap-3 bg-muted/30 opacity-70 hover:opacity-100 transition-opacity border-dashed cursor-pointer">
                <div className="flex-1">
                  <h4 className="font-bold text-foreground line-through decoration-2 mb-1">{notice.title}</h4>
                  <span className="font-pixel text-[10px] text-muted-foreground">{notice.date}</span>
                </div>
                <div className="w-6 h-6 rounded bg-background border-2 border-border flex items-center justify-center text-foreground"><Check size={12} strokeWidth={3} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryTab({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex-1 flex items-center justify-center gap-2 py-2 rounded-xl transition-all font-pixel text-sm font-bold border-2", active ? "bg-foreground text-background border-foreground shadow-[3px_3px_0px_var(--color-primary)] -translate-y-1" : "bg-card text-muted-foreground border-border shadow-[2px_2px_0px_var(--color-border)] hover:bg-muted")}>
      {icon} {label}
    </button>
  )
}

function CalendarTab({ tasks, classes }: any) {
  const today = new Date()
  const [selectedDate, setSelectedDate] = useState(today)
  const monthStart = startOfMonth(selectedDate)
  const monthEnd = endOfMonth(selectedDate)
  const calendarDays = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) })

  const dayTasks = tasks.filter((t: any) => isSameDay(t.dueDate, selectedDate))
  const dayClasses = classes.filter((c: any) => c.days.includes(getDay(selectedDate)))

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
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (<div key={d} className="text-center font-pixel text-[10px] font-bold text-muted-foreground">{d}</div>))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((date, i) => {
            const isSelected = isSameDay(date, selectedDate)
            const isCurrentMonth = isSameMonth(date, selectedDate)
            const hasTask = tasks.some((t: any) => isSameDay(t.dueDate, date))
            const hasClass = classes.some((c: any) => c.days.includes(getDay(date)))

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
          {dayClasses.length === 0 && dayTasks.length === 0 && (
            <p className="text-sm font-bold text-muted-foreground italic text-center py-4">Nothing scheduled for today.</p>
          )}

          {dayClasses.map((cls: any) => (
            <div key={cls.id} className={cn("cozy-card p-3 relative overflow-hidden", cls.color)}>
              {cls.graphic}
              <div className="relative z-10 flex gap-3 items-center">
                <div className="font-pixel text-sm font-bold w-12 text-center leading-tight">{cls.time}</div>
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
        </div>
      </div>
    </div>
  )
}

function JournalTab({ tasks, toggleTask, platoCreds, setPlatoCreds, syncPlato, isSyncing }: any) {
  const pending = tasks.filter((a: any) => a.status === "pending")
  const completed = tasks.filter((a: any) => a.status === "completed")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      
      {/* PLATO Sync Form matched to original styling */}
      <div className="mb-6 cozy-card bg-card p-4 flex flex-col gap-3 border-dashed">
        <p className="font-pixel text-sm font-bold text-foreground flex items-center gap-2"><GraduationCap size={16}/> Sync PLATO Dashboard</p>
        <div className="flex gap-2">
          <input type="text" placeholder="ID" className="flex-1 bg-background border-2 border-border rounded-lg p-2 text-sm focus:outline-none focus:border-primary" value={platoCreds.username} onChange={e => setPlatoCreds({...platoCreds, username: e.target.value})} />
          <input type="password" placeholder="Pass" className="flex-1 bg-background border-2 border-border rounded-lg p-2 text-sm focus:outline-none focus:border-primary" value={platoCreds.password} onChange={e => setPlatoCreds({...platoCreds, password: e.target.value})} />
        </div>
        <button onClick={syncPlato} disabled={isSyncing} className="cozy-btn bg-secondary text-secondary-foreground font-bold py-2 mt-1 w-full text-center">
          {isSyncing ? 'Scraping PLATO...' : 'Fetch Deadlines & Classes'}
        </button>
      </div>

      <div className="mb-8 bg-accent text-accent-foreground p-4 border-2 border-border shadow-[4px_4px_0px_var(--color-border)] rounded-xl transform -rotate-1 relative overflow-hidden flex justify-between items-center">
        <div className="absolute -left-4 -top-4 opacity-20"><Check size={80} strokeWidth={4} /></div>
        <div className="flex items-center gap-3 relative z-10"><Check size={28} strokeWidth={3} /><h2 className="font-pixel text-3xl font-bold tracking-wider">All Tasks</h2></div>
        <div className="relative z-10 bg-background border-2 border-border text-foreground font-pixel font-bold px-3 py-1 rounded-lg shadow-[2px_2px_0px_var(--color-border)] rotate-3">{pending.length} Left</div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          {pending.map((task: any) => (
            <div key={task.id} onClick={() => toggleTask(task.id)} className="cozy-card interactive p-4 flex gap-4 items-start cursor-pointer group bg-card">
              <div className="w-8 h-8 rounded-lg border-2 border-border cozy-btn group-hover:bg-primary/20 flex items-center justify-center shrink-0 transition-colors mt-0.5"></div>
              <div className="flex-1">
                <h4 className="font-bold text-foreground text-xl leading-tight mb-2">{task.title}</h4>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-pixel text-[10px] uppercase font-bold text-background bg-foreground px-2 py-1 rounded-md border-2 border-transparent">{task.course}</span>
                  <span className="font-pixel text-xs font-bold text-primary flex items-center gap-1 border-2 border-primary/20 bg-primary/10 px-2 py-0.5 rounded-md">Due {format(task.dueDate, "MMM d")}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {completed.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-4 text-muted-foreground">
              <h3 className="font-pixel text-lg font-bold">Done</h3>
              <div className="h-0.5 flex-1 bg-border/20 border-dashed" />
            </div>
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