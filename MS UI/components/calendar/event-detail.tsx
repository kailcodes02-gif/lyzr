"use client";

import { PreviewCard } from "@base-ui/react/preview-card";
import { AlignLeft, Bell, CalendarDays, CalendarPlus, Check, ChevronDown, ChevronUp, Copy, ExternalLink, Lock, Mail, MapPin, MessageSquare, Pencil, Phone, Trash2, Users, Video, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { calendarHex } from "@/lib/calendar/colors";
import { bodyToText } from "@/lib/calendar/edit";
import type { WallEvent } from "@/lib/calendar/events";
import { initials } from "@/lib/calendar/overlay";
import { avatarColor, usePersonPhoto } from "@/lib/calendar/photos";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import { detailWhen } from "@/lib/calendar/time";
import type { GraphCalendar, GraphEvent, ResponseType } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";
import { AnchoredPopover, type Anchor } from "./anchored-popover";

export type SeriesScope = "this" | "all";

type Guest = { email: string; name: string; response?: ResponseType; organizer?: boolean; optional?: boolean };

const teamsChat = (emails: string[], topic?: string) =>
  `https://teams.microsoft.com/l/chat/0/0?users=${emails.map(encodeURIComponent).join(",")}${topic ? `&topicName=${encodeURIComponent(topic)}` : ""}`;
const teamsCall = (email: string) => `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(email)}`;
const mailto = (emails: string[], subject?: string) => `mailto:${emails.join(",")}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`),
  );
}

// Google's RSVP badge on the avatar: green tick, red cross, grey "?"; nothing while awaiting.
function ResponseBadge({ r }: { r?: ResponseType }) {
  if (r === "accepted" || r === "organizer")
    return (
      <AvatarBadge className="size-3.5! bg-[#188038] text-white" aria-label="Accepted">
        <Check className="size-2.5! stroke-[3]" />
      </AvatarBadge>
    );
  if (r === "declined")
    return (
      <AvatarBadge className="size-3.5! bg-[#d93025] text-white" aria-label="Declined">
        <X className="size-2.5! stroke-[3]" />
      </AvatarBadge>
    );
  if (r === "tentativelyAccepted")
    return (
      <AvatarBadge className="size-3.5! bg-[#5f6368] text-[9px] font-bold text-white" aria-label="Maybe">
        ?
      </AvatarBadge>
    );
  return null;
}

function PersonAvatar({ email, name, size, response }: { email: string; name: string; size: "sm" | "lg"; response?: ResponseType }) {
  const photo = usePersonPhoto(email, size === "lg" ? 96 : 48);
  return (
    <Avatar className={size === "lg" ? "size-22" : "size-7"}>
      {photo.data && <AvatarImage src={photo.data} alt="" />}
      <AvatarFallback className={cn("font-medium text-white", size === "lg" ? "text-4xl" : "text-xs")} style={{ background: avatarColor(email) }}>
        {initials(name)}
      </AvatarFallback>
      {size === "sm" && <ResponseBadge r={response} />}
    </Avatar>
  );
}

