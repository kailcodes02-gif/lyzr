"use client";

import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import { cancelUpload, clearFinishedUploads, useUploads } from "@/lib/drive/upload";
import { formatBytes } from "@/lib/files";
import { cn } from "@/lib/utils";

// Google-Drive-style upload tray, bottom right.
export function UploadTray() {
  const tasks = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (tasks.length === 0) return null;
  const active = tasks.filter((t) => t.status === "uploading" || t.status === "queued").length;
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <div className="fixed right-4 bottom-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-t-xl rounded-b-xl bg-popover shadow-xl ring-1 ring-foreground/10" role="status" aria-live="polite">
      <div className="flex items-center gap-2 bg-[#202124] px-4 py-2.5 text-sm text-white">
        <span className="flex-1">{active ? `Uploading ${active} ${active === 1 ? "item" : "items"}` : `${done} ${done === 1 ? "upload" : "uploads"} complete`}</span>
        <button type="button" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)} className="rounded p-1 hover:bg-white/10">
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <button type="button" aria-label="Close upload tray" onClick={clearFinishedUploads} className="rounded p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      {!collapsed && (
        <ul className="max-h-64 overflow-y-auto">
          {tasks.map((t) => {
            const pct = t.size ? Math.round((t.sent / t.size) * 100) : t.status === "done" ? 100 : 0;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.status === "error" ? t.error : t.status === "cancelled" ? "Cancelled" : `${formatBytes(t.sent)} of ${formatBytes(t.size)}`}</div>
                  {(t.status === "uploading" || t.status === "queued") && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-[#1a73e8] transition-all" style={{ width: `${pct}%` }} /></div>
                  )}
                </div>
                {t.status === "done" && <CheckCircle2 className="h-5 w-5 text-success" />}
                {t.status === "error" && <AlertCircle className="h-5 w-5 text-destructive" />}
                {(t.status === "uploading" || t.status === "queued") && (
                  <button type="button" aria-label={`Cancel ${t.name}`} onClick={() => cancelUpload(t.id)} className={cn("rounded-full p-1 hover:bg-muted")}><X className="h-4 w-4" /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
