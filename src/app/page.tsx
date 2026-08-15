"use client";

import { useState, useEffect } from "react"
import { format, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday, getDay } from "date-fns"
import { CalendarDays, Check, MapPin, MessageSquare, Star, Globe, Monitor, GraduationCap, Sparkles } from "lucide-react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

export default function App() {
  const [activeTab, setActiveTab] = useState<"notices" | "calendar" | "tasks">("notices")
  const [noticeCategory, setNoticeCategory] = useState<"international" | "cse" | "classes">("international")
  
  const [notices, setNotices] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [classes, setClasses] = useState<any[]>([])
  const [isLoadingNotices, setIsLoadingNotices] = useState(true)

  const [platoCreds, setPlatoCreds] = useState({ username: '', password: '' })
  const [isSyncingPlato, setIsSyncingPlato] = useState(false)

  useEffect(() => {
    async function fetchNotices() {
      try {
        const res = await fetch('/api/notices');
        const data = await res.json();
        if (data.notices) {
          const formatted = data.notices.map((n: any) => ({
            ...n,
            icon: n.source === 'cse' ? <Monitor size={16} className="text-[#E07A5F]" /> : <Globe size={16} className="text-[#F2CC8F]" />
          }));
          setNotices(formatted);
        }
      } catch (e) { console.error(e) } 
      finally { setIsLoadingNotices(false) }
    }
    fetchNotices();
  }, []);

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
          ...n, icon: <GraduationCap size={16} className="text-[#81B29A]" />
        }));
        setNotices(prev => [...prev, ...formattedAnns]);
      }
      if (data.tasks) setTasks(data.tasks);
      if (data.classes) setClasses(data.classes);
      
      alert("PLATO Synced Successfully!");
    } catch (e) { alert("Failed to sync PLATO"); } 
    finally { setIsSyncingPlato(false); }
  }

  const toggleNotice = (id: string | number) => {
    setNotices(notices.map((n) => n.id === id ? { ...n, status: n.status === "unread" ? "read" : "unread" } : n))
  }
  const toggleTask = (id: string | number) => {
    setTasks(tasks.map((t) => t.id === id ? { ...t, status: t.status === "pending" ? "completed" : "pending" } : t))
  }

  return (
    // 1. ROOT WRAPPER: 'fixed inset-0' locks the app to the screen edges so the browser window cannot scroll
    <div className="fixed inset-0 w-full flex justify-center bg-[#F4F1E1] sm:bg-[#4A3E3D]/5 sm:p-6 z-0">
      
      {/* 
        2. APP CONTAINER: Uses 'h-full flex flex-col'. 
        It fills the screen on mobile, but keeps the cute phone borders on desktop ('sm:') 
      */}
      <div className="w-full h-full max-w-[400px] flex flex-col relative bg-[#F4F1E1] sm:rounded-[3rem] sm:border-[6px] sm:border-[#4A3E3D] sm:shadow-[12px_12px_0px_rgba(74,62,61,0.2)] overflow-hidden">
        
        {/* Binder Clip - Hidden on mobile so it doesn't overlap your iPhone notch */}
        <div className="hidden sm:flex absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-[#E8E4D3] border-b-2 border-x-2 border-[#4A3E3D] rounded-b-xl justify-center items-center z-30">
          <div className="w-12 h-1 bg-[#4A3E3D] rounded-full opacity-30" />
        </div>

        {/* 3. FIXED HEADER: 'shrink-0' ensures it never squishes */}
        <header className="shrink-0 px-6 pt-6 sm:pt-12 pb-4 flex justify-between items-end border-b-2 border-dashed border-[#4A3E3D]/20 relative z-20 bg-[#F4F1E1]">
          <div>
            <h1 className="font-pixel text-4xl font-bold tracking-wide text-[#4A3E3D] leading-none">Student OS.</h1>
            <p className="text-xs font-bold text-[#E07A5F] mt-2">Vol 2 • {format(new Date(), "EEEE")}</p>
          </div>
          <div className="bg-[#F2CC8F] border-2 border-[#4A3E3D] shadow-[2px_2px_0px_#4A3E3D] px-3 py-1 font-pixel font-bold text-xs transform rotate-3 text-[#4A3E3D]">
            {format(new Date(), "MMM d")}
          </div>
        </header>

        {/* 4. SCROLLABLE CONTENT: 'flex-1 overflow-y-auto' allows only this middle section to scroll */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "notices" && (
            <NoticesTab notices={notices} toggleNotice={toggleNotice} category={noticeCategory} setCategory={setNoticeCategory} isLoading={isLoadingNotices} />
          )}
          {activeTab === "calendar" && <CalendarTab tasks={tasks} classes={classes} />}
          {activeTab === "tasks" && (
            <JournalTab tasks={tasks} toggleTask={toggleTask} platoCreds={platoCreds} setPlatoCreds={setPlatoCreds} syncPlato={syncPlato} isSyncing={isSyncingPlato} />
          )}
        </main>

        {/* 5. FIXED FOOTER: Locks the navigation dock to the bottom of the container */}
        <div className="shrink-0 px-6 pb-6 pt-2 bg-[#F4F1E1] z-20">
          <nav className="bg-white p-1.5 flex items-center justify-between rounded-full border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D]">
            <NavItem icon={<MessageSquare size={22} strokeWidth={2.5} />} label="Notices" isActive={activeTab === "notices"} onClick={() => setActiveTab("notices")} />
            <NavItem icon={<CalendarDays size={22} strokeWidth={2.5} />} label="Calendar" isActive={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
            <NavItem icon={<Check size={24} strokeWidth={3} />} label="Tasks" isActive={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
          </nav>
        </div>

      </div>
    </div>
  )
}

function NavItem({ icon, label, isActive, onClick }: any) {
  return (
    <button onClick={onClick} className={cn("flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-full transition-all duration-300", isActive ? "bg-[#F2CC8F] text-[#4A3E3D] border-2 border-[#4A3E3D] shadow-[2px_2px_0px_#4A3E3D]" : "text-[#8C7B76] border-2 border-transparent")}>
      <div className={cn("transition-transform duration-300", isActive && "scale-110")}>{icon}</div>
      <span className={cn("font-pixel text-[10px] tracking-wider font-bold", isActive ? "opacity-100" : "opacity-0 h-0 overflow-hidden")}>{label}</span>
    </button>
  )
}

function NoticesTab({ notices, toggleNotice, category, setCategory, isLoading }: any) {
  const filteredNotices = notices.filter((n: any) => n.source === category)
  const unreadNotices = filteredNotices.filter((n: any) => n.status === "unread")
  const readNotices = filteredNotices.filter((n: any) => n.status === "read")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-4">
      
      <div className="flex gap-2 mb-8">
        <CategoryTab icon={<Globe size={14} />} label="Intl." active={category === "international"} onClick={() => setCategory("international")} />
        <CategoryTab icon={<Monitor size={14} />} label="CSE" active={category === "cse"} onClick={() => setCategory("cse")} />
        <CategoryTab icon={<GraduationCap size={14} />} label="PLATO" active={category === "classes"} onClick={() => setCategory("classes")} />
      </div>

      <div className="flex flex-col gap-5 mb-8">
        <div className="flex items-center gap-2 mb-1 text-[#E07A5F]">
          <Star size={16} fill="currentColor" />
          <h3 className="font-pixel text-lg font-bold">Unread</h3>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-xl border-2 border-[#4A3E3D] border-dashed p-6 text-center text-[#8C7B76] flex flex-col items-center justify-center gap-2">
            <span className="animate-spin text-[#E07A5F]"><Sparkles size={24} /></span>
            <p className="font-bold font-pixel">Connecting...</p>
          </div>
        ) : unreadNotices.length === 0 ? (
          <div className="bg-white rounded-xl border-2 border-[#4A3E3D] border-dashed p-6 text-center text-[#8C7B76] flex flex-col items-center justify-center gap-2">
            <p className="font-bold font-pixel">No unread notices!</p>
          </div>
        ) : (
          unreadNotices.map((notice: any, i: number) => (
            <div key={notice.id} onClick={() => toggleNotice(notice.id)} className="bg-white rounded-xl border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[6px_6px_0px_#4A3E3D] transition-all cursor-pointer p-4 relative mt-3">
               
               {/* Washi Tape */}
               <div className={cn("absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-5 bg-[#F2CC8F]/90 border-2 border-[#4A3E3D] shadow-[2px_2px_0px_#4A3E3D] z-20", i % 2 === 0 ? "rotate-2" : "-rotate-3", i % 3 === 0 ? "bg-[#81B29A]/90" : "")} />
              
              <div className="flex gap-4 pt-2">
                <div className="shrink-0 mt-1">
                  <div className="w-10 h-10 rounded-lg bg-white border-2 border-[#4A3E3D] flex items-center justify-center shadow-[2px_2px_0px_#4A3E3D]">
                    {notice.icon}
                  </div>
                </div>
                <div className="pr-2">
                  <h3 className="font-bold text-[#4A3E3D] text-sm leading-snug mb-2 line-clamp-2">{notice.title}</h3>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-[#8C7B76] uppercase tracking-wider">
                    <span>{notice.date}</span>
                    <span className="text-[#E07A5F] opacity-70">• Tap to read</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {readNotices.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-4 text-[#8C7B76]">
            <h3 className="font-pixel text-lg font-bold">Read</h3>
            <div className="h-0.5 flex-1 bg-[#4A3E3D]/20 border-dashed" />
          </div>
          <div className="flex flex-col gap-3">
            {readNotices.map((notice: any) => (
              <div key={notice.id} onClick={() => toggleNotice(notice.id)} className="bg-[#E8E4D3]/30 border-2 border-[#4A3E3D] border-dashed rounded-xl p-3 flex items-center gap-3 opacity-70 hover:opacity-100 cursor-pointer">
                <div className="flex-1"><h4 className="font-bold text-[#4A3E3D] text-sm line-through decoration-2 mb-1 line-clamp-1">{notice.title}</h4></div>
                <div className="w-6 h-6 shrink-0 rounded bg-white border-2 border-[#4A3E3D] flex items-center justify-center text-[#4A3E3D]"><Check size={14} strokeWidth={3} /></div>
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
    <button onClick={onClick} className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full transition-all font-pixel text-xs font-bold border-2", active ? "bg-[#4A3E3D] text-white border-[#4A3E3D] shadow-[3px_3px_0px_#E07A5F] -translate-y-1" : "bg-white text-[#8C7B76] border-[#4A3E3D] shadow-[2px_2px_0px_#4A3E3D]")}>
      {icon} {label}
    </button>
  )
}

function CalendarTab({ tasks, classes }: any) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const calendarDays = eachDayOfInterval({ start: startOfWeek(startOfMonth(selectedDate)), end: endOfWeek(endOfMonth(selectedDate)) })
  
  const dayTasks = tasks.filter((t: any) => isSameDay(t.dueDate, selectedDate))
  const dayClasses = classes.filter((c: any) => c.days.includes(getDay(selectedDate)))

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-4">
      <div className="mb-6 bg-[#81B29A] text-white p-4 border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] rounded-xl transform rotate-1 relative overflow-hidden">
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3"><CalendarDays size={24} /><h2 className="font-pixel text-2xl font-bold tracking-wider">{format(selectedDate, "MMMM")}</h2></div>
          <span className="font-bold opacity-80 font-pixel">{format(selectedDate, "yyyy")}</span>
        </div>
      </div>
      <div className="bg-white border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] rounded-xl p-3 mb-8">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => <div key={d} className="text-center font-pixel text-[10px] font-bold text-[#8C7B76]">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((date, i) => (
            <button key={i} onClick={() => setSelectedDate(date)} className={cn("flex flex-col items-center justify-center p-1 h-10 rounded-lg border-2 transition-all", !isSameMonth(date, selectedDate) && "opacity-30", isSameDay(date, selectedDate) ? "bg-[#4A3E3D] text-white border-[#4A3E3D]" : "bg-white text-[#4A3E3D] border-transparent hover:border-[#4A3E3D]/20", isToday(date) && !isSameDay(date, selectedDate) && "border-[#E07A5F] text-[#E07A5F]")}>
              <span className="font-pixel text-sm font-bold">{format(date, "d")}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-pixel text-lg font-bold mb-4 text-[#4A3E3D] border-b-2 border-[#4A3E3D]/20 pb-2">{format(selectedDate, "EEEE, MMMM d")}</h3>
        <div className="flex flex-col gap-4">
          {dayClasses.map((cls: any) => (
            <div key={cls.id} className={cn("p-3 rounded-xl border-2 border-[#4A3E3D] shadow-[3px_3px_0px_#4A3E3D]", cls.color)}>
              <div className="flex gap-3 items-center">
                <div><h4 className="font-bold text-sm">{cls.name}</h4><p className="font-pixel text-[10px] mt-1 opacity-90"><MapPin size={10} className="inline"/> {cls.location}</p></div>
              </div>
            </div>
          ))}
          {dayTasks.map((task: any) => (
            <div key={task.id} className="p-3 bg-white border-2 border-[#4A3E3D] border-dashed rounded-xl flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[#E07A5F]" />
              <h4 className="font-bold text-[#4A3E3D] text-sm">{task.title}</h4>
            </div>
          ))}
          {dayClasses.length === 0 && dayTasks.length === 0 && (
            <p className="text-center text-sm font-bold text-[#8C7B76] italic py-4">Nothing scheduled for today.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function JournalTab({ tasks, toggleTask, platoCreds, setPlatoCreds, syncPlato, isSyncing }: any) {
  const pending = tasks.filter((a: any) => a.status === "pending")
  const completed = tasks.filter((a: any) => a.status === "completed")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-4">
      
      <div className="mb-6 bg-white border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] rounded-xl p-4 flex flex-col gap-3">
        <p className="font-pixel text-sm font-bold text-[#4A3E3D] flex items-center gap-2"><GraduationCap size={16}/> Sync PLATO Dashboard</p>
        <div className="flex gap-2">
          <input type="text" placeholder="ID" className="flex-1 border-2 border-[#4A3E3D] rounded-lg p-2 text-sm focus:outline-none focus:border-[#E07A5F]" value={platoCreds.username} onChange={e => setPlatoCreds({...platoCreds, username: e.target.value})} />
          <input type="password" placeholder="Pass" className="flex-1 border-2 border-[#4A3E3D] rounded-lg p-2 text-sm focus:outline-none focus:border-[#E07A5F]" value={platoCreds.password} onChange={e => setPlatoCreds({...platoCreds, password: e.target.value})} />
        </div>
        <button onClick={syncPlato} disabled={isSyncing} className="bg-[#81B29A] hover:bg-[#6c9883] border-2 border-[#4A3E3D] shadow-[2px_2px_0px_#4A3E3D] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none rounded-lg text-white font-bold py-2 mt-1 transition-all">
          {isSyncing ? 'Scraping...' : 'Fetch Deadlines & Classes'}
        </button>
      </div>

      <div className="mb-8 bg-[#F2CC8F] text-[#4A3E3D] p-4 border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] rounded-xl transform -rotate-1 relative overflow-hidden flex justify-between items-center">
        <div className="flex items-center gap-3 relative z-10"><Check size={28} strokeWidth={3} /><h2 className="font-pixel text-2xl font-bold tracking-wider">All Tasks</h2></div>
        <div className="relative z-10 bg-white border-2 border-[#4A3E3D] font-pixel font-bold px-3 py-1 rounded-lg shadow-[2px_2px_0px_#4A3E3D] rotate-3">{pending.length} Left</div>
      </div>

      <div className="flex flex-col gap-4">
        {pending.map((task: any) => (
          <div key={task.id} onClick={() => toggleTask(task.id)} className="bg-white rounded-xl border-2 border-[#4A3E3D] shadow-[4px_4px_0px_#4A3E3D] hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[6px_6px_0px_#4A3E3D] transition-all cursor-pointer p-4 flex gap-4 items-center">
            <div className="w-6 h-6 rounded border-2 border-[#4A3E3D] flex items-center justify-center shrink-0"></div>
            <div className="flex-1">
              <h4 className="font-bold text-[#4A3E3D] text-sm mb-1">{task.title}</h4>
              <span className="font-pixel text-[10px] font-bold text-[#E07A5F] border-2 border-[#E07A5F]/20 bg-[#E07A5F]/10 px-2 py-0.5 rounded uppercase tracking-wider">Due {format(task.dueDate, "MMM d")}</span>
            </div>
          </div>
        ))}
        {completed.map((task: any) => (
          <div key={task.id} onClick={() => toggleTask(task.id)} className="bg-[#E8E4D3]/30 border-2 border-[#4A3E3D] border-dashed rounded-xl p-4 flex gap-4 items-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
            <div className="w-6 h-6 rounded bg-[#81B29A] border-2 border-[#4A3E3D] flex items-center justify-center shrink-0 text-white"><Check size={16} strokeWidth={4} /></div>
            <div className="flex-1"><h4 className="font-bold text-[#4A3E3D] text-sm line-through decoration-2 opacity-60">{task.title}</h4></div>
          </div>
        ))}
      </div>
    </div>
  )
}