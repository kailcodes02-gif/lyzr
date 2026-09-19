import { addDays, format, getDate, getDay, getMonth } from "date-fns";
import { parseWall, DAY } from "./time";
import type { DayOfWeek, PatternedRecurrence, RecurrencePattern, RecurrenceRange } from "./types";

// UI model for the recurrence editor (Google Calendar's "Custom recurrence").
export type RepeatPreset = "none" | "daily" | "weekly" | "monthly" | "yearly" | "weekdays" | "custom";
export type RecurrenceForm = {
  preset: RepeatPreset;
  interval: number;
  unit: "day" | "week" | "month" | "year";
  weekdays: DayOfWeek[];
  monthlyMode: "day" | "weekday";
  ends: "never" | "on" | "after";
  endDate: string; // YYYY-MM-DD
  count: number;
};

export const DAYS: DayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const DAY_SHORT: Record<DayOfWeek, string> = {
  sunday: "S",
  monday: "M",
  tuesday: "T",
  wednesday: "W",
  thursday: "T",
  friday: "F",
  saturday: "S",
};
const DAY_LABEL: Record<DayOfWeek, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};
const INDEX: Record<number, "first" | "second" | "third" | "fourth" | "last"> = { 0: "first", 1: "second", 2: "third", 3: "fourth", 4: "last" };

export function weekdayOf(dateStr: string): DayOfWeek {
  return DAYS[getDay(parseWall(dateStr))];
}

export function defaultForm(startDate: string): RecurrenceForm {
  return {
    preset: "none",
    interval: 1,
    unit: "week",
    weekdays: [weekdayOf(startDate)],
    monthlyMode: "day",
    ends: "never",
    endDate: format(addDays(parseWall(startDate), 90), DAY),
    count: 10,
  };
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Labels for the quick "Repeat" select, computed from the start date.
export function presetLabels(startDate: string): { value: RepeatPreset; label: string }[] {
  const d = parseWall(startDate);
  const wd = DAY_LABEL[weekdayOf(startDate)];
  const idx = Math.floor((getDate(d) - 1) / 7);
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: `Weekly on ${wd}` },
    { value: "monthly", label: `Monthly on the ${INDEX[Math.min(idx, 4)]} ${wd}` },
    { value: "yearly", label: `Annually on ${format(d, "MMMM d")}` },
    { value: "weekdays", label: "Every weekday (Monday to Friday)" },
    { value: "custom", label: "Custom" },
  ];
}

const WEEKDAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

// Form -> Graph recurrence. Returns null for "Does not repeat".
export function toGraphRecurrence(form: RecurrenceForm, startDate: string, tz: string): PatternedRecurrence | null {
  if (form.preset === "none") return null;
  const d = parseWall(startDate);
  const range: RecurrenceRange = { type: "noEnd", startDate: startDate.slice(0, 10), recurrenceTimeZone: tz };
  if (form.ends === "on") {
    range.type = "endDate";
    range.endDate = form.endDate;
  } else if (form.ends === "after") {
    range.type = "numbered";
    range.numberOfOccurrences = Math.max(1, form.count);
  }
  let pattern: RecurrencePattern;
  const idx = INDEX[Math.min(Math.floor((getDate(d) - 1) / 7), 4)];
  switch (form.preset) {
    case "daily":
      pattern = { type: "daily", interval: 1 };
      break;
    case "weekly":
      pattern = { type: "weekly", interval: 1, daysOfWeek: [weekdayOf(startDate)], firstDayOfWeek: "sunday" };
      break;
    case "monthly":
      pattern = { type: "relativeMonthly", interval: 1, daysOfWeek: [weekdayOf(startDate)], index: idx };
      break;
    case "yearly":
      pattern = { type: "absoluteYearly", interval: 1, dayOfMonth: getDate(d), month: getMonth(d) + 1 };
      break;
    case "weekdays":
      pattern = { type: "weekly", interval: 1, daysOfWeek: WEEKDAYS, firstDayOfWeek: "sunday" };
      break;
    case "custom":
    default: {
      const interval = Math.max(1, form.interval);
      if (form.unit === "day") pattern = { type: "daily", interval };
      else if (form.unit === "week") pattern = { type: "weekly", interval, daysOfWeek: form.weekdays.length ? form.weekdays : [weekdayOf(startDate)], firstDayOfWeek: "sunday" };
      else if (form.unit === "month")
        pattern =
          form.monthlyMode === "weekday"
            ? { type: "relativeMonthly", interval, daysOfWeek: [weekdayOf(startDate)], index: idx }
            : { type: "absoluteMonthly", interval, dayOfMonth: getDate(d) };
      else pattern = { type: "absoluteYearly", interval, dayOfMonth: getDate(d), month: getMonth(d) + 1 };
    }
  }
  return { pattern, range };
}

// Graph recurrence -> form (for editing an existing series).
export function fromGraphRecurrence(rec: PatternedRecurrence | null | undefined, startDate: string): RecurrenceForm {
  const form = defaultForm(startDate);
  if (!rec) return form;
  const { pattern, range } = rec;
  form.interval = pattern.interval || 1;
  if (range.type === "endDate" && range.endDate) {
    form.ends = "on";
    form.endDate = range.endDate;
  } else if (range.type === "numbered") {
    form.ends = "after";
    form.count = range.numberOfOccurrences ?? 1;
  }
  const days = pattern.daysOfWeek ?? [];
  const simple = form.interval === 1 && form.ends === "never";
  switch (pattern.type) {
    case "daily":
      form.unit = "day";
      form.preset = simple ? "daily" : "custom";
      break;
    case "weekly":
      form.unit = "week";
      form.weekdays = days.length ? days : [weekdayOf(startDate)];
      if (simple && days.length === 5 && WEEKDAYS.every((w) => days.includes(w))) form.preset = "weekdays";
      else if (simple && days.length === 1 && days[0] === weekdayOf(startDate)) form.preset = "weekly";
      else form.preset = "custom";
      break;
    case "absoluteMonthly":
      form.unit = "month";
      form.monthlyMode = "day";
      form.preset = "custom";
      break;
    case "relativeMonthly":
      form.unit = "month";
      form.monthlyMode = "weekday";
      form.preset = simple ? "monthly" : "custom";
      break;
    case "absoluteYearly":
    case "relativeYearly":
      form.unit = "year";
      form.preset = simple ? "yearly" : "custom";
      break;
  }
  return form;
}

export function describeRecurrence(rec: PatternedRecurrence | null | undefined): string {
  if (!rec) return "Does not repeat";
  const { pattern, range } = rec;
  const n = pattern.interval || 1;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  let s = "";
  switch (pattern.type) {
    case "daily":
      s = n === 1 ? "Daily" : every("day");
      break;
    case "weekly":
      s = `${n === 1 ? "Weekly" : every("week")} on ${(pattern.daysOfWeek ?? []).map((d) => DAY_LABEL[d]).join(", ")}`;
      break;
    case "absoluteMonthly":
      s = `${n === 1 ? "Monthly" : every("month")} on day ${pattern.dayOfMonth}`;
      break;
    case "relativeMonthly":
      s = `${n === 1 ? "Monthly" : every("month")} on the ${pattern.index} ${(pattern.daysOfWeek ?? []).map((d) => DAY_LABEL[d]).join(", ")}`;
      break;
    default:
      s = n === 1 ? "Annually" : every("year");
  }
  if (range.type === "endDate" && range.endDate) s += `, until ${format(parseWall(range.endDate), "MMM d, yyyy")}`;
  if (range.type === "numbered") s += `, ${range.numberOfOccurrences} times`;
  return s;
}

export { ordinal };
