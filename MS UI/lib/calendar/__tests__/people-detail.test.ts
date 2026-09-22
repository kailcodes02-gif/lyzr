import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

import { detailLevel } from "../people";
import { scheduleItemsToEvents } from "../overlay";

const item = (subject?: string, isPrivate = false) => ({ status: "busy", subject, isPrivate, start: { dateTime: "2026-09-22T09:00:00", timeZone: "UTC" }, end: { dateTime: "2026-09-22T10:00:00", timeZone: "UTC" } });

describe("how much of a colleague's calendar we can see", () => {
  it("is 'full' for a shared calendar, 'limited' when getSchedule items carry subjects, 'busy' otherwise", () => {
    expect(detailLevel("shared")).toBe("full");
    expect(detailLevel("none")).toBe("none");
    expect(detailLevel("schedule", [item(), item()])).toBe("busy");
    expect(detailLevel("schedule", [])).toBe("busy");
    expect(detailLevel("schedule", [item(), item("Design review")])).toBe("limited");
    // A private item's subject is withheld, so it does not count as a detail.
    expect(detailLevel("schedule", [item("Doctor", true)])).toBe("busy");
  });
  it("shows limited-details subjects and locations on the overlay, 'Busy' otherwise", () => {
    const person = { name: "Siva Surendira", email: "siva@lyzr.ai", color: "#0b8043" };
    const evs = scheduleItemsToEvents(person, [{ ...item("Design review"), location: "Bay 4" }, item(), item("Doctor", true)], "UTC");
    expect(evs.map((e) => e.subject)).toEqual(["Design review", "Busy", "Busy"]);
    expect(evs[0].location?.displayName).toBe("Bay 4");
    expect(evs[2].sensitivity).toBe("private");
  });
});
