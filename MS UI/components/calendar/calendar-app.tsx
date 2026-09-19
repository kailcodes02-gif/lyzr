"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCalendars, useCalendarSettings, useCalendarView, useDelayedDelete, useDeltaRefresh, useEventMutations, useHiddenCalendars, useReminders, draftToGraph, isConsentError } from "@/lib/calendar/hooks";
import { matchesSearch, normalise, sortEvents, toFcEvent, type WallEvent } from "@/lib/calendar/events";
import { addMinutesWall, allDayExclusiveEnd, nowWall, rangeTitle, roundToNext, stepDate, todayStr } from "@/lib/calendar/time";
import type { EventDraft, GraphEvent, ViewKind } from "@/lib/calendar/types";
import { parseUrlState, serializeUrlState } from "@/lib/calendar/url-state";
import { AgendaView } from "./agenda";
import type { Anchor } from "./anchored-popover";
import { ConsentFallback } from "./consent-fallback";
import { EventDetail, type SeriesScope } from "./event-detail";
import { EventDialog } from "./event-dialog";
import type { GridMove, GridSelection } from "./grid";
import { LeftPanel } from "./left-panel";
import { QuickCreate } from "./quick-create";
import { SettingsDialog } from "./settings-dialog";
import { ShortcutsHelp } from "./shortcuts-help";
import { TopBar } from "./top-bar";

const CalendarGrid = dynamic(() => import("./grid"), {
  ssr: false,
  loading: () => <GridSkeleton />,
});

function GridSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-4" aria-busy="true" aria-label="Loading calendar">
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="grid flex-1 grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded bg-muted/60" />
        ))}
      </div>
    </div>
  );
}

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const read = () => setDark(el.classList.contains("dark") || (!el.classList.contains("light") && !!mq?.matches));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    mq?.addEventListener("change", read);
    return () => {
      mo.disconnect();
      mq?.removeEventListener("change", read);
    };
  }, []);
  return dark;
}

