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
import { Lock } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { chipKind, chipOuterClass, durationMinutes, type FcEventInput, type WallEvent } from "@/lib/calendar/events";
import { chipStartTime, chipTimeRange } from "@/lib/calendar/time";
import type { ViewKind } from "@/lib/calendar/types";

export type GridSelection = { start: string; end: string; allDay: boolean; x: number; y: number };
// end: exclusive wall end from FullCalendar, or "" when it had none (timed event dropped in the all-day row).
export type GridMove = { ev: WallEvent; start: string; end: string; allDay: boolean; revert: () => void };

const FC_VIEW: Record<Exclude<ViewKind, "agenda">, string> = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth", "4day": "timeGridFourDay" };

// FC returns wall time plus an offset in the calendar's zone; keep the wall part.
export function fcWall(s: string): string {
  return s.length <= 10 ? s : s.slice(0, 19);
}

// The outer element's class: solid chips get the event colour as background,
// dot chips stay transparent (the dot carries the colour). Time-grid blocks
// also get msui-ev-tg: the page-coloured outline that separates overlaps.
function chipClass(info: Pick<EventDisplayInfo, "view" | "event">): string {
  const kind = chipKind(info.view.type, info.event.allDay);
  return kind === "block" ? `${chipOuterClass(kind)} msui-ev-tg` : chipOuterClass(kind);
}

// Blocks shorter than this get Google's single line "Title, 1pm"; longer
// ones the title (wrapping) with the time range on the line below.
const ONE_LINE_MINUTES = 45;

function EventContent(info: EventDisplayInfo) {
  const ev = info.event.extendedProps.ev as WallEvent | undefined;
  const kind = chipKind(info.view.type, info.event.allDay);
  // The text colour is computed for the chip colour (dark on light, white on
  // dark); a CSS variable so the invite / dot variants can override it.
  const style = { "--msui-ev-text": info.contrastColor } as CSSProperties;
  const oneLine = kind === "block" && !!ev && durationMinutes(ev) < ONE_LINE_MINUTES;
  return (
    <div className={`msui-ev-inner msui-ev-${kind}${oneLine ? " msui-ev-oneline" : ""}`} style={style} title={info.event.title}>
      {kind === "dot" && <span className="msui-ev-bullet" style={{ background: info.color }} aria-hidden />}
      <span className="msui-ev-title">
        {ev?.sensitivity === "private" && <Lock className="msui-ev-icon" aria-label="Private" />}
        {info.event.title}
        {oneLine && <span className="msui-ev-time">, {chipStartTime(ev!.startWall)}</span>}
      </span>
      {kind === "block" && ev && !oneLine && <span className="msui-ev-time">{chipTimeRange(ev.startWall, ev.endWall)}</span>}
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

  // endStr is the exclusive end (date-only for all-day events) and is passed
  // through unchanged; "" tells the caller FullCalendar had no end to give.
  const change = (info: EventDropInfo | EventResizeDoneInfo) => {
    const ev = info.event.extendedProps.ev as WallEvent;
    onEventChange({ ev, start: fcWall(info.event.startStr), end: info.event.endStr ? fcWall(info.event.endStr) : "", allDay: info.event.allDay, revert: info.revert });
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
        // Chips carry no time text (the axis and the popover show it).
        displayEventTime={false}
        events={events}
        eventClass={chipClass}
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
