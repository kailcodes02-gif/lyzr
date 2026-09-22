"use client";

import { ChevronDown, Ellipsis, Plus, TriangleAlert, UserPlus, Users } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { PeoplePicker, type Recipient } from "@/components/people-picker";
import { Button } from "@/components/ui/button";
import { Calendar as MiniMonth } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { calendarHex } from "@/lib/calendar/colors";
import { initials, PERSON_COLORS, type Colleague, type OtherCalendar } from "@/lib/calendar/overlay";
import type { ColleagueDetail } from "@/lib/calendar/people";
import { parseWall, DAY } from "@/lib/calendar/time";
import type { GraphCalendar } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

function Section({ title, children, action, defaultOpen = true }: { title: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1 py-1 text-left text-sm font-medium" aria-expanded={open}>
          <span className="flex-1">{title}</span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}

function Swatch({ on, hex, onToggle, label }: { on: boolean; hex: string; onToggle: () => void; label: string }) {
  return (
    <Checkbox
      checked={on}
      onCheckedChange={onToggle}
      aria-label={label}
      className="rounded-[4px] border-transparent data-checked:border-transparent"
      style={{ backgroundColor: on ? hex : "transparent", borderColor: hex, boxShadow: on ? undefined : `inset 0 0 0 2px ${hex}` }}
    />
  );
}

function CalendarRow({ cal, on, onToggle, secondary, warning, hex = calendarHex(cal), onRetry }: { cal: GraphCalendar; on: boolean; onToggle: () => void; secondary?: string; warning?: string; hex?: string; onRetry?: () => void }) {
  return (
    <li data-testid="calendar-row" data-failed={warning ? "true" : undefined}>
      <label className={cn("group flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-accent", !on && "text-muted-foreground")} title={warning}>
        <Swatch on={on} hex={hex} onToggle={onToggle} label={`Show ${cal.name}`} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">{cal.name}</span>
          {warning ? (
            <span className="flex items-center gap-1 text-[11px] text-destructive">
              <span className="truncate">Could not load</span>
              {onRetry && (
                <button
                  type="button"
                  className="shrink-0 text-primary hover:underline"
                  aria-label={`Retry ${cal.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onRetry();
                  }}
                >
                  Retry
                </button>
              )}
            </span>
          ) : (
            secondary && <span className="truncate text-[11px] text-muted-foreground">{secondary}</span>
          )}
        </span>
        {cal.allowedOnlineMeetingProviders?.includes("teamsForBusiness") && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Teams</span>}
      </label>
    </li>
  );
}

// What the row says under the name when nothing went wrong.
export function colleagueDetailText(detail: ColleagueDetail | undefined): { text: string; warning: boolean } | null {
  if (detail === "busy") return { text: "Busy/free only (calendar not shared with you)", warning: true };
  if (detail === "limited") return { text: "Limited details (titles, no descriptions)", warning: false };
  return null;
}

function ColleagueRow({
  person,
  error,
  detail,
  onToggle,
  onRemove,
  onColor,
  onOnly,
}: {
  person: Colleague;
  error?: string;
  detail?: ColleagueDetail;
  onToggle: () => void;
  onRemove: () => void;
  onColor: (hex: string) => void;
  onOnly: () => void;
}) {
  const on = !person.hidden;
  const note = colleagueDetailText(detail);
  return (
    <li data-testid="colleague-row" data-email={person.email} data-detail={detail}>
      <div className={cn("group flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-accent", !on && "text-muted-foreground")}>
        <Swatch on={on} hex={person.color} onToggle={onToggle} label={`Show ${person.name}`} />
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium text-white" style={{ background: person.color }} aria-hidden>
          {initials(person.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate" title={person.email}>
            {person.name}
          </span>
          {error ? (
            <span className="truncate text-[11px] text-destructive">{error}</span>
          ) : note ? (
            <span className={cn("truncate text-[11px]", note.warning ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} title={note.text}>
              {note.warning && <TriangleAlert className="mr-1 inline size-3 align-[-2px]" aria-label="Warning" />}
              {note.text}
            </span>
          ) : (
            person.name !== person.email && <span className="truncate text-[11px] text-muted-foreground">{person.email}</span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={`Options for ${person.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100" />}
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onOnly}>Only this calendar</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} variant="destructive">
              Remove
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Colour</DropdownMenuLabel>
            <div className="grid grid-cols-4 gap-1 px-2 pb-2">
              {PERSON_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => onColor(c)}
                  className={cn("size-5 rounded-full ring-offset-2 ring-offset-popover", c === person.color && "ring-2 ring-foreground/60")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function LeftPanel({
  date,
  onDate,
  weekStartsOn,
  calendars,
  otherCalendars = [],
  hidden,
  onToggle,
  colleagues = [],
  colleagueErrors,
  colleagueDetails,
  onAddColleague,
  onRemoveColleague,
  onToggleColleague,
  onColleagueColor,
  onOnlyColleague,
  onCreate,
  loading,
  createRef,
  open = false,
  onClose,
  failed,
  colorOf,
  onRetryCalendar,
}: {
  date: string;
  onDate: (d: string) => void;
  weekStartsOn: 0 | 1 | 6;
  calendars: GraphCalendar[];
  otherCalendars?: OtherCalendar[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  colleagues?: Colleague[];
  colleagueErrors?: Map<string, string>;
  // Email -> how much of the person's calendar we can see (see people.ts).
  colleagueDetails?: Map<string, ColleagueDetail>;
  onAddColleague?: (p: { email: string; name?: string }) => void;
  onRemoveColleague?: (email: string) => void;
  onToggleColleague?: (email: string) => void;
  onColleagueColor?: (email: string, hex: string) => void;
  onOnlyColleague?: (email: string) => void;
  onCreate: () => void;
  loading: boolean;
  createRef: React.RefObject<HTMLButtonElement | null>;
  // Below 900px the panel is hidden unless `open`, when it slides in as a drawer.
  open?: boolean;
  onClose?: () => void;
  // Calendar id -> error message for calendars whose events could not be loaded.
  failed?: Map<string, string>;
  // Resolved swatch colour per calendar (own calendars blue); falls back to the Outlook colour.
  colorOf?: (calendarId: string) => string;
  // Retry the range fetch (through the request queue) for a calendar that failed.
  onRetryCalendar?: () => void;
}) {
  const hexOf = (c: GraphCalendar) => (colorOf ? colorOf(c.id) : calendarHex(c));
  const selected = parseWall(date);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [picked, setPicked] = useState<Recipient[]>([]);
  // "Browse" lists every calendar somebody shared with me; picking one ticks it on.
  const browsable = otherCalendars;

  const subscribe = () => {
    for (const r of picked) onAddColleague?.({ email: r.email, name: r.name });
    setPicked([]);
    setSubscribeOpen(false);
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/20 min-[901px]:hidden" onClick={onClose} aria-hidden />}
      <aside
        data-testid="calendar-left-panel"
        className={cn(
          "flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-background px-3 py-3",
          open ? "max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:left-0 max-[900px]:z-30 max-[900px]:shadow-xl" : "max-[900px]:hidden",
        )}
      >
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
        formatters={{ formatWeekdayName: (d) => format(d, "EEEEE") }}
        className="w-[232px] p-0 [--cell-size:32px]"
        classNames={{
          caption_label: "text-sm font-medium",
          weekdays: "justify-between",
          weekday: "text-[11px] font-medium text-muted-foreground",
          week: "mt-1 justify-between",
          day: "rounded-full",
          day_button:
            "rounded-full text-[11px] hover:bg-accent data-[selected-single=true]:bg-transparent data-[selected-single=true]:text-primary data-[selected-single=true]:ring-1 data-[selected-single=true]:ring-primary data-[selected-single=true]:ring-inset group-data-[today=true]/day:bg-primary group-data-[today=true]/day:text-primary-foreground group-data-[today=true]/day:hover:bg-primary",
          today: "bg-transparent",
          outside: "text-muted-foreground/60",
        }}
      />
      <Section title="My calendars">
        {loading && (
          <ul className="flex flex-col gap-2 px-1 py-1">
            {[0, 1].map((i) => (
              <li key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </ul>
        )}
        <ul className="flex flex-col">
          {calendars.map((c) => (
            <CalendarRow key={c.id} cal={c} on={!hidden.has(c.id)} onToggle={() => onToggle(c.id)} warning={failed?.get(c.id)} hex={hexOf(c)} onRetry={onRetryCalendar} />
          ))}
        </ul>
      </Section>
      <Section
        title="Other calendars"
        action={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Add other calendars" />}>
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => setSubscribeOpen(true)}>
                <UserPlus />
                Subscribe to a colleague
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Base UI requires a group label to live inside a Menu.Group. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs">Browse calendars shared with me</DropdownMenuLabel>
                {browsable.length === 0 && <div className="px-2 pb-1.5 text-xs text-muted-foreground">Nobody has shared a calendar with you yet.</div>}
                {browsable.map((o) => (
                  <DropdownMenuItem key={o.cal.id} onClick={() => hidden.has(o.cal.id) && onToggle(o.cal.id)}>
                    <span className="size-3 rounded-sm" style={{ background: hexOf(o.cal) }} />
                    <span className="truncate">{o.cal.name}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{o.ownerName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <ul className="flex flex-col">
          {otherCalendars.map((o) => (
              <CalendarRow key={o.cal.id} cal={o.cal} on={!hidden.has(o.cal.id)} onToggle={() => onToggle(o.cal.id)} secondary={[o.groupName, o.ownerName].filter(Boolean).join(" · ")} warning={failed?.get(o.cal.id)} hex={hexOf(o.cal)} onRetry={onRetryCalendar} />
            ))}
          {colleagues.map((p) => (
            <ColleagueRow
              key={p.email}
              person={p}
              error={colleagueErrors?.get(p.email.toLowerCase())}
              detail={colleagueDetails?.get(p.email.toLowerCase())}
              onToggle={() => onToggleColleague?.(p.email)}
              onRemove={() => onRemoveColleague?.(p.email)}
              onColor={(hex) => onColleagueColor?.(p.email, hex)}
              onOnly={() => onOnlyColleague?.(p.email)}
            />
          ))}
          {otherCalendars.length === 0 && colleagues.length === 0 && (
            <li className="px-1 py-1 text-xs text-muted-foreground">
              <Users className="mr-1 inline size-3.5 align-[-2px]" />
              Add a colleague to see their calendar next to yours.
            </li>
          )}
        </ul>
      </Section>

      <Dialog
        open={subscribeOpen}
        onOpenChange={(o) => {
          setSubscribeOpen(o);
          if (!o) setPicked([]);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Subscribe to a colleague</DialogTitle>
            <DialogDescription>
              Their calendar shows on your grid in their own colour. You see what this person shares with you: titles and details if they shared their calendar with you, otherwise
              busy/free blocks only.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              subscribe();
            }}
          >
            <PeoplePicker value={picked} onChange={setPicked} placeholder="Add people" autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSubscribeOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={picked.length === 0} className="rounded-full px-5">
                Add
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      </aside>
    </>
  );
}
