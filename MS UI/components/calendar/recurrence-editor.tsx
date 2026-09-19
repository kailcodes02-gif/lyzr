"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DAYS, DAY_SHORT, presetLabels, type RecurrenceForm } from "@/lib/calendar/recurrence";
import type { DayOfWeek } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

export function RecurrenceEditor({ value, onChange, startDate }: { value: RecurrenceForm; onChange: (f: RecurrenceForm) => void; startDate: string }) {
  const presets = presetLabels(startDate);
  const set = (p: Partial<RecurrenceForm>) => onChange({ ...value, ...p });
  const toggleDay = (d: DayOfWeek) => {
    const has = value.weekdays.includes(d);
    const next = has ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d];
    set({ weekdays: next.length ? next : value.weekdays });
  };
  return (
    <div className="flex flex-col gap-2">
      <Select value={value.preset} onValueChange={(v) => v && set({ preset: v as RecurrenceForm["preset"] })}>
        <SelectTrigger className="w-full" aria-label="Repeat">
          <SelectValue>{presets.find((p) => p.value === value.preset)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.preset === "custom" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">Repeat every</span>
            <Input type="number" min={1} max={99} value={value.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} className="w-16" aria-label="Interval" />
            <Select value={value.unit} onValueChange={(v) => v && set({ unit: v as RecurrenceForm["unit"] })}>
              <SelectTrigger aria-label="Unit">
                <SelectValue>{value.unit}{value.interval > 1 ? "s" : ""}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["day", "week", "month", "year"] as const).map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                    {value.interval > 1 ? "s" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {value.unit === "week" && (
            <div className="flex items-center gap-1">
              <span className="mr-1 text-sm">Repeat on</span>
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-label={d}
                  aria-pressed={value.weekdays.includes(d)}
                  onClick={() => toggleDay(d)}
                  className={cn("size-7 rounded-full text-xs", value.weekdays.includes(d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}
                >
                  {DAY_SHORT[d]}
                </button>
              ))}
            </div>
          )}
          {value.unit === "month" && (
            <Select value={value.monthlyMode} onValueChange={(v) => v && set({ monthlyMode: v as "day" | "weekday" })}>
              <SelectTrigger className="w-full" aria-label="Monthly mode">
                <SelectValue>{value.monthlyMode === "day" ? "Monthly on the same day" : "Monthly on the same weekday"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Monthly on the same day</SelectItem>
                <SelectItem value="weekday">Monthly on the same weekday</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="flex flex-col gap-2">
            <Label>Ends</Label>
            {(["never", "on", "after"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input type="radio" name="ends" checked={value.ends === mode} onChange={() => set({ ends: mode })} />
                <span className="w-12 capitalize">{mode}</span>
                {mode === "on" && <Input type="date" value={value.endDate} disabled={value.ends !== "on"} onChange={(e) => set({ endDate: e.target.value })} className="w-40" aria-label="End date" />}
                {mode === "after" && (
                  <>
                    <Input type="number" min={1} value={value.count} disabled={value.ends !== "after"} onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })} className="w-20" aria-label="Occurrences" />
                    <span className="text-muted-foreground">occurrences</span>
                  </>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
