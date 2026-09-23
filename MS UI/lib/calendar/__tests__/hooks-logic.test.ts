import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import { collectBatch, draftToGraph, FOCUS_THROTTLE_MS, isConsentError, recurrenceProblem, uniqueCalendarIds, viewBatchRequests, withCalendarIds } from "../hooks";
import { POLL_INTERVAL_MS, SAFETY_INTERVAL_MS } from "../freshness";
import { defaultForm } from "../recurrence";
import { ConsentRequiredError, GraphError } from "@/lib/graph";
import type { EventDraft } from "../types";

const draft: EventDraft = {
  calendarId: "c",
  subject: "Standup",
  start: "2026-09-22T09:00",
  end: "2026-09-22T09:15",
  allDay: false,
  attendees: [],
  location: "",
  teams: false,
  reminder: 5,
  description: "",
  recurrence: null,
  showAs: "busy",
  isPrivate: false,
};

describe("draftToGraph", () => {
  it("derives the recurrence from the form at save time so range.startDate follows an edited start", () => {
    // The Repeat control was set while the start was Tuesday the 22nd; the user then moved the event to Thursday.
    const stale = { pattern: { type: "weekly" as const, interval: 1, daysOfWeek: ["tuesday" as const] }, range: { type: "noEnd" as const, startDate: "2026-09-22" } };
    const body = draftToGraph({ ...draft, start: "2026-09-24T09:00", end: "2026-09-24T09:15", recurrence: stale, recurrenceForm: { ...defaultForm("2026-09-22"), preset: "weekly" } }, "Asia/Kolkata", 15);
    expect(body.recurrence?.range.startDate).toBe("2026-09-24");
    expect(body.recurrence?.pattern.daysOfWeek).toEqual(["thursday"]);
    expect(body.start?.dateTime).toBe("2026-09-24T09:00:00");
  });
  it("sends required attendees and the Teams meeting flags when the switch is on", () => {
    const body = draftToGraph({ ...draft, teams: true, attendees: [{ name: "Siva", email: "siva@lyzr.ai" }] }, "UTC", 15);
    expect(body.attendees).toEqual([{ type: "required", emailAddress: { address: "siva@lyzr.ai", name: "Siva" } }]);
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe("teamsForBusiness");
    const off = draftToGraph({ ...draft, teams: false, attendees: [{ name: "Siva", email: "siva@lyzr.ai" }] }, "UTC", 15);
    expect(off.isOnlineMeeting).toBe(false);
    expect(off.onlineMeetingProvider).toBeUndefined();
  });
  it("keeps 'Does not repeat' as null", () => {
    expect(draftToGraph({ ...draft, recurrenceForm: defaultForm("2026-09-22") }, "UTC", null).recurrence).toBeNull();
  });
  it("rejects a repeat end date before the start", () => {
    expect(recurrenceProblem({ ...draft, recurrenceForm: { ...defaultForm("2026-09-22"), preset: "custom", ends: "on", endDate: "2026-09-01" } })).toMatch(/end date/);
    expect(recurrenceProblem({ ...draft, recurrenceForm: { ...defaultForm("2026-09-22"), preset: "custom", ends: "on", endDate: "2026-12-01" } })).toBeNull();
    expect(recurrenceProblem(draft)).toBeNull();
  });
});

describe("collectBatch", () => {
  it("keeps the calendars that answered and reports the ones that failed", () => {
    const { pages, failed } = collectBatch([
      { id: "mine", status: 200, body: { value: [{ id: "e1" }] } },
      { id: "shared", status: 403, body: { error: { code: "ErrorAccessDenied", message: "Access is denied" } } },
      { id: "gone", status: 404, body: { error: { code: "ErrorItemNotFound", message: "not found" } } },
    ]);
    expect(pages.map((p) => p.id)).toEqual(["mine"]);
    expect(failed).toEqual([
      { id: "shared", status: 403, code: "ErrorAccessDenied", message: "Access is denied" },
      { id: "gone", status: 404, code: "ErrorItemNotFound", message: "not found" },
    ]);
  });
});