function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function CalendarApp() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const url = useMemo(() => parseUrlState(params.toString()), [params]);
  const { settings, update: updateSettings, timeZone: tz } = useCalendarSettings();
  const today = todayStr(tz);
  const view: ViewKind = url.view;
  const date = url.date ?? today;
  const dark = useDark();

  const setUrl = useCallback(
    (patch: Partial<ReturnType<typeof parseUrlState>>) => {
      const next = { ...url, ...patch };
      router.replace(`${pathname}${serializeUrlState(next, { date: todayStr(tz) })}`, { scroll: false });
    },
    [router, pathname, url, tz],
  );

  const calendars = useCalendars();
  const { hidden, toggle } = useHiddenCalendars();
  const allCalendars = useMemo(() => calendars.data ?? [], [calendars.data]);
  const visibleIds = useMemo(() => {
    const base = url.calendars ? allCalendars.filter((c) => url.calendars!.includes(c.id)) : allCalendars;
    return base.filter((c) => !hidden.has(c.id)).map((c) => c.id);
  }, [allCalendars, hidden, url.calendars]);

  const events = useCalendarView(tz, view, date, settings.weekStartsOn, visibleIds);
  useDeltaRefresh(tz, events.range, !calendars.isError && !events.isError && allCalendars.length > 0);
  useReminders(tz, !calendars.isError && allCalendars.length > 0);
  const { create, patch, rsvp } = useEventMutations(tz);
  const delayedDelete = useDelayedDelete(tz);

  const [query, setQuery] = useState(url.q);
  const wallEvents = useMemo(() => sortEvents((events.data ?? []).map((e) => normalise(e, tz)).filter((e) => matchesSearch(e, query))), [events.data, tz, query]);
  const calById = useMemo(() => new Map(allCalendars.map((c) => [c.id, c])), [allCalendars]);
  const fcEvents = useMemo(() => wallEvents.map((e) => toFcEvent(e, calById.get(e.calendarId))), [wallEvents, calById]);

  // ----- popovers -----
  const [anchor, setAnchor] = useState<Anchor>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editScope, setEditScope] = useState<SeriesScope | undefined>(undefined);
  const [editing, setEditing] = useState<WallEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The selected event lives in the URL (?e=<id>) so detail views deep-link.
  const selected = useMemo(() => (url.eventId ? wallEvents.find((e) => e.id === url.eventId) ?? null : null), [url.eventId, wallEvents]);
  const detailAnchor: Anchor = anchor ?? (typeof window !== "undefined" ? { x: window.innerWidth / 2, y: 120 } : null);

  const defaultCalendarId = allCalendars.find((c) => c.isDefaultCalendar)?.id ?? allCalendars[0]?.id ?? "";

  const newDraft = useCallback(
    (start?: string, end?: string, allDay = false): EventDraft => {
      const s = start ?? roundToNext(30, nowWall(tz));
      const e = end ?? addMinutesWall(s, settings.defaultDuration);
      return {
        calendarId: defaultCalendarId,
        subject: "",
        start: allDay ? s.slice(0, 10) : s.slice(0, 16),
        end: allDay ? (e.length > 10 ? e.slice(0, 10) : e) : e.slice(0, 16),
        allDay,
        attendees: [],
        location: "",
        teams: false,
        reminder: settings.defaultReminder,
        description: "",
        recurrence: null,
        showAs: "busy",
        isPrivate: false,
      };
    },
    [tz, settings.defaultDuration, settings.defaultReminder, defaultCalendarId],
  );

  const closeAll = useCallback(() => {
    setQuickOpen(false);
    setDialogOpen(false);
    setEditing(null);
    setEditScope(undefined);
    if (url.eventId) setUrl({ eventId: null });
  }, [url.eventId, setUrl]);

  const openCreate = useCallback(
    (sel?: GridSelection) => {
      if (url.eventId) setUrl({ eventId: null });
      if (sel) {
        const end = sel.allDay ? sel.end : sel.end === sel.start ? addMinutesWall(sel.start, settings.defaultDuration) : sel.end;
        setDraft(newDraft(sel.start, end, sel.allDay));
        setAnchor({ x: sel.x, y: sel.y });
      } else {
        setDraft(newDraft());
        setAnchor(createRef.current ?? { x: 120, y: 80 });
      }
      setEditing(null);
      setQuickOpen(true);
    },
    [newDraft, settings.defaultDuration, url.eventId, setUrl],
  );

  const onEventClick = useCallback(
    (ev: WallEvent, el: HTMLElement) => {
      setQuickOpen(false);
      setAnchor(el);
      setUrl({ eventId: ev.id });
    },
    [setUrl],
  );

  const draftFromEvent = (ev: WallEvent): EventDraft => ({
    id: ev.id,
    calendarId: ev.calendarId,
    subject: ev.subject ?? "",
    start: ev.isAllDay ? ev.startWall.slice(0, 10) : ev.startWall.slice(0, 16),
    end: ev.isAllDay ? ev.endWall.slice(0, 10) : ev.endWall.slice(0, 16),
    allDay: !!ev.isAllDay,
    attendees: (ev.attendees ?? []).filter((a) => a.emailAddress.address).map((a) => ({ name: a.emailAddress.name ?? a.emailAddress.address!, email: a.emailAddress.address! })),
    location: ev.location?.displayName ?? "",
    teams: !!ev.isOnlineMeeting,
    reminder: ev.isReminderOn === false ? null : (ev.reminderMinutesBeforeStart ?? settings.defaultReminder),
    description: ev.body?.content ?? ev.bodyPreview ?? "",
    recurrence: ev.recurrence ?? null,
    showAs: ev.showAs ?? "busy",
    isPrivate: ev.sensitivity === "private",
  });

  const onEdit = (scope: SeriesScope) => {
    if (!selected) return;
    setEditing(selected);
    setEditScope(selected.seriesMasterId ? scope : undefined);
    setDraft(draftFromEvent(selected));
    setUrl({ eventId: null });
    setDialogOpen(true);
  };

  const onDelete = (scope: SeriesScope) => {
    if (!selected) return;
    const ev = selected;
    const id = scope === "all" && ev.seriesMasterId ? ev.seriesMasterId : ev.id;
    const mine = ev.isOrganizer ?? ev.responseStatus?.response === "organizer";
    const hasGuests = (ev.attendees ?? []).some((a) => a.emailAddress.address !== ev.organizer?.emailAddress.address);
    const mode = mine ? (hasGuests ? "cancel" : "delete") : "declineDelete";
    closeAll();
    delayedDelete({ id, mode, label: mode === "cancel" ? "Event cancelled, guests will be notified" : mode === "declineDelete" ? "Declined and removed" : scope === "all" ? "Series deleted" : "Event deleted" });
  };

  const save = () => {
    if (!draft) return;
    const body = draftToGraph(draft, tz, settings.defaultReminder);
    if (editing && draft.id) {
      const targetId = editScope === "all" && editing.seriesMasterId ? editing.seriesMasterId : draft.id;
      const patchBody: Partial<GraphEvent> = { ...body };
      delete (patchBody as { transactionId?: string }).transactionId;
      if (editScope === "all") {
        // Times on the master differ from this occurrence; only send them when the user changed them.
        const orig = draftFromEvent(editing);
        if (orig.start === draft.start && orig.end === draft.end && orig.allDay === draft.allDay) {
          delete patchBody.start;
          delete patchBody.end;
          delete patchBody.isAllDay;
        }
      } else if (editing.seriesMasterId) delete patchBody.recurrence;
      if (patchBody.onlineMeetingProvider === undefined) delete patchBody.onlineMeetingProvider;
      if (editing.isOnlineMeeting) {
        delete patchBody.isOnlineMeeting;
        delete patchBody.onlineMeetingProvider;
      }
      patch.mutate({ id: targetId, body: patchBody });
    } else {
      // The draft may predate the calendars query (Create clicked early).
      const calendarId = draft.calendarId || defaultCalendarId;
      if (!calendarId) {
        toast.error("Your calendars are still loading. Try again in a moment.");
        return;
      }
      create.mutate({ calendarId, body });
    }
    closeAll();
  };

  const onMove = (m: GridMove) => {
    const body: Partial<GraphEvent> = m.allDay
      ? { isAllDay: true, start: { dateTime: `${m.start.slice(0, 10)}T00:00:00`, timeZone: tz }, end: { dateTime: `${(m.end.length > 10 ? m.end : allDayExclusiveEnd(m.end)).slice(0, 10)}T00:00:00`, timeZone: tz } }
      : { isAllDay: false, start: { dateTime: m.start, timeZone: tz }, end: { dateTime: m.end, timeZone: tz } };
    patch.mutate({ id: m.ev.id, body, quiet: true }, { onError: () => m.revert() });
  };

  const onRsvp = (action: "accept" | "tentativelyAccept" | "decline") => {
    if (!selected) return;
    rsvp.mutate({ id: selected.id, action });
    if (action === "decline") closeAll();
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        closeAll();
        setHelpOpen(false);
        setSettingsOpen(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (isTyping() || quickOpen || dialogOpen || settingsOpen) return;
      const go = (v: ViewKind) => setUrl({ view: v });
      switch (e.key) {
        case "t":
          setUrl({ date: today });
          break;
        case "j":
        case "n":
          setUrl({ date: stepDate(view, date, 1) });
          break;
        case "k":
        case "p":
          setUrl({ date: stepDate(view, date, -1) });
          break;
        case "1":
        case "d":
          go("day");
          break;
        case "2":
        case "w":
          go("week");
          break;
        case "3":
        case "m":
          go("month");
          break;
        case "4":
        case "x":
          go("4day");
          break;
        case "5":
        case "a":
          go("agenda");
          break;
        case "c":
          openCreate();
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          setHelpOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, date, today, setUrl, openCreate, closeAll, quickOpen, dialogOpen, settingsOpen]);

  // Ask once for desktop notifications (reminders).
  useEffect(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      // unsupported
    }
  }, []);

  // ----- consent gating -----
  if (calendars.isError && isConsentError(calendars.error)) return <ConsentFallback error={calendars.error} />;
  if (events.isError && isConsentError(events.error)) return <ConsentFallback error={events.error} />;

  const gridView = view === "agenda" ? null : view;

  return (
    <div className="flex h-screen min-w-0 flex-col">
      <TopBar
        title={rangeTitle(view, date, settings.weekStartsOn)}
        view={view}
        onView={(v) => setUrl({ view: v })}
        onToday={() => setUrl({ date: today })}
        onPrev={() => setUrl({ date: stepDate(view, date, -1) })}
        onNext={() => setUrl({ date: stepDate(view, date, 1) })}
        query={query}
        onQuery={setQuery}
        onSettings={() => setSettingsOpen(true)}
        onHelp={() => setHelpOpen(true)}
        searchRef={searchRef}
        timeZone={tz}
      />
      <div className="flex min-h-0 flex-1">
        <LeftPanel
          date={date}
          onDate={(d) => setUrl({ date: d })}
          weekStartsOn={settings.weekStartsOn}
          calendars={allCalendars}
          hidden={hidden}
          onToggle={toggle}
          onCreate={() => openCreate()}
          loading={calendars.isPending}
          createRef={createRef}
        />
        <main className="relative min-w-0 flex-1">
          {calendars.isError && !isConsentError(calendars.error) && (
            <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Could not load your calendars</p>
              <p className="text-muted-foreground">{(calendars.error as Error).message}</p>
              <button type="button" className="mt-2 text-primary hover:underline" onClick={() => calendars.refetch()}>
                Try again
              </button>
            </div>
          )}
          {events.isError && !isConsentError(events.error) && (
            <div className="absolute inset-x-4 top-2 z-10 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="font-medium text-destructive">Events failed to load. </span>
              <span className="text-muted-foreground">{(events.error as Error).message} </span>
              <button type="button" className="text-primary hover:underline" onClick={() => events.refetch()}>
                Retry
              </button>
            </div>
          )}
          {events.isFetching && events.data && <div className="absolute top-0 left-0 z-10 h-0.5 w-full animate-pulse bg-primary/60" />}
          {calendars.isSuccess && allCalendars.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No calendars found in this mailbox.</div>
          )}
          {calendars.isSuccess && allCalendars.length > 0 && visibleIds.length === 0 && (
            <div className="absolute inset-x-0 top-14 z-10 text-center text-xs text-muted-foreground">All calendars are hidden. Tick one on the left.</div>
          )}
          {gridView ? (
            <CalendarGrid view={gridView} date={date} timeZone={tz} weekStartsOn={settings.weekStartsOn} events={fcEvents} dark={dark} onSelect={openCreate} onEventClick={onEventClick} onEventChange={onMove} />
          ) : (
            <AgendaView events={wallEvents} calendars={allCalendars} range={events.range} today={today} onOpen={onEventClick} />
          )}
        </main>
      </div>

      <QuickCreate
        open={quickOpen}
        anchor={anchor}
        draft={draft}
        onChange={setDraft}
        onClose={closeAll}
        onSave={save}
        onMore={() => {
          setQuickOpen(false);
          setDialogOpen(true);
        }}
        calendars={allCalendars}
        tz={tz}
        durationMinutes={settings.defaultDuration}
        saving={create.isPending}
      />
      <EventDialog open={dialogOpen} draft={draft} onChange={setDraft} onClose={closeAll} onSave={save} calendars={allCalendars} tz={tz} durationMinutes={settings.defaultDuration} saving={create.isPending || patch.isPending} scope={editScope} />
      <EventDetail ev={selected} anchor={detailAnchor} calendar={selected ? calById.get(selected.calendarId) : undefined} onClose={closeAll} onEdit={onEdit} onDelete={onDelete} onRsvp={onRsvp} tz={tz} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={(p) => {
          updateSettings(p);
          if (p.timeZone !== undefined) toast.success(p.timeZone ? `Showing times in ${p.timeZone}` : "Using your browser time zone");
        }}
      />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
