"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { GraduationCap, X } from "lucide-react";
import { dday, relative } from "@/lib/client/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AppLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-primary text-primary-foreground border-2 border-border shadow-[2px_2px_0px_var(--color-border)] flex items-center justify-center shrink-0",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <GraduationCap size={Math.round(size * 0.55)} strokeWidth={2.5} />
    </div>
  );
}

export function SectionTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="flex items-center gap-2 font-pixel text-xl font-bold text-foreground">
        {icon && <span className="text-primary">{icon}</span>}
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cozy-card p-6 text-center bg-card border-dashed flex flex-col items-center gap-2">
      <p className="font-pixel text-xl font-bold text-foreground">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Pill({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "primary" | "secondary" | "danger"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-md border-2",
        tone === "muted" && "bg-muted text-muted-foreground border-transparent",
        tone === "primary" && "bg-primary text-primary-foreground border-border",
        tone === "secondary" && "bg-secondary text-secondary-foreground border-border",
        tone === "danger" && "bg-danger text-danger-foreground border-border",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-12 h-7 rounded-full border-2 border-border transition-colors duration-200 shrink-0 disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card border-2 border-border transition-transform duration-200 ease-[var(--ease-out)]",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centered dialog on larger screens. Esc, the backdrop, the close button and
 * (on phones) a swipe down on the grab bar close it. Focus stays inside while it's open and goes back
 * to where it was when it closes; it plays a short exit instead of vanishing.
 */
export function Sheet({ open, onClose, title, plainTitle, children }: { open: boolean; onClose: () => void; title: string; /** Title in the text font, e.g. a Korean notice title. */ plainTitle?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [swiped, setSwiped] = useState(false);
  // Opening mounts at once; closing keeps it mounted for the exit animation.
  if (open && (!mounted || closing)) {
    setMounted(true);
    setClosing(false);
    setSwiped(false);
  }
  if (!open && mounted && !closing) setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 180);
    return () => clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep Tab inside the sheet.
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  // ---------- swipe down to close (phones) ----------
  const drag = useRef<{ y: number; t: number; dy: number; active: boolean; id: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") return;
    drag.current = { y: e.clientY, t: e.timeStamp, dy: 0, active: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    if (!d.active && d.dy > 6) {
      // Only take over once it's clearly a drag, so taps on the close button still work.
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(d.id);
      panel.current.style.transition = "none";
    }
    if (d.active) panel.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = panel.current;
    if (!d?.active || !el) return;
    const velocity = d.dy / Math.max(1, e.timeStamp - d.t);
    el.style.transition = "transform 0.22s cubic-bezier(0.23, 1, 0.32, 1)";
    if (d.dy > 110 || velocity > 0.5) {
      // Carry on in the direction of the swipe instead of playing the usual exit.
      setSwiped(true);
      el.style.transform = "translateY(105%)";
      onClose();
    } else {
      el.style.transform = "";
    }
  };

  if (!mounted) return null;
  const state = closing ? "closed" : "open";
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet-backdrop absolute inset-0 bg-foreground/45 cursor-default" data-state={state} aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        data-state={state}
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))", ...(swiped ? { animation: "none" } : null) }}
        className="sheet-panel relative cozy-card bg-card w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto overscroll-contain rounded-b-none sm:rounded-xl px-5 pt-2 sm:p-6 outline-none"
      >
        <div className="sheet-handle -mx-5 px-5 sm:mx-0 sm:px-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="sm:hidden mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-border/25" aria-hidden />
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className={cn("text-xl font-bold text-foreground leading-snug", plainTitle ? "font-sans font-extrabold text-lg" : "font-pixel")}>{title}</h2>
            <button onClick={onClose} className="-mr-1.5 p-2 rounded-lg border-2 border-transparent hover:border-border text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A short message at the bottom of the screen, with an optional Undo. */
export function Toast({ message, action, onAction, onClose }: { message: string; action?: string; onAction?: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className="fixed inset-x-0 z-[90] flex justify-center px-4 pointer-events-none bottom-[calc(6.6rem+env(safe-area-inset-bottom))] md:bottom-6 md:left-64 lg:left-72"
    >
      <div role="status" aria-live="polite" className="toast pointer-events-auto cozy-card bg-foreground text-background flex items-center gap-3 pl-4 pr-2 py-2 max-w-md w-full sm:w-auto">
        <p className="flex-1 min-w-0 text-sm font-bold truncate">{message}</p>
        {action && onAction && (
          <button
            onClick={() => {
              onAction();
              onClose();
            }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-extrabold text-background underline underline-offset-4 decoration-2 hover:bg-background/15"
          >
            {action}
          </button>
        )}
        <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg text-background/70 hover:text-background" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** A tilted "D-3" sticker; the exact time is in its tooltip. */
export function DdaySticker({ due, now }: { due: number; now: number }) {
  const d = dday(due, now);
  return (
    <span className={cn("dday", d.tone === "over" && "dday--over", d.tone === "today" && "dday--today", d.tone === "soon" && "dday--soon")} title={d.tone === "over" ? "Overdue" : relative(due, now)}>
      {d.label}
    </span>
  );
}