describe("isConsentError", () => {
  it("recognises ConsentRequiredError from getToken, and Graph 401/403", () => {
    expect(isConsentError(new ConsentRequiredError(["Calendars.ReadWrite"], "invalid_grant / consent_required"))).toBe(true);
    expect(isConsentError(new GraphError(403, "ErrorAccessDenied", "denied", "/me/calendars"))).toBe(true);
    expect(isConsentError(new GraphError(500, "Internal", "boom", "/me/calendars"))).toBe(false);
    expect(isConsentError(new Error("network"))).toBe(false);
  });
});

describe("polling cadence (mailbox concurrency budget)", () => {
  it("refetches every calendar every 120 s, polls the delta every 15 s and throttles focus refetches to one per 10 s", () => {
    expect(SAFETY_INTERVAL_MS).toBe(120_000);
    expect(POLL_INTERVAL_MS).toBe(15_000);
    expect(FOCUS_THROTTLE_MS).toBe(10_000);
  });
});

describe("viewFetching (delta round starvation guard)", () => {
  it("is true only while the SAME range's calendarView is in flight, not for a neighbour's prefetch", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { viewFetching, viewKey } = await import("../hooks");
    const qc = new QueryClient();
    const range = { start: "2026-09-23", end: "2026-09-24" };
    let release!: () => void;
    const neighbour = qc.fetchQuery({ queryKey: viewKey("UTC", "2026-09-24", "2026-09-25", ["a"]), queryFn: () => new Promise<null>((r) => (release = () => r(null))) });
    expect(qc.isFetching({ queryKey: ["calendarView"] })).toBe(1);
    expect(viewFetching(qc, "UTC", range)).toBe(false); // a prefetch of tomorrow must not skip today's delta round
    let release2!: () => void;
    const same = qc.fetchQuery({ queryKey: viewKey("UTC", range.start, range.end, ["a", "b"]), queryFn: () => new Promise<null>((r) => (release2 = () => r(null))) });
    expect(viewFetching(qc, "UTC", range)).toBe(true); // this range, any calendar set
    release();
    release2();
    await Promise.all([neighbour, same]);
    expect(viewFetching(qc, "UTC", range)).toBe(false);
  });
});

describe("calendarView $batch ids", () => {
  const long = "AAMkAGI2TG93AAA=";
  it("gives every sub-request a unique positional id and addresses group calendars through their group", () => {
    const reqs = viewBatchRequests([long, "cal2"], { cal2: "grp1" }, "2026-09-21T00%3A00%3A00%2B05%3A30", "2026-09-28T00%3A00%3A00%2B05%3A30", { Prefer: 'outlook.timezone="Asia/Kolkata"' });
    expect(reqs.map((r) => r.id)).toEqual(["0", "1"]);
    expect(new Set(reqs.map((r) => r.id.toLowerCase())).size).toBe(reqs.length);
    expect(reqs[0].url).toBe("/me/calendars/AAMkAGI2TG93AAA%3D/calendarView?startDateTime=2026-09-21T00%3A00%3A00%2B05%3A30&endDateTime=2026-09-28T00%3A00%3A00%2B05%3A30&$select=" + reqs[0].url.split("$select=")[1].split("&")[0] + "&$top=1000");
    expect(reqs[1].url.startsWith("/me/calendarGroups/grp1/calendars/cal2/calendarView?")).toBe(true);
    expect(reqs[1].headers).toEqual({ Prefer: 'outlook.timezone="Asia/Kolkata"' });
  });
  it("drops duplicate calendar ids so Graph never sees two sub-requests with the same id", () => {
    expect(uniqueCalendarIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(viewBatchRequests(uniqueCalendarIds(["a", "a"]), undefined, "s", "e", {})).toHaveLength(1);
  });
  it("maps positional response ids back to calendar ids before the responses are read", () => {
    const out = withCalendarIds([{ id: "1", status: 200, body: { value: [] } }, { id: "0", status: 403 }], [long, "cal2"]);
    expect(out.map((r) => r.id)).toEqual(["cal2", long]);
    const { pages, failed } = collectBatch(out);
    expect(pages[0].id).toBe("cal2");
    expect(failed[0].id).toBe(long);
  });
});
