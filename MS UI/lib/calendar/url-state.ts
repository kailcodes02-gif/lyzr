import type { ViewKind } from "./types";

export type CalendarUrlState = { view: ViewKind; date: string | null; eventId: string | null; calendars: string[] | null; q: string };

const VIEWS: ViewKind[] = ["day", "week", "month", "4day", "agenda"];

export function parseUrlState(params: URLSearchParams | string): CalendarUrlState {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const v = p.get("view") ?? "";
  const date = p.get("date");
  const cal = p.get("cal");
  return {
    view: (VIEWS as string[]).includes(v) ? (v as ViewKind) : "week",
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    eventId: p.get("e") || null,
    calendars: cal ? cal.split(",").filter(Boolean) : null,
    q: p.get("q") ?? "",
  };
}

export function serializeUrlState(s: Partial<CalendarUrlState>, defaults: { date: string }): string {
  const p = new URLSearchParams();
  if (s.view && s.view !== "week") p.set("view", s.view);
  if (s.date && s.date !== defaults.date) p.set("date", s.date);
  if (s.eventId) p.set("e", s.eventId);
  if (s.calendars && s.calendars.length) p.set("cal", s.calendars.join(","));
  if (s.q) p.set("q", s.q);
  const str = p.toString();
  return str ? `?${str}` : "";
}
