import { addMinutesWall } from "./time";
import type { ScheduleInformation } from "./types";

export type Availability = "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";

const CODES: Record<string, Availability> = { "0": "free", "1": "tentative", "2": "busy", "3": "oof", "4": "workingElsewhere" };

// availabilityView is one character per interval, starting at the request's startTime.
export function parseAvailabilityView(view: string): Availability[] {
  return Array.from(view).map((c) => CODES[c] ?? "unknown");
}

export type Slot = { start: string; end: string; index: number };

export function slotsFor(startWall: string, intervalMinutes: number, count: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const s = addMinutesWall(startWall, i * intervalMinutes);
    out.push({ start: s, end: addMinutesWall(s, intervalMinutes), index: i });
  }
  return out;
}

// Slots where everyone is free (or tentative counts as free when `lenient`).
export function freeSlots(schedules: ScheduleInformation[], slotCount: number, lenient = false): number[] {
  const parsed = schedules.map((s) => parseAvailabilityView(s.availabilityView ?? ""));
  const free: number[] = [];
  for (let i = 0; i < slotCount; i++) {
    const ok = parsed.every((a) => {
      const v = a[i] ?? "unknown";
      return v === "free" || (lenient && v === "tentative");
    });
    if (ok) free.push(i);
  }
  return free;
}
