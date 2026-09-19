"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Google-Workspace-style header: app name on the left, one wide rounded
// search box in the middle, page-specific controls on the right. Pages pass
// their search state in; "/" focuses the box, Escape clears it.
export function AppBar({
  app,
  search,
  onSearchChange,
  onSearchSubmit,
  placeholder,
  right,
  left,
  className,
}: {
  app: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  placeholder?: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!onSearchChange) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearchChange]);

  return (
    <header className={cn("flex h-16 shrink-0 items-center gap-4 px-4", className)}>
      <div className="flex w-56 shrink-0 items-center gap-2">
        {left}
        <span className="text-[22px] font-normal tracking-tight text-foreground/80">{app}</span>
      </div>
      {onSearchChange ? (
        <form
          role="search"
          className="flex h-12 max-w-3xl flex-1 items-center gap-3 rounded-full bg-muted px-4 transition-shadow focus-within:bg-card focus-within:shadow-md"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit?.(search ?? "");
          }}
        >
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={ref}
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearchChange("");
                onSearchSubmit?.("");
                ref.current?.blur();
              }
            }}
            placeholder={placeholder ?? "Search"}
            aria-label={placeholder ?? "Search"}
            className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                onSearchChange("");
                onSearchSubmit?.("");
              }}
              className="rounded-full p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </form>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </header>
  );
}
