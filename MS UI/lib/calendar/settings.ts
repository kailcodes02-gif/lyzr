"use client";

import { defaultTimeZone } from "./time";

export type CalendarSettings = {
  timeZone: string | null; // null = browser default
  weekStartsOn: 0 | 1 | 6;
  defaultDuration: 15 | 30 | 45 | 60 | 90 | 120;
  defaultReminder: number | null; // minutes
};

const KEY = "msui.cal.settings";
const VISIBLE_KEY = "msui.cal.visible";

export const DEFAULT_SETTINGS: CalendarSettings = { timeZone: null, weekStartsOn: 0, defaultDuration: 30, defaultReminder: 15 };

export function loadSettings(): CalendarSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<CalendarSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: CalendarSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked
  }
}

export function effectiveTimeZone(s: CalendarSettings): string {
  return s.timeZone || defaultTimeZone();
}

// Hidden calendar ids (Graph has no "visible" flag). Stored as hidden so new calendars show by default.
export function loadHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VISIBLE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function saveHidden(hidden: Set<string>) {
  try {
    localStorage.setItem(VISIBLE_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    // storage blocked
  }
}
