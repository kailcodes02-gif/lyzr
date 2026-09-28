"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

  // Google-style kinds. Out of office and Focus time are ordinary Outlook
  // events with the matching show-as and a default title; the title stays
  // editable and a hand-typed one is never overwritten.
  type Kind = "event" | "oof" | "focus";
  const KINDS: { k: Kind; label: string; title?: string; showAs: EventDraft["showAs"] }[] = [
    { k: "event", label: "Event", showAs: "busy" },
    { k: "oof", label: "Out of office", title: "Out of office", showAs: "oof" },
    { k: "focus", label: "Focus time", title: "Focus time", showAs: "busy" },
  ];
  // Reset to "Event" for each new popup without a setState-in-effect: track
  // the open flag the state was set for.
  const [kindFor, setKindFor] = useState<{ open: boolean; kind: Kind }>({ open: false, kind: "event" });
  const kind: Kind = kindFor.open === open ? kindFor.kind : "event";
  const setKind = (k: Kind) => setKindFor({ open, kind: k });
  const pickKind = (k: Kind) => {
    if (!draft) return;
    const prev = KINDS.find((x) => x.k === kind)!;
    const next = KINDS.find((x) => x.k === k)!;
    setKind(k);
    const auto = draft.subject.trim() === "" || draft.subject === prev.title;
    onChange({
      ...draft,
      showAs: next.showAs,
      ...(auto ? { subject: next.title ?? "" } : {}),
      ...(k !== "event" ? { teams: false, teamsAuto: false } : {}),
    });
  };
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
          <div className="ml-9 flex flex-wrap gap-1" role="tablist" aria-label="What to create">
            {KINDS.map((t) => (
              <button
                key={t.k}
                type="button"
                role="tab"
                aria-selected={kind === t.k}
                onClick={() => pickKind(t.k)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === t.k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
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
