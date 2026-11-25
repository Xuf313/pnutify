import { DEPARTMENT_BOARDS } from './departments';

/**
 * Every notice board PNUtify can read, shared by the server and the app.
 * `core` boards are always checked; department boards are checked only while
 * someone shows them or has alerts on for them.
 */
export type BoardDef = {
  /** Stable id, also the notice id prefix (e.g. "me" -> "me_1474371"). */
  id: string;
  /** Short label for tabs and badges. */
  label: string;
  /** The board's own name, e.g. "기계공학부". */
  name: string;
  /** Grouping in Settings, e.g. "공과대학". */
  college: string;
  /** The notice list page. */
  url: string;
  core?: boolean;
  /** Other names it goes by (e.g. a major that shares a department's board), for search. */
  aliases?: string[];
  /** Characters after which the list cuts titles without "..." (K2Web boards). */
  titleCut?: number;
};

export const CORE_BOARDS: BoardDef[] = [
  { id: 'cse', label: 'CSE', name: '정보컴퓨터공학부', college: '정보의생명공학대학', url: 'https://cse.pusan.ac.kr/cse/14221/subview.do', core: true, titleCut: 50 },
  { id: 'international', label: 'Intl.', name: '국제처', college: '본부', url: 'https://international.pusan.ac.kr/international/15224/subview.do', core: true, titleCut: 60 },
];

export const BOARD_DEFS: BoardDef[] = [...CORE_BOARDS, ...DEPARTMENT_BOARDS.filter((d) => !CORE_BOARDS.some((c) => c.id === d.id))];
export const BOARD_IDS = BOARD_DEFS.map((b) => b.id);
export const CORE_BOARD_IDS = CORE_BOARDS.map((b) => b.id);
/**
 * What a new device shows: International only. Every student picks their own
 * department; CSE is a department like any other (it just stays on the
 * every-minute check on the server).
 */
export const DEFAULT_BOARD_IDS = ['international'];
/** Whether these boards include a department (anything but the university-wide International board). */
export const hasDepartment = (ids: string[]) => ids.some((id) => id !== 'international');
export const boardDef = (id: string) => BOARD_DEFS.find((b) => b.id === id);
export const isKnownBoard = (id: unknown): id is string => typeof id === 'string' && BOARD_DEFS.some((b) => b.id === id);
