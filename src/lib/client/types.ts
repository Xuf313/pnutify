export type NoticeSource = 'cse' | 'international';

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
};

export type Tab = 'briefing' | 'notices' | 'tasks' | 'calendar';
export const TABS: Tab[] = ['briefing', 'notices', 'tasks', 'calendar'];

export type Theme = 'pnu' | 'cherry' | 'midnight' | 'autumn' | 'night';
export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'pnu', label: 'PNU Blue', swatch: '#143F90' },
  { id: 'cherry', label: 'Blossom', swatch: '#D47E9B' },
  { id: 'midnight', label: 'Twilight', swatch: '#9B7ED4' },
  { id: 'autumn', label: 'Autumn', swatch: '#D48B68' },
  { id: 'night', label: 'Night', swatch: '#1B2333' },
];

export type AlertCategories = { cse: boolean; international: boolean; tasks: boolean };

export const SOURCE_LABEL: Record<NoticeSource, string> = { cse: 'CSE', international: 'International' };
