import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import { collectBatch, draftToGraph, FOCUS_THROTTLE_MS, isConsentError, recurrenceProblem } from "../hooks";
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
