"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "./ui";
import type { Tab } from "@/lib/client/types";

type Item = { id: Tab; label: string; icon: ComponentType<{ size?: number }> };

type Props = {
  items: Item[];
  active: Tab;
  onSelect: (t: Tab) => void;
  badge: (t: Tab) => number;
  variant: "bar" | "side";
  /** Jump instead of sliding (keyboard shortcuts, which happen too often to animate). */
  instant?: boolean;
};

const STYLE = {
  bar: {
    list: "flex",
    item: "nav-tab relative flex-1 flex flex-col items-center gap-0.5 py-2 rounded-2xl border-2",
    idle: "border-transparent text-muted-foreground",
    pill: "rounded-2xl border-2 border-border bg-primary shadow-[3px_3px_0px_var(--color-border)]",
    liftClass: "-translate-x-px -translate-y-px",
    radius: 16,
  },
  side: {
    list: "flex flex-col gap-2",
    item: "nav-tab w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm border-2",
    idle: "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    pill: "rounded-xl border-2 border-border bg-primary shadow-[3px_3px_0px_var(--color-border)]",
    liftClass: "-translate-y-0.5",
    radius: 12,
  },
};

/**
 * The tab list with one raised "active" pill that slides to the selected tab. The labels are drawn
 * twice: the plain ones underneath, and white ones on top clipped to the pill, so the colour change
 * travels with the pill instead of fading separately. Badges sit on a layer of their own above both.
 */
