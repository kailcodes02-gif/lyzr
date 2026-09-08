"use client";

import { useState } from "react";
import { Info } from "lucide-react";

// shadcn Tooltip look, hover/click driven, no positioning library.
export function InfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label="More info"
        className="text-muted-foreground hover:text-foreground cursor-help"
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <span className="bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 absolute left-1/2 top-full z-30 mt-1.5 w-64 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs leading-relaxed shadow-md font-normal normal-case tracking-normal">
          {children}
        </span>
      )}
    </span>
  );
}
