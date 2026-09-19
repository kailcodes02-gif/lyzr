"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fromGraphRecurrence, type RecurrenceForm } from "@/lib/calendar/recurrence";
import type { EventDraft, GraphCalendar } from "@/lib/calendar/types";
import { EventForm } from "./event-form";

export function EventDialog({
  open,
  draft,
  onChange,
  onClose,
  onSave,
  calendars,
  tz,
  durationMinutes,
  saving,
  scope,
}: {
  open: boolean;
  draft: EventDraft | null;
  onChange: (d: EventDraft) => void;
  onClose: () => void;
  onSave: () => void;
  calendars: GraphCalendar[];
  tz: string;
  durationMinutes: number;
  saving: boolean;
  scope?: "this" | "all";
}) {
  return (
    <Dialog open={open && !!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {draft?.id ? "Edit event" : "New event"}
            {scope === "all" && <span className="ml-2 text-xs font-normal text-muted-foreground">(all events in the series)</span>}
            {scope === "this" && <span className="ml-2 text-xs font-normal text-muted-foreground">(this event only)</span>}
          </DialogTitle>
        </DialogHeader>
        {draft && <Body key={draft.id ?? "new"} draft={draft} onChange={onChange} onClose={onClose} onSave={onSave} calendars={calendars} tz={tz} durationMinutes={durationMinutes} saving={saving} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  draft,
  onChange,
  onClose,
  onSave,
  calendars,
  tz,
  durationMinutes,
  saving,
}: {
  draft: EventDraft;
  onChange: (d: EventDraft) => void;
  onClose: () => void;
  onSave: () => void;
  calendars: GraphCalendar[];
  tz: string;
  durationMinutes: number;
  saving: boolean;
}) {
  const [rec, setRec] = useState<RecurrenceForm>(() => fromGraphRecurrence(draft.recurrence, draft.start.slice(0, 10)));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <EventForm draft={draft} onChange={onChange} calendars={calendars} full tz={tz} durationMinutes={durationMinutes} recurrenceForm={rec} onRecurrenceForm={setRec} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="rounded-full px-5">
          Save
        </Button>
      </div>
    </form>
  );
}
