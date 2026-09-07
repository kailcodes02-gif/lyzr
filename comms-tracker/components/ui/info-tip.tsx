"use client";

import { useState } from "react";
import { Info } from "lucide-react";

export function InfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="text-zinc-400 hover:text-zinc-600"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1.5 w-64 rounded-lg bg-zinc-900 text-white text-xs leading-relaxed p-2.5 shadow-xl">
          {children}
        </span>
      )}
    </span>
  );
}
