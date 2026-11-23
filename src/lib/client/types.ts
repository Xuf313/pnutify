import { BOARD_DEFS, CORE_BOARD_IDS } from '../boardList';

/** A board id: 'cse', 'international', or a department's (e.g. 'math'). */
export type NoticeSource = string;

export type Notice = {
  id: string;
  title: string;
  date: string;
  postedAt: number | null;
  source: NoticeSource;
  url: string;
  pinned: boolean;
  firstSeenAt: number;
};

export type Task = {
  id: string;
  title: string;
  course: string;
  /** Epoch ms. */
  dueDate: number;
  status: 'pending' | 'completed';
  createdAt: number;
  /** Last edit (epoch ms), used to merge the owner's devices. */
  updatedAt?: number;
  /** Where it came from. PLATO and NESPA items are read-only (owner mode). */
  source?: 'own' | 'plato' | 'nespa';
  /** Link to the item on PLATO or NESPA. */
  url?: string;
};

export type Tab = 'briefing' | 'notices' | 'tasks' | 'calendar';
export const TABS: Tab[] = ['briefing', 'notices', 'tasks', 'calendar'];

export type Theme = 'pnu' | 'cherry' | 'midnight' | 'autumn' | 'night';
export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'pnu', label: 'PNU Blue', swatch: '#143F90' },
  { id: 'cherry', label: 'Blossom', swatch: '#B4537A' },
  { id: 'midnight', label: 'Twilight', swatch: '#7656B8' },
  { id: 'autumn', label: 'Autumn', swatch: '#A8573A' },
  { id: 'night', label: 'Night', swatch: '#1B2333' },
];

/** Alerts for the listed boards, deadline reminders, the weekly preview and (owner only) course posts. */
export type AlertCategories = { boards: NoticeSource[]; tasks: boolean; weekly: boolean; courses: boolean };

// ---------- owner mode (PLATO and NESPA, for the site owner only) ----------

export type OwnerSource<T> = { configured: boolean; ok: boolean; error?: string; data?: T; syncedAt?: number };

export type PlatoData = {
  name: string;
  courses: { id: number; name: string }[];
  deadlines: { id: string; title: string; course: string; dueAt: number; url: string; kind: string }[];
  announcements: { id: string; title: string; course: string; author: string; postedAt: number; url: string; excerpt: string }[];
};

export type NespaData = {
  assignments: { id: string; no: number; title: string; opensAt: number | null; dueAt: number | null; score: string | null; url: string }[];
  notices: { id: string; title: string; author: string; postedAt: number | null; url: string }[];
  loggedIn: boolean;
};

export type OwnerData = { checkedAt: number; plato: OwnerSource<PlatoData>; nespa: OwnerSource<NespaData> };

/** One item in the Briefing's "From your courses" list. */
export type CoursePost = { id: string; title: string; source: 'PLATO' | 'NESPA'; course: string; postedAt: number | null; url: string; excerpt?: string };

export type BoardInfo = { id: NoticeSource; label: string; short: string; name: string; college: string; core: boolean; aliases: string[] };
/** Every notice board PNUtify can read (the list lives in src/lib/boardList.ts and src/lib/departments.ts). */
export const BOARDS: BoardInfo[] = BOARD_DEFS.map((d) => ({
  id: d.id,
  label: d.id === 'international' ? 'International' : d.label,
  short: d.label,
  name: d.name,
  college: d.college,
  core: d.core === true,
  aliases: d.aliases ?? [],
}));
export const BOARD_IDS = BOARDS.map((b) => b.id);
/** What a new device shows. */
export const DEFAULT_BOARDS: NoticeSource[] = CORE_BOARD_IDS;
/** Most boards one device can show (the server reads at most this many per request). */
export const MAX_SHOWN_BOARDS = 12;
export const SOURCE_LABEL = Object.fromEntries(BOARDS.map((b) => [b.id, b.label])) as Record<NoticeSource, string>;
export const boardInfo = (id: string) => BOARDS.find((b) => b.id === id);
