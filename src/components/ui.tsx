"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
      <h2 className="flex items-center gap-2 font-pixel text-lg font-bold text-foreground">
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
      <p className="font-pixel font-bold text-foreground">{title}</p>
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
        tone === "danger" && "bg-[#E5484D] text-white border-border",
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
        "relative w-12 h-7 rounded-full border-2 border-border transition-colors shrink-0 disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card border-2 border-border transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. Esc and backdrop close it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sheet-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-foreground/40 backdrop-blur-sm cursor-default" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="sheet-panel relative cozy-card bg-card w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-b-none sm:rounded-xl p-5 sm:p-6 outline-none"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="font-pixel text-xl font-bold text-foreground leading-snug">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg border-2 border-transparent hover:border-border text-muted-foreground hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
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
