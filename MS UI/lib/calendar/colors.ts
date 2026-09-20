import type { CalendarColor, GraphCalendar } from "./types";

// Outlook's calendar colour enum, mapped to a Google-ish palette. Only a
// fallback now: calendars the user owns render blue and every other calendar
// or colleague gets a palette colour (see assignColors / mineColor).
export const COLOR_HEX: Record<CalendarColor, string> = {
  auto: "#1a73e8",
  lightBlue: "#4285f4",
  lightGreen: "#33b679",
  lightOrange: "#f4511e",
  lightGray: "#616161",
  lightYellow: "#f6bf26",
  lightTeal: "#039be5",
  lightPink: "#e67c73",
  lightBrown: "#795548",
  lightRed: "#d50000",
  maxColor: "#8e24aa",
};

export function calendarHex(cal: Pick<GraphCalendar, "color" | "hexColor"> | undefined): string {
  if (!cal) return COLOR_HEX.auto;
  if (cal.hexColor && /^#[0-9a-f]{6}$/i.test(cal.hexColor)) return cal.hexColor;
  return COLOR_HEX[cal.color ?? "auto"] ?? COLOR_HEX.auto;
}

// My own calendars: Google blue, two close shades when there are several.
export const MINE_BLUES = ["#1a73e8", "#4285f4"];
// Dark mode: a light blue chip with dark text.
export const MINE_BLUES_DARK = ["#a8c7fa", "#8ab4f8"];

export function mineColor(index: number, dark = false): string {
  const list = dark ? MINE_BLUES_DARK : MINE_BLUES;
  return list[Math.max(0, index) % list.length];
}

// Everyone else (shared calendars, group calendars, colleague overlays): a
// Google-like palette with nothing close to the owner's blue (peacock is out).
export const OTHER_PALETTE = [
  "#d50000", // tomato
  "#f4511e", // tangerine
  "#f6bf26", // banana
  "#0b8043", // basil
  "#33b679", // sage
  "#8e24aa", // grape
  "#e67c73", // flamingo
  "#616161", // graphite
];

export const isPaletteColor = (hex: string) => OTHER_PALETTE.includes(hex.toLowerCase());

// The first palette colour nobody uses yet; when all are taken, the least used one.
export function pickColor(taken: string[]): string {
  const counts = new Map(OTHER_PALETTE.map((c) => [c, 0]));
  for (const t of taken) {
    const k = t.toLowerCase();
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = OTHER_PALETTE[0];
  let min = Infinity;
  for (const c of OTHER_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < min) {
      min = n;
      best = c;
    }
  }
  return best;
}

// Colours assigned to other calendars, by calendar id. Persisted so a
// calendar keeps its colour across sessions; new ids get the next free colour
// in order of appearance.
export type AssignedColors = Record<string, string>;

export function assignColors(assigned: AssignedColors, ids: string[], alsoTaken: string[] = []): AssignedColors {
  const missing = ids.filter((id) => !isPaletteColor(assigned[id] ?? ""));
  if (!missing.length) return assigned;
  const next: AssignedColors = { ...assigned };
  const taken = [...ids.map((id) => next[id]).filter((c): c is string => !!c && isPaletteColor(c)), ...alsoTaken];
  for (const id of missing) {
    const c = pickColor(taken);
    next[id] = c;
    taken.push(c);
  }
  return next;
}

const COLORS_KEY = "msui.cal.colors";

export function loadAssignedColors(): AssignedColors {
  try {
    const raw = JSON.parse(localStorage.getItem(COLORS_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: AssignedColors = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && isPaletteColor(v)) out[k] = v.toLowerCase();
    return out;
  } catch {
    return {};
  }
}

export function saveAssignedColors(map: AssignedColors) {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(map));
  } catch {
    // storage blocked
  }
}

// Black or white text for a given background.
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#202124" : "#ffffff";
}
