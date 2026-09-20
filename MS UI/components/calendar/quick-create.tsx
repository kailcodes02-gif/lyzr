"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { EventDraft, GraphCalendar } from "@/lib/calendar/types";
import { AnchoredPopover, type Anchor } from "./anchored-popover";
import { EventForm } from "./event-form";

export function QuickCreate({
  open,
  anchor,
  draft,
  onChange,
  onClose,
  onSave,
  onMore,
  calendars,
  tz,
  durationMinutes,
  saving,
  colorOf,
}: {
  open: boolean;
  anchor: Anchor;
  draft: EventDraft | null;
  onChange: (d: EventDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onMore: () => void;
  calendars: GraphCalendar[];
  tz: string;
  durationMinutes: number;
  saving: boolean;
  colorOf?: (calendarId: string) => string;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 50);
  }, [open]);
  return (
    <AnchoredPopover open={open && !!draft} onOpenChange={(o) => !o && onClose()} anchor={anchor}>
      {draft && (
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave();
          }}
        >
          <div className="-mt-1 -mr-2 flex justify-end">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
          <EventForm draft={draft} onChange={onChange} calendars={calendars} full={false} tz={tz} durationMinutes={durationMinutes} titleRef={titleRef} colorOf={colorOf} />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onMore}>
              More options
            </Button>
            <Button type="submit" disabled={saving} className="rounded-full px-5">
              Save
            </Button>
          </div>
        </form>
      )}
    </AnchoredPopover>
  );
}
