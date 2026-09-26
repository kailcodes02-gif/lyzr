"use client";

import { ChevronDown, Clock, Cloud, FolderPlus, FolderUp, HardDrive, Plus, RefreshCw, Star, Trash2, Upload, Users, Folder, FileSpreadsheet, FileText, Presentation, FileType, FileImage, FileVideo } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { formatBytes, KIND_COLOR, KIND_VIEWS } from "@/lib/files";
import { formatAgo } from "@/lib/drive/freshness";
import { NEW_OFFICE_TYPES } from "@/lib/drive/office";
import type { OfficeKind } from "@/lib/drive/ooxml";
import type { DriveQuota } from "@/lib/drive/types";
import { cn } from "@/lib/utils";

const REPO_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  docs: FileText, sheets: FileSpreadsheet, slides: Presentation, pdfs: FileType, images: FileImage, videos: FileVideo, folders: Folder,
};
const REPO_COLOR: Record<string, string> = {
  docs: KIND_COLOR.doc, sheets: KIND_COLOR.sheet, slides: KIND_COLOR.slide, pdfs: KIND_COLOR.pdf, images: KIND_COLOR.image, videos: KIND_COLOR.video, folders: KIND_COLOR.folder,
};

// Icons for the "New" menu's Office entries, coloured like the type views.
export const OFFICE_ICON: Record<OfficeKind, React.ComponentType<{ className?: string }>> = { word: FileText, excel: FileSpreadsheet, powerpoint: Presentation };

export type NavKey = "myfiles" | "starred" | "recent" | "shared" | `repo:${string}`;

// "Updated 12s ago", ticking once a second while the panel is mounted.
export function UpdatedAgo({ lastSync, refreshing }: { lastSync?: string; refreshing: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const at = lastSync ? new Date(lastSync).getTime() : NaN;
  return (
    <span className="inline-flex items-center gap-1" data-testid="drive-updated" title={lastSync ? `Last synced with OneDrive at ${new Date(lastSync).toLocaleTimeString()}` : undefined}>
      <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden />
      {refreshing ? "Updating..." : Number.isNaN(at) ? "Not synced yet" : `Updated ${formatAgo(now - at)}`}
    </span>
  );
}

function NavItem({ k, active, icon: I, label, color, onNav }: { k: NavKey; active: NavKey; icon: React.ComponentType<{ className?: string }>; label: string; color?: string; onNav: (k: NavKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onNav(k)}
      className={cn(
        "flex h-8 w-full items-center gap-3 rounded-r-full pl-5 pr-3 text-[13px] transition-colors",
        active === k ? "bg-[#c2e7ff] font-medium text-[#001d35] dark:bg-primary/25 dark:text-foreground" : "hover:bg-black/5 dark:hover:bg-white/10"
      )}
    >
      <I className={cn("h-4 w-4 shrink-0", color)} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function LeftPanel({
  active, onNav, onNewFolder, onNewOffice, onUploadFiles, onUploadFolder, quota, trashUrl, indexing, count, lastSync,
}: {
  active: NavKey;
  onNav: (k: NavKey) => void;
  onNewFolder: () => void;
  onNewOffice: (kind: OfficeKind) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  quota?: DriveQuota;
  trashUrl: string;
  indexing: boolean;
  count: number;
  lastSync?: string;
}) {
  const used = quota?.used ?? 0;
  const total = quota?.total ?? 0;
  const pct = total ? (used / total) * 100 : 0;

  return (
    <nav className="flex h-full w-[248px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-background py-3 pr-3" aria-label="OneDrive navigation">
      <div className="mb-2 pl-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="h-12 gap-3 rounded-2xl border-border bg-card px-5 text-sm shadow-sm hover:shadow-md" />}>
            <Plus className="h-5 w-5" />
            New
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52 rounded-xl p-1.5">
            <DropdownMenuItem onClick={onNewFolder} className="gap-3 px-3 py-2"><FolderPlus />New folder</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onUploadFiles} className="gap-3 px-3 py-2"><Upload />File upload</DropdownMenuItem>
            <DropdownMenuItem onClick={onUploadFolder} className="gap-3 px-3 py-2"><FolderUp />Folder upload</DropdownMenuItem>
            <DropdownMenuSeparator />
            {NEW_OFFICE_TYPES.map((t) => {
              const I = OFFICE_ICON[t.kind];
              return (
                <DropdownMenuItem key={t.kind} onClick={() => onNewOffice(t.kind)} className="gap-3 px-3 py-2">
                  <I className={cn("h-4 w-4", t.color)} />
                  {t.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NavItem k="myfiles" active={active} onNav={onNav} icon={HardDrive} label="My files" />
      {KIND_VIEWS.map((v) => (
        <NavItem key={v.key} k={`repo:${v.key}`} active={active} onNav={onNav} icon={REPO_ICON[v.key] ?? Folder} label={v.label} color={REPO_COLOR[v.key]} />
      ))}
      <div className="my-1 mr-2 ml-5 border-t border-border" />
      <NavItem k="starred" active={active} onNav={onNav} icon={Star} label="Starred" />
      <NavItem k="recent" active={active} onNav={onNav} icon={Clock} label="Recent" />
      <NavItem k="shared" active={active} onNav={onNav} icon={Users} label="Shared with me" />
      <a
        href={trashUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Graph has no recycle-bin API for work accounts; opens OneDrive's Recycle bin"
        className="flex h-8 w-full items-center gap-3 rounded-r-full pl-5 pr-3 text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
      >
        <Trash2 className="h-4 w-4" />
        <span>Trash</span>
        <span className="ml-auto text-[10px] text-muted-foreground">opens OneDrive</span>
      </a>
      <div className="my-1 mr-2 ml-5 border-t border-border" />
      <div className="px-5 pt-1">
        <div className="mb-2 flex items-center gap-3 text-[13px]"><Cloud className="h-4 w-4" />Storage</div>
        <Progress value={pct} className="h-1.5 bg-muted" indicatorClassName="bg-[#1a73e8]" />
        <p className="mt-2 text-xs text-muted-foreground">
          {total ? `${formatBytes(used)} of ${formatBytes(total)} used` : "Storage details unavailable"}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground" aria-live="polite">
          {indexing && !lastSync ? (
            <span>Indexing OneDrive: {count.toLocaleString()} items so far</span>
          ) : (
            <>
              {count ? <span>{count.toLocaleString()} items indexed</span> : null}
              <UpdatedAgo lastSync={lastSync} refreshing={indexing && Boolean(lastSync)} />
            </>
          )}
        </p>
      </div>
    </nav>
  );
}
