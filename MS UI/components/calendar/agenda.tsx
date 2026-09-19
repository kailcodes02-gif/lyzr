"use client";

import { Lock, Repeat, Video } from "lucide-react";
import { calendarHex } from "@/lib/calendar/colors";
import { groupByDay, type WallEvent } from "@/lib/calendar/events";
import { parseWall, shortTime } from "@/lib/calendar/time";
import type { GraphCalendar } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export function AgendaView({
  events,
  calendars,
  range,
  today,
  onOpen,
}: {
  events: WallEvent[];
  calendars: GraphCalendar[];
  range: { start: string; end: string };
  today: string;
  onOpen: (ev: WallEvent, el: HTMLElement) => void;
}) {
  const groups = groupByDay(events, range.start, range.end);
  const calById = new Map(calendars.map((c) => [c.id, c]));
  if (!groups.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
        <p className="text-base">Nothing scheduled</p>
        <p className="text-xs">Press c to create an event.</p>
      </div>
    );
  return (
    <div className="h-full overflow-auto px-4 py-2">
      {groups.map((g) => {
        const d = parseWall(g.day);
        const isToday = g.day === today;
        return (
          <section key={g.day} className="flex gap-4 border-b border-border py-3">
            <div className="w-24 shrink-0">
              <div className={cn("inline-flex size-9 items-center justify-center rounded-full text-lg font-medium", isToday && "bg-primary text-primary-foreground")}>{format(d, "d")}</div>
              <div className="mt-1 text-xs uppercase text-muted-foreground">{format(d, "MMM, EEE")}</div>
            </div>
            <ul className="flex flex-1 flex-col gap-0.5">
              {g.events.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={(e) => onOpen(ev, e.currentTarget)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="size-3 shrink-0 rounded-full" style={{ background: calendarHex(calById.get(ev.calendarId)) }} />
                    <span className="w-36 shrink-0 text-muted-foreground">{ev.isAllDay ? "All day" : `${shortTime(ev.startWall)} to ${shortTime(ev.endWall)}`}</span>
                    <span className={cn("flex-1 truncate", ev.isCancelled && "line-through opacity-60")}>
                      {ev.sensitivity === "private" && <Lock className="mr-1 inline size-3 align-[-2px]" />}
                      {ev.subject || "(No title)"}
                    </span>
                    {ev.seriesMasterId && <Repeat className="size-3.5 text-muted-foreground" />}
                    {ev.isOnlineMeeting && <Video className="size-3.5 text-muted-foreground" />}
                    {ev.location?.displayName && <span className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline">{ev.location.displayName}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
