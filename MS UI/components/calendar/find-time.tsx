"use client";

import { useSchedule } from "@/lib/calendar/hooks";
import { freeSlots, parseAvailabilityView, slotsFor, type Availability } from "@/lib/calendar/schedule";
import { addMinutesWall, shortTime } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";

const COLOR: Record<Availability, string> = {
  free: "bg-success/30",
  tentative: "bg-primary/30 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.5)_0_3px,transparent_3px_6px)]",
  busy: "bg-primary/80",
  oof: "bg-destructive/60",
  workingElsewhere: "bg-muted-foreground/40",
  unknown: "bg-muted",
};

// Free/busy strip per guest for one day (08:00 to 20:00, 30 minute slots). Click a slot to pick it.
export function FindTime({ emails, day, tz, durationMinutes, onPick }: { emails: string[]; day: string; tz: string; durationMinutes: number; onPick: (start: string, end: string) => void }) {
  const q = useSchedule(emails, day, tz, true);
  const slots = slotsFor(`${day}T08:00:00`, 30, 24);
  const free = q.data ? new Set(freeSlots(q.data, slots.length)) : new Set<number>();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Availability on {day}, 8 am to 8 pm. Click a slot to use it.</span>
        {q.isFetching && <span>Checking...</span>}
      </div>
      {q.isError && <p className="text-xs text-destructive">Could not load availability: {(q.error as Error).message}</p>}
      <div className="grid grid-cols-[8rem_1fr] gap-y-1">
        {(q.data ?? emails.map((e) => ({ scheduleId: e, availabilityView: "" }))).map((s) => {
          const av = parseAvailabilityView(s.availabilityView ?? "");
          return (
            <div key={s.scheduleId} className="contents">
              <div className="truncate pr-2 text-xs" title={s.scheduleId}>
                {s.scheduleId.split("@")[0]}
              </div>
              <div className="grid grid-cols-24 gap-px">
                {slots.map((slot) => (
                  <button
                    key={slot.index}
                    type="button"
                    title={`${shortTime(slot.start)}: ${av[slot.index] ?? "unknown"}`}
                    onClick={() => onPick(slot.start, addMinutesWall(slot.start, durationMinutes))}
                    className={cn("h-5 rounded-sm", COLOR[av[slot.index] ?? "unknown"], free.has(slot.index) && "ring-1 ring-success")}
                  />
                ))}
              </div>
            </div>
          );
        })}
        <div />
        <div className="grid grid-cols-24 text-[9px] text-muted-foreground">
          {slots.map((s) => (
            <span key={s.index}>{s.index % 4 === 0 ? shortTime(s.start).replace(" ", "") : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
