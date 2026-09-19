"use client";

import { Plus } from "lucide-react";
import { format } from "date-fns";
import { Calendar as MiniMonth } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { calendarHex } from "@/lib/calendar/colors";
import { parseWall, DAY } from "@/lib/calendar/time";
import type { GraphCalendar } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

export function LeftPanel({
  date,
  onDate,
  weekStartsOn,
  calendars,
  hidden,
  onToggle,
  onCreate,
  loading,
  createRef,
}: {
  date: string;
  onDate: (d: string) => void;
  weekStartsOn: 0 | 1 | 6;
  calendars: GraphCalendar[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  onCreate: () => void;
  loading: boolean;
  createRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const selected = parseWall(date);
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-background px-3 py-3 max-[900px]:hidden">
      <button
        ref={createRef}
        type="button"
        onClick={onCreate}
        className="flex h-12 w-fit items-center gap-3 rounded-2xl bg-card pr-5 pl-4 text-sm font-medium shadow-md ring-1 ring-foreground/10 transition hover:shadow-lg hover:bg-accent"
      >
        <Plus className="size-6 text-primary" />
        Create
      </button>
      <MiniMonth
        mode="single"
        selected={selected}
        month={selected}
        onMonthChange={(m) => onDate(format(m, DAY))}
        onSelect={(d) => d && onDate(format(d, DAY))}
        weekStartsOn={weekStartsOn}
        className="p-0 [--cell-size:--spacing(7)]"
        classNames={{ caption_label: "text-sm font-medium", weekday: "text-[0.7rem] text-muted-foreground" }}
      />
      <div>
        <h2 className="mb-1 px-1 text-sm font-medium">My calendars</h2>
        {loading && (
          <ul className="flex flex-col gap-2 px-1 py-1">
            {[0, 1].map((i) => (
              <li key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </ul>
        )}
        <ul className="flex flex-col">
          {calendars.map((c) => {
            const hex = calendarHex(c);
            const on = !hidden.has(c.id);
            return (
              <li key={c.id}>
                <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-accent", !on && "text-muted-foreground")}>
                  <Checkbox
                    checked={on}
                    onCheckedChange={() => onToggle(c.id)}
                    className="rounded-[4px] border-transparent data-checked:border-transparent"
                    style={{ backgroundColor: on ? hex : "transparent", borderColor: hex }}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.allowedOnlineMeetingProviders?.includes("teamsForBusiness") && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Teams</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
