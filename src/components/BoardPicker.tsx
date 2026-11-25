"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "./ui";
import { BoardIcon } from "./BoardIcon";
import { BOARDS, MAX_SHOWN_BOARDS, type BoardInfo, type NoticeSource } from "@/lib/client/types";
import { BOARD_EN, COLLEGE_EN } from "@/lib/client/boardNames";

/** University-wide boards first, then the colleges in list order. */
const COLLEGES = [...new Set(BOARDS.map((b) => b.college))].sort((a, b) => (a === "본부" ? -1 : b === "본부" ? 1 : 0));

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const matches = (b: BoardInfo, q: string) =>
  [b.name, b.label, b.college, b.id, BOARD_EN[b.id] ?? "", COLLEGE_EN[b.college] ?? "", ...b.aliases].some((x) => squash(x).includes(q));

type Props = { boards: NoticeSource[]; setBoards: (b: NoticeSource[]) => void };

/** The boards this device shows, and a search / by-college list to add more. */
export function BoardPicker({ boards, setBoards }: Props) {
  const [query, setQuery] = useState("");
  const [openCollege, setOpenCollege] = useState<string | null>(null);
  const shown = BOARDS.filter((b) => boards.includes(b.id));
  const full = boards.length >= MAX_SHOWN_BOARDS;
  const q = squash(query);

  const groups = useMemo(
    () =>
      COLLEGES.map((college) => ({
        college,
        boards: BOARDS.filter((b) => b.college === college && !boards.includes(b.id) && (!q || matches(b, q))),
      })).filter((g) => g.boards.length > 0),
    [boards, q],
  );

  const add = (id: NoticeSource) => setBoards([...boards, id]);
  const remove = (id: NoticeSource) => setBoards(boards.filter((b) => b !== id));

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y-2 divide-dashed divide-border/20" aria-label="Boards on this device">
        {shown.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <BoardIcon source={b.id} size={18} className="text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-bold text-foreground truncate">{b.label}</p>
                <p className="text-sm text-muted-foreground truncate">{b.core ? `${b.name} · ${BOARD_EN[b.id] ?? ""}` : BOARD_EN[b.id] ?? COLLEGE_EN[b.college] ?? b.college}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(b.id)}
              // Keep at least one board.
              disabled={boards.length === 1}
              aria-label={`Remove ${b.label}`}
              className="cozy-btn shrink-0 p-1.5 bg-card text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-extrabold text-foreground">Add a department</p>
        <label className="flex items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-primary">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: Mathematics, 수학과, Business…"
            aria-label="Search departments"
            className="w-full bg-transparent text-base sm:text-sm font-bold text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground">
              <X size={14} />
            </button>
          )}
        </label>
        {full && <p className="text-sm text-muted-foreground">That&apos;s the most boards one device can show ({MAX_SHOWN_BOARDS}). Remove one to add another.</p>}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{q ? "No department matches that." : "Every board is already on."}</p>
        ) : (
          <ul className="flex flex-col rounded-xl border-2 border-border bg-card divide-y-2 divide-border/15 overflow-hidden">
            {groups.map((g) => {
              // While searching, every matching group is open.
              const open = Boolean(q) || openCollege === g.college;
              return (
                <li key={g.college}>
                  <button
                    type="button"
                    onClick={() => setOpenCollege(open && !q ? null : g.college)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-foreground">{g.college === "본부" ? COLLEGE_EN[g.college] : g.college}</span>
                      {g.college !== "본부" && COLLEGE_EN[g.college] && <span className="block text-xs font-bold text-muted-foreground">{COLLEGE_EN[g.college]}</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
                      {g.boards.length}
                      <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
                    </span>
                  </button>
                  {open && (
                    <ul className="pb-1.5">
                      {g.boards.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-3 pl-5 pr-3 py-1.5">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{b.core ? `${b.label} · ${b.name}` : b.name}</p>
                            {(BOARD_EN[b.id] || b.aliases.length > 0) && (
                              <p className="text-xs text-muted-foreground truncate">{[BOARD_EN[b.id], b.aliases.length > 0 ? `also ${b.aliases.join(", ")}` : null].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => add(b.id)}
                            disabled={full}
                            aria-label={`Add ${b.label}`}
                            className="cozy-btn shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-extrabold bg-primary text-primary-foreground disabled:opacity-40"
                          >
                            <Plus size={13} /> Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