// Google's hover card on a guest: photo, name, address, and quick actions
// (Teams chat, email, Teams call, show their calendar on the grid).
function PersonCard({ guest, subscribed, onViewCalendar }: { guest: Guest; subscribed: boolean; onViewCalendar?: (p: { email: string; name: string }) => void }) {
  const showCalendar = onViewCalendar && !subscribed ? () => onViewCalendar({ email: guest.email, name: guest.name }) : undefined;
  return (
    <div className="w-[22rem] p-5" data-testid="person-card">
      <div className="flex items-start gap-4">
        <PersonAvatar email={guest.email} name={guest.name} size="lg" />
        <div className="min-w-0 flex-1 pt-3">
          <p className="truncate text-xl leading-tight">{guest.name}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{guest.email}</p>
        </div>
        {showCalendar && (
          <Button variant="ghost" size="icon-sm" aria-label="Show their calendar" title="Show their calendar" onClick={showCalendar}>
            <CalendarPlus />
          </Button>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button className="h-10 flex-1 rounded-full bg-[#c2e7ff] text-[#001d35] hover:bg-[#b3dcf5] dark:bg-[#004a77] dark:text-[#c2e7ff]" render={<a href={teamsChat([guest.email])} target="_blank" rel="noreferrer" />}>
          <MessageSquare className="size-4" /> Message
        </Button>
        <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label="Send email" render={<a href={mailto([guest.email])} />}>
          <Mail />
        </Button>
        <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label="Teams call" render={<a href={teamsCall(guest.email)} target="_blank" rel="noreferrer" />}>
          <Video />
        </Button>
        <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label={subscribed ? "Calendar already shown" : "Show their calendar"} disabled={!showCalendar} onClick={showCalendar}>
          <CalendarDays />
        </Button>
      </div>
    </div>
  );
}

function GuestRow({ guest, subscribed, onViewCalendar }: { guest: Guest; subscribed: boolean; onViewCalendar?: (p: { email: string; name: string }) => void }) {
  return (
    <li>
      <PreviewCard.Root>
        <PreviewCard.Trigger delay={350} closeDelay={150} render={<div className="flex cursor-default items-center gap-3 rounded-md py-1" title={guest.email} />}>
          <PersonAvatar email={guest.email} name={guest.name} size="sm" response={guest.response} />
          <div className="min-w-0 leading-tight">
            <p className="truncate">{guest.name}</p>
            {(guest.organizer || guest.optional) && <p className="text-xs text-muted-foreground">{guest.organizer ? "Organizer" : "Optional"}</p>}
          </div>
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="right" align="start" sideOffset={12} collisionPadding={12} className="isolate z-[60]">
            <PreviewCard.Popup className="rounded-2xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-hidden">
              <PersonCard guest={guest} subscribed={subscribed} onViewCalendar={onViewCalendar} />
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </li>
  );
}

function reminderText(min: number): string {
  if (min <= 0) return "At time of event";
  if (min % 1440 === 0) return `${min / 1440} ${min === 1440 ? "day" : "days"} before`;
  if (min % 60 === 0) return `${min / 60} ${min === 60 ? "hour" : "hours"} before`;
  return `${min} minutes before`;
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
  body,
  bodyLoading = false,
  onViewCalendar,
  subscribed,
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
  // The full body, fetched on open when calendarView omitted it (see useEventBody).
  body?: GraphEvent["body"] | null;
  bodyLoading?: boolean;
  // Adds a guest's calendar to Other calendars (the person card's calendar button).
  onViewCalendar?: (p: { email: string; name: string }) => void;
  // Addresses (lower case) whose calendars are already in Other calendars.
  subscribed?: Set<string>;
}) {
  const [ask, setAsk] = useState<null | "edit" | "delete">(null);
  const [guestsOpen, setGuestsOpen] = useState(true);
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
  // Full description: the fetched body, else the cached body, else the 255-char preview.
  const fullBody = body ?? ev?.body;
  const description = fullBody ? bodyToText(fullBody) : (ev?.bodyPreview ?? "");
  const statusText = (s: string) => (s === "oof" ? "Out of office" : s === "workingElsewhere" ? "Working elsewhere" : s.charAt(0).toUpperCase() + s.slice(1));

  // Guests as Google lists them: the organizer first, then everyone else (rooms are in the location).
  const org = ev?.organizer?.emailAddress;
  const orgAddr = org?.address?.toLowerCase();
  const guests: Guest[] = ev
    ? [
        ...(org?.address && (ev.attendees?.length ?? 0) > 0 ? [{ email: org.address, name: org.name || org.address, response: "organizer" as const, organizer: true }] : []),
        ...(ev.attendees ?? [])
          .filter((a) => a.emailAddress.address && a.emailAddress.address.toLowerCase() !== orgAddr && a.type !== "resource")
          .map((a) => ({ email: a.emailAddress.address!, name: a.emailAddress.name || a.emailAddress.address!, response: a.status?.response, optional: a.type === "optional" })),
      ]
    : [];
  const rs = guests.map((g) => g.response);
  const counts = [
    [rs.filter((r) => r === "accepted" || r === "organizer").length, "yes"],
    [rs.filter((r) => r === "declined").length, "no"],
    [rs.filter((r) => r === "tentativelyAccepted").length, "maybe"],
    [rs.filter((r) => !r || r === "none" || r === "notResponded").length, "awaiting"],
  ] as const;
  const emails = guests.map((g) => g.email);
  const joinUrl = ev?.isOnlineMeeting ? ev.onlineMeeting?.joinUrl : undefined;
  const phone = ev?.onlineMeeting?.tollNumber ?? ev?.onlineMeeting?.tollFreeNumbers?.[0];

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
      className="w-[28rem] rounded-2xl"
    >
      {ev && (
        <div className="flex max-h-[min(80vh,44rem)] flex-col gap-4 overflow-y-auto p-4 pb-5" data-testid="event-detail">
          <div className="-mt-1 -mr-1 flex items-center justify-end gap-0.5">
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
            {emails.length > 0 && (
              <Button variant="ghost" size="icon-sm" aria-label="Email guests" render={<a href={mailto(emails, ev.subject)} />}>
                <Mail />
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
          <div className="grid grid-cols-[1.25rem_1fr] items-start gap-x-5 gap-y-4">
            <span className="mt-2 size-3.5 rounded-[4px]" style={{ background: hex }} />
            <div>
              <h2 className={cn("text-[22px] leading-7", ev.isCancelled && "line-through opacity-70")}>
                {ev.sensitivity === "private" && <Lock className="mr-1 inline size-4 align-[-2px]" />}
                {ev.subject || "(No title)"}
              </h2>
              <p className="mt-1 text-sm">{detailWhen(ev.startWall, ev.endWall, !!ev.isAllDay)}</p>
              {ev.seriesMasterId && <p className="text-sm">{ev.recurrence ? describeRecurrence(ev.recurrence) : "Part of a series"}</p>}
              {!ev.isAllDay && <p className="text-xs text-muted-foreground">{tz}</p>}
              {ev.isCancelled && <p className="text-xs text-destructive">This event was cancelled</p>}
            </div>
            {joinUrl && (
              <>
                <Video className="mt-2 size-5 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <Button className="h-10 rounded-full bg-[#1a73e8] px-6 text-sm font-medium text-white hover:bg-[#1765cc]" render={<a href={joinUrl} target="_blank" rel="noreferrer" />}>
                      Join with Microsoft Teams
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Copy meeting link" onClick={() => copy(joinUrl, "Meeting link")}>
                      <Copy />
                    </Button>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{joinUrl.replace(/^https?:\/\//, "")}</p>
                </div>
              </>
            )}
            {phone && (
              <>
                <Phone className="mt-0.5 size-5 text-muted-foreground" />
                <div className="text-sm">
                  <a className="text-primary hover:underline" href={`tel:${phone.replace(/[^\d+]/g, "")}${ev.onlineMeeting?.conferenceId ? `,,${ev.onlineMeeting.conferenceId}#` : ""}`}>
                    Join by phone
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {phone}
                    {ev.onlineMeeting?.conferenceId && ` · ID ${ev.onlineMeeting.conferenceId}#`}
                  </p>
                </div>
              </>
            )}
            {ev.location?.displayName && ev.location.displayName !== "Microsoft Teams Meeting" && (
              <>
                <MapPin className="mt-0.5 size-5 text-muted-foreground" />
                <p className="text-sm">{ev.location.displayName}</p>
              </>
            )}
            {guests.length > 0 && (
              <>
                <Users className="mt-0.5 size-5 text-muted-foreground" />
                <div className="min-w-0 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="leading-5">
                      <p className="font-medium">
                        {guests.length} {guests.length === 1 ? "guest" : "guests"}
                      </p>
                      {counts
                        .filter(([n]) => n > 0)
                        .map(([n, label]) => (
                          <p key={label} className="text-xs text-muted-foreground">
                            {n} {label}
                          </p>
                        ))}
                    </div>
                    <div className="-mr-1 flex items-center">
                      <Button variant="ghost" size="icon-sm" aria-label="Copy guest emails" onClick={() => copy(emails.join(", "), "Guest emails")}>
                        <Copy />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Chat with guests" render={<a href={teamsChat(emails, ev.subject)} target="_blank" rel="noreferrer" />}>
                        <MessageSquare />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Email guests" render={<a href={mailto(emails, ev.subject)} />}>
                        <Mail />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={guestsOpen ? "Hide guests" : "Show guests"} onClick={() => setGuestsOpen((o) => !o)}>
                        {guestsOpen ? <ChevronUp /> : <ChevronDown />}
                      </Button>
                    </div>
                  </div>
                  {guestsOpen && (
                    <ul className="mt-2 flex max-h-72 flex-col overflow-auto">
                      {guests.map((g) => (
                        <GuestRow key={g.email} guest={g} subscribed={!!subscribed?.has(g.email.toLowerCase())} onViewCalendar={onViewCalendar} />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
            {(description || bodyLoading) && (
              <>
                <AlignLeft className="mt-0.5 size-5 text-muted-foreground" />
                <div className="max-h-56 overflow-auto text-sm whitespace-pre-wrap" data-testid="event-description">
                  {description}
                  {bodyLoading && !fullBody && <span className="block text-xs text-muted-foreground">Loading the full description…</span>}
                </div>
              </>
            )}
            {!person && ev.isReminderOn && ev.reminderMinutesBeforeStart != null && (
              <>
                <Bell className="mt-0.5 size-5 text-muted-foreground" />
                <p className="text-sm">{reminderText(ev.reminderMinutesBeforeStart)}</p>
              </>
            )}
            <CalendarDays className="mt-0.5 size-5 text-muted-foreground" />
            {person ? (
              <div className="text-sm" data-testid="colleague-detail">
                <p>{person.name}</p>
                <p className="text-xs text-muted-foreground">
                  {statusText(ev.showAs ?? "busy")} · {person.email}
                </p>
              </div>
            ) : (
              <div className="text-sm">
                <p>{calendar?.name ?? "Calendar"}</p>
                {ev.showAs && ev.showAs !== "busy" && <p className="text-xs text-muted-foreground">{statusText(ev.showAs)}</p>}
              </div>
            )}
          </div>
          {!person && !mine && !ev.isCancelled && (ev.attendees?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
              <span className="mr-auto text-muted-foreground">Going?</span>
              {(
                [
                  ["accept", "Yes", "accepted"],
                  ["decline", "No", "declined"],
                  ["tentativelyAccept", "Maybe", "tentativelyAccepted"],
                ] as const
              ).map(([action, label, state]) => (
                <Button key={action} size="sm" variant={response === state ? "default" : "outline"} className="rounded-full px-4" onClick={() => onRsvp(action)}>
                  {response === state && <Check className="size-3.5" />}
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
