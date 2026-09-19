"use client";

import { AlignLeft, Clock, MapPin, Users, Video } from "lucide-react";
import { useState } from "react";
import { PeoplePicker } from "@/components/people-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { calendarHex } from "@/lib/calendar/colors";
import { allDayExclusiveEnd, allDayInclusiveEnd, addMinutesWall } from "@/lib/calendar/time";
import type { EventDraft, GraphCalendar } from "@/lib/calendar/types";
import { REMINDER_OPTIONS } from "./settings-dialog";
import { RecurrenceEditor } from "./recurrence-editor";
import { FindTime } from "./find-time";
import { defaultForm, fromGraphRecurrence, toGraphRecurrence, type RecurrenceForm } from "@/lib/calendar/recurrence";

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr] items-start gap-3">
      <span className="mt-2 text-muted-foreground">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function EventForm({
  draft,
  onChange,
  calendars,
  full,
  tz,
  durationMinutes,
  titleRef,
  recurrenceForm,
  onRecurrenceForm,
}: {
  draft: EventDraft;
  onChange: (d: EventDraft) => void;
  calendars: GraphCalendar[];
  full: boolean;
  tz: string;
  durationMinutes: number;
  titleRef?: React.RefObject<HTMLInputElement | null>;
  recurrenceForm?: RecurrenceForm;
  onRecurrenceForm?: (f: RecurrenceForm) => void;
}) {
  const set = (p: Partial<EventDraft>) => onChange({ ...draft, ...p });
  const cal = calendars.find((c) => c.id === draft.calendarId);
  const teamsAllowed = !!cal?.allowedOnlineMeetingProviders?.includes("teamsForBusiness");
  const [showFind, setShowFind] = useState(false);
  const [localRec, setLocalRec] = useState<RecurrenceForm>(() => fromGraphRecurrence(draft.recurrence, draft.start.slice(0, 10)));
  const rec = recurrenceForm ?? localRec;
  const setRec = (f: RecurrenceForm) => {
    (onRecurrenceForm ?? setLocalRec)(f);
    set({ recurrence: toGraphRecurrence(f, draft.start.slice(0, 10), tz) });
  };

  const toggleAllDay = (allDay: boolean) => {
    if (allDay) set({ allDay, start: draft.start.slice(0, 10), end: allDayExclusiveEnd(draft.end.slice(0, 10) < draft.start.slice(0, 10) ? draft.start.slice(0, 10) : draft.end.length > 10 ? draft.end.slice(0, 10) : allDayInclusiveEnd(draft.end)) });
    else {
      const s = `${draft.start.slice(0, 10)}T09:00`;
      set({ allDay, start: s, end: addMinutesWall(`${s}:00`, durationMinutes).slice(0, 16) });
    }
  };
  const setStart = (v: string) => {
    if (!v) return;
    if (draft.allDay) {
      const end = draft.end.slice(0, 10) <= v ? allDayExclusiveEnd(v) : draft.end;
      set({ start: v, end });
    } else {
      const dur = Math.max(15, (Date.parse(draft.end) - Date.parse(draft.start)) / 60_000 || durationMinutes);
      set({ start: v, end: addMinutesWall(`${v}:00`, dur).slice(0, 16) });
    }
  };
  const setEnd = (v: string) => {
    if (!v) return;
    if (draft.allDay) set({ end: allDayExclusiveEnd(v) });
    else set({ end: v < draft.start ? draft.start : v });
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={titleRef}
        value={draft.subject}
        onChange={(e) => set({ subject: e.target.value })}
        placeholder="Add title"
        aria-label="Title"
        className="ml-9 border-b border-border bg-transparent pb-1 text-lg outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      <Row icon={<Clock className="size-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          {draft.allDay ? (
            <>
              <Input type="date" value={draft.start.slice(0, 10)} onChange={(e) => setStart(e.target.value)} aria-label="Start date" className="w-40" />
              <span className="text-muted-foreground">to</span>
              <Input type="date" value={allDayInclusiveEnd(draft.end)} onChange={(e) => setEnd(e.target.value)} aria-label="End date" className="w-40" />
            </>
          ) : (
            <>
              <Input type="datetime-local" value={draft.start} onChange={(e) => setStart(e.target.value)} aria-label="Start" className="w-52" />
              <span className="text-muted-foreground">to</span>
              <Input type="datetime-local" value={draft.end} onChange={(e) => setEnd(e.target.value)} aria-label="End" className="w-52" />
            </>
          )}
          <label className="ml-1 flex items-center gap-2 text-xs">
            <Switch size="sm" checked={draft.allDay} onCheckedChange={toggleAllDay} aria-label="All day" />
            All day
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Time zone: {tz}</p>
        {full && (
          <div className="mt-2">
            <RecurrenceEditor value={rec} onChange={setRec} startDate={draft.start.slice(0, 10)} />
          </div>
        )}
      </Row>
      <Row icon={<Users className="size-4" />}>
        <PeoplePicker value={draft.attendees} onChange={(attendees) => set({ attendees })} placeholder="Add guests" />
        {full && draft.attendees.length > 0 && !draft.allDay && (
          <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowFind((s) => !s)}>
            {showFind ? "Hide availability" : "Find a time"}
          </button>
        )}
        {full && showFind && !draft.allDay && (
          <div className="mt-2">
            <FindTime
              emails={draft.attendees.map((a) => a.email)}
              day={draft.start.slice(0, 10)}
              tz={tz}
              durationMinutes={Math.max(15, (Date.parse(draft.end) - Date.parse(draft.start)) / 60_000 || durationMinutes)}
              onPick={(s, e) => set({ start: s.slice(0, 16), end: e.slice(0, 16) })}
            />
          </div>
        )}
      </Row>
      <Row icon={<Video className="size-4" />}>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={draft.teams} disabled={!teamsAllowed} onCheckedChange={(v) => set({ teams: v })} aria-label="Add Teams meeting" />
          Add Teams meeting
          {!teamsAllowed && <span className="text-xs text-muted-foreground">(not available on this calendar)</span>}
        </label>
      </Row>
      <Row icon={<MapPin className="size-4" />}>
        <Input value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Add location" aria-label="Location" />
      </Row>
      <Row icon={<span className="inline-block size-3.5 rounded-full" style={{ background: calendarHex(cal) }} />}>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={draft.calendarId} onValueChange={(v) => v && set({ calendarId: v, teams: draft.teams && !!calendars.find((c) => c.id === v)?.allowedOnlineMeetingProviders?.includes("teamsForBusiness") })}>
            <SelectTrigger size="sm" aria-label="Calendar">
              <SelectValue>{cal?.name ?? "Calendar"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: calendarHex(c) }} />
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={draft.reminder === null ? "none" : String(draft.reminder)} onValueChange={(v) => set({ reminder: v === "none" || !v ? null : Number(v) })}>
            <SelectTrigger size="sm" aria-label="Reminder">
              <SelectValue>{REMINDER_OPTIONS.find((o) => o.value === (draft.reminder === null ? "none" : String(draft.reminder)))?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REMINDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {full && (
            <>
              <Select value={draft.showAs} onValueChange={(v) => v && set({ showAs: v as EventDraft["showAs"] })}>
                <SelectTrigger size="sm" aria-label="Show as">
                  <SelectValue>{{ busy: "Busy", free: "Free", tentative: "Tentative", oof: "Out of office", workingElsewhere: "Working elsewhere", unknown: "Busy" }[draft.showAs]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="busy">Busy</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="tentative">Tentative</SelectItem>
                  <SelectItem value="oof">Out of office</SelectItem>
                  <SelectItem value="workingElsewhere">Working elsewhere</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs">
                <Switch size="sm" checked={draft.isPrivate} onCheckedChange={(v) => set({ isPrivate: v })} aria-label="Private" />
                Private
              </label>
            </>
          )}
        </div>
      </Row>
      <Row icon={<AlignLeft className="size-4" />}>
        <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Add description" aria-label="Description" rows={full ? 5 : 2} />
      </Row>
    </div>
  );
}

export { defaultForm as defaultRecurrenceForm };
