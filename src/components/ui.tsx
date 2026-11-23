"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { GraduationCap, X } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AppLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div
      className={cn(
        // A station marker: the school colour, ringed in the line's colour.
        "rounded-full bg-primary text-primary-foreground ring-2 ring-signal ring-offset-2 ring-offset-background flex items-center justify-center shrink-0",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <GraduationCap size={Math.round(size * 0.52)} strokeWidth={2.2} />
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
    <div className="rounded-[14px] border border-border p-6 text-center flex flex-col items-center gap-2">
      <p className="font-pixel font-bold text-foreground">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Pill({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "primary" | "secondary" | "danger"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "primary" && "bg-accent text-accent-foreground",
        tone === "secondary" && "bg-secondary/12 text-secondary",
        tone === "danger" && "bg-signal text-signal-foreground",
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
        "relative w-11 h-[26px] rounded-full transition-colors shrink-0 disabled:opacity-50",
        checked ? "bg-primary" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-[18px]",
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
      <button className="absolute inset-0 bg-[#0b1220]/45 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="sheet-panel relative bg-card w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-[20px] sm:rounded-[20px] p-5 sm:p-7 outline-none shadow-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="sm:hidden mx-auto -mt-2 mb-3 h-1 w-10 rounded-full bg-foreground/15" aria-hidden />
        <div className="flex items-start justify-between gap-4 mb-5">
          <h2 className="font-pixel text-2xl font-bold text-foreground leading-snug">{title}</h2>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
