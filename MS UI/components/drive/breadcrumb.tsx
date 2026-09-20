"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Crumb } from "@/lib/drive/types";
import { cn } from "@/lib/utils";

export const DRAG_TYPE = "application/x-msui-drive-ids";

export function Breadcrumb({ crumbs, title, onOpen, onDropIds }: { crumbs: Crumb[]; title?: string; onOpen: (id: string) => void; onDropIds?: (ids: string[], folderId: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  if (title) return <h1 className="truncate px-4 py-2 text-[22px] font-normal">{title}</h1>;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 px-3 py-1.5 text-[22px] font-normal">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        // "path:" crumbs come from parentReference.path when the parent is not
        // in the index: they name a folder but cannot be opened by id.
        const synthetic = c.id.startsWith("path:");
        const droppable = !last && !synthetic;
        return (
          <span key={c.id} className="flex min-w-0 items-center">
            {i > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => !last && !synthetic && onOpen(c.id)}
              disabled={synthetic}
              aria-current={last ? "page" : undefined}
              onDragOver={(e) => {
                if (droppable && e.dataTransfer.types.includes(DRAG_TYPE)) {
                  e.preventDefault();
                  setOver(c.id);
                }
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOver(null);
                try {
                  onDropIds?.(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[], c.id);
                } catch {
                  // not our drag
                }
              }}
              className={cn(
                "max-w-[260px] truncate rounded-full px-2.5 py-0.5 transition-colors",
                last ? "cursor-default text-foreground" : synthetic ? "cursor-default text-muted-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                over === c.id && "bg-[#c2e7ff] text-[#001d35]"
              )}
            >
              {c.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
