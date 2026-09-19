import type { CalendarColor, GraphCalendar } from "./types";

// Outlook's calendar colour enum, mapped to a Google-ish palette.
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

// Black or white text for a given background.
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#202124" : "#ffffff";
}