export function Nav({ items, active, onSelect, badge, variant, instant }: Props) {
  const s = STYLE[variant];
  const wrap = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number; W: number; H: number } | null>(null);
  const [measured, setMeasured] = useState(0);
  const index = items.findIndex((i) => i.id === active);

  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const b = buttons.current[index];
      if (!b) return;
      setPos({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight, W: box.offsetWidth, H: box.offsetHeight });
      setMeasured((n) => n + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [index]);

  // ---------- the phone bar: press and slide your finger along it, like iOS tab bars ----------
  // While you hold, the bar grows a little and the pill follows your finger; let go and it
  // snaps to the nearest tab and opens it. A plain tap still works as before.
  const [drag, setDrag] = useState<{ x: number } | null>(null);
  const [held, setHeld] = useState(false);
  const press = useRef<{ id: number; startX: number; dragging: boolean } | null>(null);
  const swallowClick = useRef(false);
  const pillX = (clientX: number) => {
    const box = wrap.current;
    const first = buttons.current[0];
    const last = buttons.current[items.length - 1];
    if (!box || !first || !last || !pos) return null;
    const x = clientX - box.getBoundingClientRect().left - pos.w / 2;
    return Math.min(Math.max(x, first.offsetLeft), last.offsetLeft);
  };
  const nearest = (x: number) => {
    let best = 0;
    buttons.current.forEach((b, i) => {
      if (b && Math.abs(b.offsetLeft - x) < Math.abs((buttons.current[best]?.offsetLeft ?? 0) - x)) best = i;
    });
    return best;
  };
  const drags = variant === "bar";
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!drags || (e.pointerType === "mouse" && e.button !== 0)) return;
    press.current = { id: e.pointerId, startX: e.clientX, dragging: false };
    setHeld(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.dragging && Math.abs(e.clientX - p.startX) < 6) return;
    if (!p.dragging) {
      p.dragging = true;
      wrap.current?.setPointerCapture(e.pointerId);
    }
    const x = pillX(e.clientX);
    if (x !== null) setDrag({ x });
  };
  const onPointerEnd = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    setHeld(false);
    if (p.dragging && drag && e.type === "pointerup") {
      // The button under the finger would get a click too; the slide already chose.
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      onSelect(items[nearest(drag.x)].id);
    }
    setDrag(null);
  };
  // However the touch ends (lifted outside the bar, cancelled by the system, app sent to the
  // background), the bar goes back to normal.
  useEffect(() => {
    if (!held) return;
    const reset = () => {
      press.current = null;
      setHeld(false);
      setDrag(null);
    };
    const onUp = (e: PointerEvent) => {
      if (!press.current || press.current.id === e.pointerId) setTimeout(reset, 0);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [held]);

  const onClickCapture = (e: React.MouseEvent) => {
    if (swallowClick.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // The first placement (and keyboard shortcuts) jump instead of sliding.
  const jump = instant || measured <= 1;
  const lift = variant === "bar" ? { x: -1, y: -1 } : { x: 0, y: -2 };

  const renderBadge = (id: Tab) => {
    const n = badge(id);
    if (n <= 0) return null;
    const text = n > 99 ? "99+" : n;
    return variant === "bar" ? (
      <span
        key={n}
        className="badge-pop visible absolute -top-1.5 right-[16%] min-w-5 h-5 px-1 rounded-md bg-secondary text-secondary-foreground text-[11px] font-extrabold tabular-nums flex items-center justify-center border-2 border-border shadow-[1.5px_1.5px_0px_var(--color-border)] rotate-[8deg]"
      >
        {text}
      </span>
    ) : (
      <span
        key={n}
        className={cn(
          "badge-pop visible ml-auto text-[11px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-md border transition-colors duration-200",
          id === active ? "bg-primary-foreground/20 border-primary-foreground/30 text-primary-foreground" : "bg-primary text-primary-foreground border-border",
        )}
      >
        {text}
      </span>
    );
  };

  const label = (l: string, Icon: Item["icon"]) => (
    <>
      <Icon size={variant === "bar" ? 22 : 20} />
      <span className={variant === "bar" ? "text-[11px] font-extrabold" : undefined}>{l}</span>
    </>
  );

  // Where the pill is: under your finger while sliding, otherwise on the active tab.
  const x = drag?.x ?? pos?.x ?? 0;
  const move = pos ? { transform: `translate(${x + lift.x}px, ${pos.y + lift.y}px)` } : undefined;
  const clip = pos ? `inset(${pos.y + lift.y}px ${pos.W - x - pos.w - lift.x}px ${pos.H - pos.y - pos.h - lift.y}px ${x + lift.x}px round ${s.radius}px)` : "inset(0 100% 100% 0)";

  return (
    <div
      ref={wrap}
      className={cn("nav-wrap relative", drags && "nav-wrap--slide")}
      data-instant={jump ? "" : undefined}
      data-held={held ? "" : undefined}
      data-dragging={drag ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      // Only the bar losing the touch ends it. On phones the touched tab holds the touch first
      // and "loses" it to the bar when the slide starts; that event bubbles up here too.
      onLostPointerCapture={(e) => e.target === e.currentTarget && onPointerEnd(e)}
      onClickCapture={onClickCapture}
    >
      {/* plain tabs: these are the real buttons */}
      <div className={s.list}>
        {items.map(({ id, label: l, icon }, i) => (
          <button
            key={id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            onClick={() => onSelect(id)}
            aria-current={active === id ? "page" : undefined}
            className={cn(s.item, s.idle)}
          >
            {label(l, icon)}
          </button>
        ))}
      </div>
      {/* the raised pill */}
      {pos && (
        <span
          aria-hidden
          className={cn("nav-pill absolute left-0 top-0 pointer-events-none", s.pill)}
          style={{ width: pos.w, height: pos.h, ...move }}
        />
      )}
      {/* white labels, clipped to the pill */}
      <div aria-hidden className="nav-active absolute inset-0 pointer-events-none" style={{ clipPath: clip }}>
        <div className={s.list}>
          {items.map(({ id, label: l, icon }) => (
            <div key={id} className={cn(s.item, "border-transparent text-primary-foreground", s.liftClass)}>
              {label(l, icon)}
            </div>
          ))}
        </div>
      </div>
      {/* badges, above everything */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className={s.list}>
          {items.map(({ id, label: l, icon }) => (
            <div key={id} className={cn(s.item, "border-transparent invisible")}>
              {label(l, icon)}
              {renderBadge(id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
