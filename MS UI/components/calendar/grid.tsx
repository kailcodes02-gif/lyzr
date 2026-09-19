"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/indigo.css";
import "./calendar.css";

import FullCalendar, { type CalendarRef, type DateSelectInfo, type EventClickInfo, type EventDisplayInfo, type EventDropInfo, type EventResizeDoneInfo } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import breezyTheme from "@fullcalendar/react/themes/breezy";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { Lock, Repeat, Video } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FcEventInput, WallEvent } from "@/lib/calendar/events";
import type { ViewKind } from "@/lib/calendar/types";

export type GridSelection = { start: string; end: string; allDay: boolean; x: number; y: number };
export type GridMove = { ev: WallEvent; start: string; end: string; allDay: boolean; revert: () => void };

const FC_VIEW: Record<Exclude<ViewKind, "agenda">, string> = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth", "4day": "timeGridFourDay" };

// FC returns wall time plus an offset in the calendar's zone; keep the wall part.
export function fcWall(s: string): string {
  return s.length <= 10 ? s : s.slice(0, 19);
}

function EventContent(info: EventDisplayInfo) {
  const ev = info.event.extendedProps.ev as WallEvent | undefined;
  const block = info.view.type.startsWith("timeGrid") && !info.event.allDay;
  return (
    <div className={`msui-ev-inner ${block ? "msui-ev-block" : ""}`}>
      {!info.event.allDay && info.timeText && !block && <span className="msui-ev-time">{info.timeText}</span>}
      <span className="msui-ev-title">
        {ev?.sensitivity === "private" && <Lock className="mr-1 inline size-3 align-[-2px]" />}
        {info.event.title}
      </span>
      {block && <span className="msui-ev-time">{info.timeText}</span>}
      {ev?.isOnlineMeeting && block && <Video className="mt-0.5 size-3 opacity-80" />}
      {ev?.seriesMasterId && block && <Repeat className="mt-0.5 size-3 opacity-80" />}
    </div>
  );
}

export default function CalendarGrid({
  view,
  date,
  timeZone,
  weekStartsOn,
  events,
  dark,
  onSelect,
  onEventClick,
  onEventChange,
}: {
  view: Exclude<ViewKind, "agenda">;
  date: string;
  timeZone: string;
  weekStartsOn: 0 | 1 | 6;
  events: FcEventInput[];
  dark: boolean;
  onSelect: (sel: GridSelection) => void;
  onEventClick: (ev: WallEvent, el: HTMLElement) => void;
  onEventChange: (move: GridMove) => void;
}) {
  const ref = useRef<CalendarRef>(null);

  useEffect(() => {
    const api = ref.current?.getApi();
    if (!api) return;
    const target = FC_VIEW[view];
    if (api.view.type !== target) api.changeView(target, date);
    else api.gotoDate(date);
  }, [view, date]);

  const change = (info: EventDropInfo | EventResizeDoneInfo) => {
    const ev = info.event.extendedProps.ev as WallEvent;
    onEventChange({ ev, start: fcWall(info.event.startStr), end: fcWall(info.event.endStr || info.event.startStr), allDay: info.event.allDay, revert: info.revert });
  };

  return (
    <div className="msui-cal h-full" data-color-scheme={dark ? "dark" : "light"}>
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, breezyTheme]}
        initialView={FC_VIEW[view]}
        initialDate={date}
        timeZone={timeZone}
        firstDay={weekStartsOn}
        headerToolbar={false}
        height="100%"
        views={{ timeGridFourDay: { type: "timeGrid", duration: { days: 4 } } }}
        nowIndicator
        selectable
        selectMirror
        editable
        eventResizableFromStart
        dayMaxEvents={4}
        fixedWeekCount={false}
        slotDuration="00:30:00"
        snapDuration="00:15:00"
        scrollTime="08:00:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        events={events}
        eventContent={EventContent}
        select={(info: DateSelectInfo) => {
          const js = info.jsEvent;
          onSelect({ start: fcWall(info.startStr), end: fcWall(info.endStr), allDay: info.allDay, x: js?.clientX ?? window.innerWidth / 2, y: js?.clientY ?? window.innerHeight / 2 });
        }}
        eventClick={(info: EventClickInfo) => {
          info.jsEvent.preventDefault();
          onEventClick(info.event.extendedProps.ev as WallEvent, info.el);
        }}
        eventDrop={change}
        eventResize={change}
      />
    </div>
  );
}
