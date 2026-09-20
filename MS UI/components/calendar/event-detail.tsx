"use client";

import { AlignLeft, Check, CircleHelp, Clock, ExternalLink, Lock, MapPin, Pencil, Repeat, Trash2, Users, Video, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { calendarHex } from "@/lib/calendar/colors";
import type { WallEvent } from "@/lib/calendar/events";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import { formatTimeRange } from "@/lib/calendar/time";
import type { GraphCalendar, ResponseType } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { AnchoredPopover, type Anchor } from "./anchored-popover";

export type SeriesScope = "this" | "all";

function ResponseIcon({ r }: { r?: ResponseType }) {
  if (r === "accepted" || r === "organizer") return <Check className="size-3.5 text-success" />;
  if (r === "declined") return <X className="size-3.5 text-destructive" />;
  if (r === "tentativelyAccepted") return <CircleHelp className="size-3.5 text-muted-foreground" />;
  return <span className="inline-block size-3.5 rounded-full border border-border" />;
}

export function EventDetail({
  ev,
  anchor,
  calendar,
  color,
  person,
  onClose,
  onEdit,
  onDelete,
  onRsvp,
  tz,
}: {
  ev: WallEvent | null;
  anchor: Anchor;
  calendar?: GraphCalendar;
  // Resolved chip colour (blue for the user's own calendars).
  color?: string;
  // Set for a colleague's overlay event: read-only, shows who and their status.
  person?: { name: string; email: string; color: string };
  onClose: () => void;
  onEdit: (scope: SeriesScope) => void;
  onDelete: (scope: SeriesScope) => void;
  onRsvp: (action: "accept" | "tentativelyAccept" | "decline") => void;
  tz: string;
}) {
  const [ask, setAsk] = useState<null | "edit" | "delete">(null);
  const isSeries = !!ev?.seriesMasterId && (ev.type === "occurrence" || ev.type === "exception");
  const mine = ev?.isOrganizer ?? ev?.responseStatus?.response === "organizer";
  const canEdit = !person && (calendar?.canEdit ?? true);
  const response = ev?.responseStatus?.response;
  const act = (kind: "edit" | "delete") => {
    if (isSeries) setAsk(kind);
    else if (kind === "edit") onEdit("this");
    else onDelete("this");
  };
  const choose = (scope: SeriesScope) => {
    const k = ask;
    setAsk(null);
    if (k === "edit") onEdit(scope);
    else if (k === "delete") onDelete(scope);
  };
  const hex = person?.color ?? color ?? calendarHex(calendar);
  const statusText = (s: string) => (s === "oof" ? "Out of office" : s === "workingElsewhere" ? "Working elsewhere" : s.charAt(0).toUpperCase() + s.slice(1));
  return (
    <AnchoredPopover
      open={!!ev}
      onOpenChange={(o) => {
        if (!o) {
          setAsk(null);
          onClose();
        }
      }}
      anchor={anchor}
      side="left"
    >
      {ev && (
        <div className="flex flex-col gap-3 p-4" data-testid="event-detail">
          <div className="-mt-1 -mr-2 flex items-center justify-end gap-0.5">
            {canEdit && !ev.isCancelled && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => act("edit")}>
                <Pencil />
              </Button>
            )}
            {canEdit && (
              <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => act("delete")}>
                <Trash2 />
              </Button>
            )}
            {ev.webLink && (
              <Button variant="ghost" size="icon-sm" aria-label="Open in Outlook" render={<a href={ev.webLink} target="_blank" rel="noreferrer" />}>
                <ExternalLink />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
          {ask && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-2 font-medium">{ask === "edit" ? "Edit recurring event" : "Delete recurring event"}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => choose("this")}>
                  This event
                </Button>
                <Button size="sm" variant="outline" onClick={() => choose("all")}>
                  All events
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-[1.5rem_1fr] items-start gap-x-3 gap-y-2">
            <span className="mt-1.5 size-3.5 rounded-sm" style={{ background: hex }} />
            <div>
              <h2 className={cn("text-xl leading-tight", ev.isCancelled && "line-through opacity-70")}>
                {ev.sensitivity === "private" && <Lock className="mr-1 inline size-4 align-[-2px]" />}
                {ev.subject || "(No title)"}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatTimeRange(ev.startWall, ev.endWall, !!ev.isAllDay)}
                {!ev.isAllDay && <span className="ml-1 text-xs">({tz})</span>}
              </p>
              {ev.isCancelled && <p className="text-xs text-destructive">This event was cancelled</p>}
            </div>
            {person && (
              <>
                <Users className="mt-0.5 size-4 text-muted-foreground" />
                <div className="text-sm" data-testid="colleague-detail">
                  <p>
                    {person.name} <span className="text-xs text-muted-foreground">({person.email})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {statusText(ev.showAs ?? "busy")} · read-only, from {person.name.split(" ")[0]}&apos;s calendar
                  </p>
                </div>
              </>
            )}
            {ev.seriesMasterId && (
              <>
                <Repeat className="mt-0.5 size-4 text-muted-foreground" />
                <p className="text-sm">{ev.recurrence ? describeRecurrence(ev.recurrence) : "Part of a series"}</p>
              </>
            )}
            {ev.isOnlineMeeting && ev.onlineMeeting?.joinUrl && (
              <>
                <Video className="mt-1 size-4 text-muted-foreground" />
                <div>
                  <Button size="sm" className="rounded-full" render={<a href={ev.onlineMeeting.joinUrl} target="_blank" rel="noreferrer" />}>
                    Join Teams meeting
                  </Button>
                </div>
              </>
            )}
            {ev.location?.displayName && (
              <>
                <MapPin className="mt-0.5 size-4 text-muted-foreground" />
                <p className="text-sm">{ev.location.displayName}</p>
              </>
            )}
            {!person && (ev.attendees?.length ?? 0) > 0 && (
              <>
                <Users className="mt-0.5 size-4 text-muted-foreground" />
                <div className="text-sm">
                  <p className="text-muted-foreground">{ev.attendees!.length} guests</p>
                  <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-auto">
                    {ev.organizer && (
                      <li className="flex items-center gap-2">
                        <ResponseIcon r="organizer" />
                        <span className="truncate">{ev.organizer.emailAddress.name || ev.organizer.emailAddress.address}</span>
                        <span className="text-xs text-muted-foreground">Organizer</span>
                      </li>
                    )}
                    {ev.attendees!
                      .filter((a) => a.emailAddress.address !== ev.organizer?.emailAddress.address)
                      .map((a) => (
                        <li key={a.emailAddress.address} className="flex items-center gap-2" title={a.emailAddress.address}>
                          <ResponseIcon r={a.status?.response} />
                          <span className="truncate">{a.emailAddress.name || a.emailAddress.address}</span>
                          {a.type === "optional" && <span className="text-xs text-muted-foreground">Optional</span>}
                        </li>
                      ))}
                  </ul>
                </div>
              </>
            )}
            {ev.bodyPreview && (
              <>
                <AlignLeft className="mt-0.5 size-4 text-muted-foreground" />
                <p className="line-clamp-6 text-sm whitespace-pre-wrap">{ev.bodyPreview}</p>
              </>
            )}
            {!person && ev.showAs && ev.showAs !== "busy" && (
              <>
                <Clock className="mt-0.5 size-4 text-muted-foreground" />
                <p className="text-sm capitalize">{ev.showAs === "oof" ? "Out of office" : ev.showAs.replace(/([A-Z])/g, " $1").toLowerCase()}</p>
              </>
            )}
          </div>
          {!person && !mine && !ev.isCancelled && (ev.attendees?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Going?</span>
              {(
                [
                  ["accept", "Yes", "accepted"],
                  ["decline", "No", "declined"],
                  ["tentativelyAccept", "Maybe", "tentativelyAccepted"],
                ] as const
              ).map(([action, label, state]) => (
                <Button key={action} size="sm" variant={response === state ? "default" : "outline"} className="rounded-full" onClick={() => onRsvp(action)}>
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </AnchoredPopover>
  );
}
