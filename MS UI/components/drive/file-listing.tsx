"use client";

import { MoreVertical, Star } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isFolder, kindOf, ownerName } from "@/lib/drive/logic";
import type { DriveItem } from "@/lib/drive/types";
import { formatBytes } from "@/lib/files";
import { formatMailDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DRAG_TYPE } from "./breadcrumb";
import { KindIcon, Thumbnail } from "./item-icon";

export type ListingProps = {
  items: DriveItem[];
  layout: "grid" | "list";
  selected: Set<string>;
  focusedId: string | null;
  starred: Set<string>;
  onSelect: (id: string, mode: "single" | "toggle" | "range") => void;
  onOpen: (item: DriveItem) => void;
  onContextMenu: (item: DriveItem, x: number, y: number) => void;
  onDropIds: (ids: string[], folderId: string) => void;
  onStar: (item: DriveItem) => void;
  onColumns?: (n: number) => void;
};

function modeOf(e: React.MouseEvent): "single" | "toggle" | "range" {
  if (e.shiftKey) return "range";
  if (e.metaKey || e.ctrlKey) return "toggle";
  return "single";
}

export function FileListing(p: ListingProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<string | null>(null);

  // Report how many tiles fit per row, for arrow-key navigation.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || p.layout !== "grid" || !p.onColumns) return;
    const calc = () => {
      const first = el.querySelector<HTMLElement>("[data-tile]");
      if (!first) return;
      const cols = Math.max(1, Math.floor(el.clientWidth / (first.offsetWidth + 16)));
      p.onColumns?.(cols);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.layout, p.items.length]);

  useEffect(() => {
    if (p.layout === "list") p.onColumns?.(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.layout]);

  const dragProps = useCallback(
    (item: DriveItem) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        const ids = p.selected.has(item.id) ? Array.from(p.selected) : [item.id];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: React.DragEvent) => {
        if (isFolder(item) && e.dataTransfer.types.includes(DRAG_TYPE) && !p.selected.has(item.id)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(item.id);
        }
      },
      onDragLeave: () => setOver((o) => (o === item.id ? null : o)),
      onDrop: (e: React.DragEvent) => {
        if (!isFolder(item)) return;
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        try {
          const ids = (JSON.parse(raw) as string[]).filter((id) => id !== item.id);
          if (ids.length) p.onDropIds(ids, item.id);
        } catch {
          // not ours
        }
      },
    }),
    [p]
  );

  const firstId = p.items[0]?.id;
  const tabStop = p.focusedId && p.items.some((i) => i.id === p.focusedId) ? p.focusedId : firstId;
  const common = (item: DriveItem) => ({
    ...dragProps(item),
    role: "option",
    tabIndex: item.id === tabStop ? 0 : -1,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      p.onSelect(item.id, modeOf(e));
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.preventDefault();
      p.onOpen(item);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!p.selected.has(item.id)) p.onSelect(item.id, "single");
      p.onContextMenu(item, e.clientX, e.clientY);
    },
    "aria-selected": p.selected.has(item.id),
    "data-focused": p.focusedId === item.id || undefined,
    id: `drive-item-${item.id}`,
  });

  if (p.layout === "list") {
    return (
      <div role="listbox" aria-multiselectable="true" aria-label="Files" className="min-w-[640px] px-2">
        <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_170px_140px_90px_40px] items-center gap-3 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Name</span><span>Owner</span><span>Last modified</span><span className="text-right">File size</span><span />
        </div>
        {p.items.map((item) => {
          const sel = p.selected.has(item.id);
          const kind = kindOf(item);
          return (
            <div
              key={item.id}
              data-tile
              {...common(item)}
              className={cn(
                "group grid h-11 cursor-default grid-cols-[minmax(0,1fr)_170px_140px_90px_40px] items-center gap-3 rounded-lg px-3 text-[13px] outline-none select-none",
                sel ? "bg-[#c2e7ff] dark:bg-primary/25" : "hover:bg-muted/70",
                p.focusedId === item.id && !sel && "ring-1 ring-[#1a73e8]/60",
                over === item.id && "ring-2 ring-[#1a73e8]"
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <KindIcon kind={kind} className="h-5 w-5" />
                <span className="truncate">{item.name}</span>
                {p.starred.has(item.id) && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-muted-foreground" aria-label="Starred" />}
              </span>
              <span className="truncate text-muted-foreground">{ownerName(item) || "me"}</span>
              <span className="truncate text-muted-foreground">{formatMailDate(item.lastModifiedDateTime)}</span>
              <span className="text-right text-muted-foreground">{isFolder(item) ? "" : formatBytes(item.size)}</span>
              <button
                type="button"
                aria-label={`More actions for ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  if (!sel) p.onSelect(item.id, "single");
                  p.onContextMenu(item, r.left, r.bottom);
                }}
                className="rounded-full p-1.5 opacity-0 hover:bg-black/10 group-hover:opacity-100 focus:opacity-100 aria-selected:opacity-100"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  const folders = p.items.filter(isFolder);
  const files = p.items.filter((i) => !isFolder(i));
  // A render function, not a nested component: a component defined inside
  // render gets a new identity every render, so React remounts the tile on
  // the first click and the second click of a double-click lands on a fresh
  // DOM node (no dblclick event ever fires).
  const renderTile = (item: DriveItem) => {
    const sel = p.selected.has(item.id);
    const kind = kindOf(item);
    const folder = isFolder(item);
    return (
      <div
        key={item.id}
        data-tile
        {...common(item)}
        className={cn(
          "group relative cursor-default rounded-xl border outline-none select-none",
          folder ? "flex h-12 items-center gap-3 border-transparent bg-[#f0f4f9] px-3 hover:bg-[#e1e6ec] dark:bg-muted dark:hover:bg-muted/70" : "flex flex-col overflow-hidden border-border bg-card hover:shadow-md",
          sel && "bg-[#c2e7ff] ring-2 ring-[#1a73e8]/60 hover:bg-[#c2e7ff] dark:bg-primary/25",
          p.focusedId === item.id && !sel && "ring-1 ring-[#1a73e8]/60",
          over === item.id && "ring-2 ring-[#1a73e8]"
        )}
      >
        {folder ? (
          <>
            <KindIcon kind="folder" className="h-5 w-5" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.name}</span>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium">
              <KindIcon kind={kind} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
            </div>
            <div className="aspect-[4/3] w-full"><Thumbnail item={item} /></div>
          </>
        )}
        {p.starred.has(item.id) && <Star className="absolute top-2.5 right-8 h-3.5 w-3.5 fill-current text-muted-foreground" aria-label="Starred" />}
        <button
          type="button"
          aria-label={`More actions for ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (!sel) p.onSelect(item.id, "single");
            p.onContextMenu(item, r.left, r.bottom);
          }}
          className={cn("absolute top-1.5 right-1.5 rounded-full p-1.5 opacity-0 hover:bg-black/10 group-hover:opacity-100 focus:opacity-100", sel && "opacity-100")}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div ref={gridRef} role="listbox" aria-multiselectable="true" aria-label="Files" className="flex flex-col gap-4 px-4">
      {folders.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Folders</h2>
          <div role="group" aria-label="Folders" className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{folders.map(renderTile)}</div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Files</h2>
          <div role="group" aria-label="Files" className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{files.map(renderTile)}</div>
        </section>
      )}
    </div>
  );
}

export function ListingSkeleton({ layout }: { layout: "grid" | "list" }) {
  const n = 8;
  return layout === "list" ? (
    <div className="px-5" aria-busy="true" aria-label="Loading files">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="my-2 h-8 animate-pulse rounded-lg bg-muted" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 px-4" aria-busy="true" aria-label="Loading files">
      {Array.from({ length: n }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted" />)}
    </div>
  );
}
