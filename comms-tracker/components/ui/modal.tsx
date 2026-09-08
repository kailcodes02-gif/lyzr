"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn Dialog look (overlay + centered panel + header/footer slots),
// implemented without a portal library so the static export stays light.
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50 animate-in fade-in-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "bg-background relative grid w-full gap-4 rounded-lg border p-6 shadow-lg my-8 animate-in fade-in-0 zoom-in-95",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="flex flex-col gap-1.5 text-left">
          <h2 className="text-lg leading-none font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        <div>{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        <button
          onClick={onClose}
          aria-label="Close"
          className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
