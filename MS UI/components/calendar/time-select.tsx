"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addMinutesWall } from "@/lib/calendar/time";

// Google-Calendar-style time pickers: a start-time list in 15-minute steps
// ("8:00pm") and an end-time list that names the duration of each option
// ("9:00pm (1 hr)"). Values are wall datetimes ("YYYY-MM-DDTHH:MM").

export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} mins`;
  const h = minutes / 60;
  const whole = Number.isInteger(h) ? String(h) : String(h).replace(/(\.\d\d).*$/, "$1");
  return `${whole} ${h === 1 ? "hr" : "hrs"}`;
}

const timeOf = (wall: string) => wall.slice(11, 16);
const dateOf = (wall: string) => wall.slice(0, 10);

// Every 15 minutes, plus the current value when it is off-grid.
function startOptions(value: string): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  if (!out.includes(value)) out.push(value);
  return out.sort();
}

export function TimeSelect({ value, onChange, label }: { value: string; onChange: (wall: string) => void; label: string }) {
  const t = timeOf(value);
  return (
    <Select value={t} onValueChange={(v) => v && onChange(`${dateOf(value)}T${v}`)}>
      <SelectTrigger size="sm" aria-label={label} className="tabular-nums">
        <SelectValue>{fmt12(t)}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {startOptions(t).map((o) => (
          <SelectItem key={o} value={o}>
            {fmt12(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// End options stay on the start's day: +15 min steps until midnight, capped
// at 12 hours out. Anything longer (multi-day) is edited in More options.
export function endOptions(startWall: string): { wall: string; minutes: number }[] {
  const out: { wall: string; minutes: number }[] = [];
  for (let m = 15; m <= 12 * 60; m += 15) {
    const wall = addMinutesWall(`${startWall}:00`, m).slice(0, 16);
    if (dateOf(wall) !== dateOf(startWall)) break;
    out.push({ wall, minutes: m });
  }
  return out;
}

export function EndTimeSelect({ start, value, onChange }: { start: string; value: string; onChange: (wall: string) => void }) {
  const options = endOptions(start);
  const current = options.find((o) => o.wall === value);
  const minutes = Math.round((Date.parse(value) - Date.parse(start)) / 60_000);
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" aria-label="End time" className="tabular-nums">
        <SelectValue>{fmt12(timeOf(value))}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {!current && (
          <SelectItem value={value}>
            {fmt12(timeOf(value))}{minutes > 0 ? ` (${durationLabel(minutes)})` : ""}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.wall} value={o.wall}>
            {fmt12(timeOf(o.wall))} ({durationLabel(o.minutes)})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
