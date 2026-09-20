// Pure helpers for editing existing events: what a drag/resize PATCH carries,
// how the description maps onto Graph's `body` without destroying HTML or the
// Teams meeting blob, and a field-by-field diff so a PATCH only sends what the
// user changed (Graph keeps every property that is not in the body).
import { toGraphRecurrence } from "./recurrence";
import { allDayExclusiveEnd } from "./time";
import type { EventDraft, GraphEvent } from "./types";

export type ItemBody = { contentType: "text" | "html"; content: string };

// ---------- drag / resize ----------

export type MoveInput = { start: string; end: string; allDay: boolean };

// FullCalendar's endStr for an all-day event is already the exclusive end as a
// date-only string, so it is passed through unchanged. Only when FullCalendar
// gives no end at all (a timed event dropped into the all-day row) is the end
// derived from the start. `end === ""` is that missing-end case.
export function moveBody(m: MoveInput, tz: string): Partial<GraphEvent> {
  if (m.allDay) {
    const start = m.start.slice(0, 10);
    const end = m.end ? m.end.slice(0, 10) : allDayExclusiveEnd(start);
    return { isAllDay: true, start: { dateTime: `${start}T00:00:00`, timeZone: tz }, end: { dateTime: `${end}T00:00:00`, timeZone: tz } };
  }
  return { isAllDay: false, start: { dateTime: m.start, timeZone: tz }, end: { dateTime: m.end || m.start, timeZone: tz } };
}

// ---------- guests + Teams default ----------

// A new event with at least one guest on a calendar that allows Teams gets a
// Teams meeting by default (the user can switch it off); without guests the
// switch is off. Once the user has toggled the switch (teamsAuto false) the
// guest list no longer moves it.
export function withAttendees(draft: EventDraft, attendees: EventDraft["attendees"], teamsAllowed: boolean): EventDraft {
  const next = { ...draft, attendees };
  if (draft.teamsAuto) next.teams = teamsAllowed && attendees.length > 0;
  return next;
}

// ---------- body ----------

const JOIN_RE = /teams\.microsoft\.com\/l\/meetup-join|meet\.google\.com|zoom\.us\/j\//i;

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

// The top-level block that carries the online-meeting join link (Outlook puts
// the Teams blob in its own <div> at the end of the body). Null when absent.
function meetingBlob(doc: Document): Element | null {
  const link = Array.from(doc.querySelectorAll("a[href]")).find((a) => JOIN_RE.test(a.getAttribute("href") ?? ""));
  if (!link) return null;
  let el: Element = link;
  while (el.parentElement && el.parentElement !== doc.body) el = el.parentElement;
  return el;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`)
    .join("");
}

// Plain text of a body for the description textarea. For HTML the Teams blob
// is left out (it is preserved separately on save) so the user edits only
// their own notes.
export function bodyToText(body: ItemBody | undefined | null): string {
  if (!body) return "";
  if (body.contentType !== "html") return body.content;
  const doc = parseHtml(body.content);
  if (!doc) return body.content.replace(/<[^>]+>/g, "").trim();
  meetingBlob(doc)?.remove();
  for (const br of Array.from(doc.querySelectorAll("br"))) br.replaceWith("\n");
  for (const block of Array.from(doc.querySelectorAll("div,p,li,tr,h1,h2,h3,h4"))) block.append("\n");
  return (doc.body.textContent ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The `body` to PATCH for an edited description, or undefined when nothing
// changed (so the request omits body and Graph keeps the original). An HTML
// body stays HTML, and the online-meeting blob is carried over untouched.
export function bodyPatch(original: ItemBody | undefined | null, description: string, isOnlineMeeting = false): ItemBody | undefined {
  const before = bodyToText(original);
  if (before.trim() === description.trim()) return undefined;
  if (!original || original.contentType !== "html") return { contentType: "text", content: description };
  const doc = parseHtml(original.content);
  const blob = doc ? meetingBlob(doc) : null;
  const keep = blob ? blob.outerHTML : "";
  if (isOnlineMeeting && !blob && doc) {
    // Online meeting whose blob we could not isolate: append the notes instead of replacing the body.
    return { contentType: "html", content: `${textToHtml(description)}${original.content}` };
  }
  return { contentType: "html", content: `${textToHtml(description)}${keep ? `<br>${keep}` : ""}` };
}

// ---------- diff ----------

export type PatchOptions = {
  tz: string;
  defaultReminder?: number | null; // unused: the draft carries the reminder; kept for call-site symmetry
  // "all": PATCHing the series master. "this" / undefined: a single event, occurrence or exception.
  scope?: "this" | "all";
  originalBody?: ItemBody | null;
  isOnlineMeeting?: boolean;
  isSeriesMaster?: boolean;
};

const sameAttendees = (a: EventDraft["attendees"], b: EventDraft["attendees"]) => a.length === b.length && a.every((x, i) => x.email.toLowerCase() === b[i].email.toLowerCase());

function wallSeconds(d: EventDraft, which: "start" | "end"): string {
  const v = d[which];
  if (d.allDay) return `${v.slice(0, 10)}T00:00:00`;
  return v.length === 16 ? `${v}:00` : v;
}

// Only the fields whose value differs from the original draft. Times travel
// together (start, end, isAllDay). `body` is built by bodyPatch. Recurrence is
// only sent when the user touched the Repeat control, and never as null to a
// series master (Graph would collapse the series).
export function patchBody(orig: EventDraft, next: EventDraft, opts: PatchOptions): Partial<GraphEvent> {
  const out: Partial<GraphEvent> = {};
  if (next.subject.trim() !== orig.subject.trim()) out.subject = next.subject.trim() || "(No title)";
  if (wallSeconds(orig, "start") !== wallSeconds(next, "start") || wallSeconds(orig, "end") !== wallSeconds(next, "end") || orig.allDay !== next.allDay) {
    out.isAllDay = next.allDay;
    out.start = { dateTime: wallSeconds(next, "start"), timeZone: opts.tz };
    out.end = { dateTime: wallSeconds(next, "end"), timeZone: opts.tz };
  }
  if (next.location.trim() !== orig.location.trim()) out.location = { displayName: next.location.trim() };
  if (!sameAttendees(orig.attendees, next.attendees)) out.attendees = next.attendees.map((a) => ({ type: "required", emailAddress: { address: a.email, name: a.name } }));
  if (next.teams !== orig.teams && !opts.isOnlineMeeting) {
    out.isOnlineMeeting = next.teams;
    if (next.teams) out.onlineMeetingProvider = "teamsForBusiness";
  }
  // draft.reminder null = "No reminder" (a new draft already carries the settings default).
  if (next.reminder !== orig.reminder) {
    out.isReminderOn = next.reminder !== null;
    out.reminderMinutesBeforeStart = next.reminder ?? 0;
  }
  if (next.showAs !== orig.showAs) out.showAs = next.showAs;
  if (next.isPrivate !== orig.isPrivate) out.sensitivity = next.isPrivate ? "private" : "normal";
  const body = bodyPatch(opts.originalBody, next.description, opts.isOnlineMeeting);
  if (body) out.body = body;
  if (next.recurrenceTouched) {
    const rec = next.recurrenceForm ? toGraphRecurrence(next.recurrenceForm, next.start.slice(0, 10), opts.tz) : next.recurrence;
    const master = opts.scope === "all" || opts.isSeriesMaster;
    // A null recurrence is never sent: to a master it would collapse the series,
    // and a non-repeating event is already non-repeating.
    if (rec && (opts.scope !== "this" || master)) out.recurrence = rec;
  }
  return out;
}
