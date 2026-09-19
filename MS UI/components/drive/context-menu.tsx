"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MenuAction = { label: string; icon?: React.ComponentType<{ className?: string }>; onSelect: () => void; danger?: boolean; separator?: boolean; disabled?: boolean; shortcut?: string };

// Small controlled context menu: positioned at the pointer, clamped to the
// viewport, closes on outside click, Escape, scroll or resize.
export function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} className="fixed z-50 min-w-56 rounded-xl bg-popover py-1.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10" onContextMenu={(e) => e.preventDefault()}>
      {actions.map((a, i) => (
        <div key={i}>
          {a.separator && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.onSelect();
            }}
            className={cn("flex w-full items-center gap-3 px-4 py-1.5 text-left outline-none hover:bg-accent focus:bg-accent disabled:opacity-50", a.danger && "text-destructive")}
          >
            {a.icon && <a.icon className="h-4 w-4 text-muted-foreground" />}
            <span className="flex-1">{a.label}</span>
            {a.shortcut && <span className="text-xs text-muted-foreground">{a.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
