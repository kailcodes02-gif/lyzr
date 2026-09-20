"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { graphFetch } from "@/lib/graph";
import {
  CAL_SCOPES,
  EVENT_FIELDS,
  draftToGraph,
  isConsentError,
  recurrenceProblem,
  useCalendarColors,
  useCalendars,
  useCalendarSettings,
  useCalendarView,
  useDelayedDelete,
  useEventMutations,
  useHiddenCalendars,
  useLiveRefresh,
  useReminders,
} from "@/lib/calendar/hooks";
import { bodyToText, moveBody, patchBody } from "@/lib/calendar/edit";
import { matchesSearch, normalise, sortEvents, toFcEvent, toFcPersonEvent, type WallEvent } from "@/lib/calendar/events";
import { groupCalendars, isColleagueCalendar } from "@/lib/calendar/overlay";
import { useCalendarGroups, useColleagues, useColleagueSchedules } from "@/lib/calendar/people";
import { fromGraphRecurrence } from "@/lib/calendar/recurrence";
import { addMinutesWall, nowWall, rangeTitle, roundToNext, stepDate, todayStr } from "@/lib/calendar/time";
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
  const groups = useCalendarGroups();
  const { hidden, toggle } = useHiddenCalendars();
  const { instance, accounts } = useMsal();
  const me = accounts[0]?.username;
  const grouped = useMemo(() => groupCalendars(calendars.data ?? [], groups.data ?? [], me), [calendars.data, groups.data, me]);
  const myCalendars = grouped.mine;
  const otherCalendars = grouped.other;
  // Every calendar the grid can show: mine plus the ones shared to me / in other groups.
  const allCalendars = useMemo(() => [...grouped.mine, ...grouped.other.map((o) => o.cal)], [grouped]);
  const groupOf = useMemo(() => Object.fromEntries(grouped.other.filter((o) => o.groupId).map((o) => [o.cal.id, o.groupId])), [grouped]);
  const visibleIds = useMemo(() => {
    const base = url.calendars ? allCalendars.filter((c) => url.calendars!.includes(c.id)) : allCalendars;
    return base.filter((c) => !hidden.has(c.id)).map((c) => c.id);
  }, [allCalendars, hidden, url.calendars]);

  const events = useCalendarView(tz, view, date, settings.weekStartsOn, visibleIds, groupOf);
  const colleagues = useColleagues();
  const overlays = useColleagueSchedules(tz, events.range, colleagues.people);
  const colleagueByCal = useMemo(() => new Map(colleagues.people.map((p) => [`people:${p.email.toLowerCase()}`, p])), [colleagues.people]);
  // Own calendars blue, everything else a distinct palette colour (kept per calendar / person).
  const otherCals = useMemo(() => otherCalendars.map((o) => o.cal), [otherCalendars]);
  const colleagueColors = useMemo(() => colleagues.people.map((p) => p.color), [colleagues.people]);
  const colorOf = useCalendarColors(myCalendars, otherCals, colleagueColors, dark);
  const live = useLiveRefresh(tz, events.range, !calendars.isError && !events.isError && allCalendars.length > 0);
  const updatedAt = Math.max(events.dataUpdatedAt || 0, live.lastChecked ?? 0) || null;
  useReminders(tz, !calendars.isError && allCalendars.length > 0, settings.desktopNotifications);
  const { create, patch, rsvp } = useEventMutations(tz);
  const delayedDelete = useDelayedDelete(tz);

  // Search: the box is seeded from ?q and written back (debounced) so the URL can be shared.
  const [query, setQuery] = useState(url.q);
  useEffect(() => {
    if (query === url.q) return;
    const t = setTimeout(() => setUrl({ q: query }), 200);
    return () => clearTimeout(t);
  }, [query, url.q, setUrl]);

  const calById = useMemo(() => new Map(allCalendars.map((c) => [c.id, c])), [allCalendars]);
  // Calendars whose calendarView sub-request failed: badge them, keep everything else on screen.
  const failed = useMemo(() => new Map(events.failed.map((f) => [f.id, `${f.code}: ${f.message}`])), [events.failed]);

  const allWall = useMemo(() => sortEvents([...(events.data ?? []), ...overlays.events].map((e) => normalise(e, tz))), [events.data, overlays.events, tz]);
  const wallEvents = useMemo(() => allWall.filter((e) => matchesSearch(e, query)), [allWall, query]);
  const fcEvents = useMemo(
    () =>
      wallEvents.map((e) => {
        const person = isColleagueCalendar(e.calendarId) ? colleagueByCal.get(e.calendarId) : undefined;
        return person ? toFcPersonEvent(e, person) : toFcEvent(e, calById.get(e.calendarId), colorOf(e.calendarId));
      }),
    [wallEvents, calById, colleagueByCal, colorOf],
  );

  // ----- popovers -----
  const [anchor, setAnchor] = useState<Anchor>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editScope, setEditScope] = useState<SeriesScope | undefined>(undefined);
  // The event being edited (the series master for scope "all", fetched with body) and its untouched draft.
  const [editing, setEditing] = useState<WallEvent | null>(null);
  const [editOrig, setEditOrig] = useState<EventDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The selected event lives in the URL (?e=<id>) so detail views deep-link. It is
  // looked up in the unfiltered list so a ?q filter never hides a deep-linked event.
  const selected = useMemo(() => (url.eventId ? allWall.find((e) => e.id === url.eventId) ?? null : null), [url.eventId, allWall]);
  const detailAnchor: Anchor = anchor ?? (typeof window !== "undefined" ? { x: window.innerWidth / 2, y: 120 } : null);
  // A deep link to an event outside this view: drop `e` once the data has settled, and say so.
  const missingToastFor = useRef<string | null>(null);
  useEffect(() => {
    if (!url.eventId || selected || !events.isSuccess || events.isFetching || overlays.isFetching) return;
    if (missingToastFor.current !== url.eventId) {
      missingToastFor.current = url.eventId;
      toast("Event not in this view");
    }
    setUrl({ eventId: null });
  }, [url.eventId, selected, events.isSuccess, events.isFetching, overlays.isFetching, setUrl]);

  const defaultCalendarId = allCalendars.find((c) => c.isDefaultCalendar)?.id ?? allCalendars[0]?.id ?? "";
  const editableCalendars = useMemo(() => allCalendars.filter((c) => c.canEdit !== false), [allCalendars]);

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
        teamsAuto: true,
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
    setEditOrig(null);
    setEditScope(undefined);
    if (url.eventId) setUrl({ eventId: null });
  }, [url.eventId, setUrl]);

  const openCreate = useCallback(
    (sel?: GridSelection) => {
      if (url.eventId) setUrl({ eventId: null });
      setNavOpen(false);
      if (sel) {
        const end = sel.allDay ? sel.end : sel.end === sel.start ? addMinutesWall(sel.start, settings.defaultDuration) : sel.end;
        setDraft(newDraft(sel.start, end, sel.allDay));
        setAnchor({ x: sel.x, y: sel.y });
      } else {
        setDraft(newDraft());
        setAnchor(createRef.current ?? { x: 120, y: 80 });
      }
      setEditing(null);
      setEditOrig(null);
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

  const draftFromEvent = (ev: WallEvent): EventDraft => {
    const start = ev.isAllDay ? ev.startWall.slice(0, 10) : ev.startWall.slice(0, 16);
    return {
      id: ev.id,
      calendarId: ev.calendarId,
      subject: ev.subject ?? "",
      start,
      end: ev.isAllDay ? ev.endWall.slice(0, 10) : ev.endWall.slice(0, 16),
      allDay: !!ev.isAllDay,
      attendees: (ev.attendees ?? []).filter((a) => a.emailAddress.address).map((a) => ({ name: a.emailAddress.name ?? a.emailAddress.address!, email: a.emailAddress.address! })),
      location: ev.location?.displayName ?? "",
      teams: !!ev.isOnlineMeeting,
      reminder: ev.isReminderOn === false ? null : (ev.reminderMinutesBeforeStart ?? settings.defaultReminder),
      description: ev.body ? bodyToText(ev.body) : (ev.bodyPreview ?? ""),
      recurrence: ev.recurrence ?? null,
      recurrenceForm: fromGraphRecurrence(ev.recurrence, start.slice(0, 10)),
      recurrenceTouched: false,
      showAs: ev.showAs ?? "busy",
      isPrivate: ev.sensitivity === "private",
    };
  };

  // Edit: fetch the event (the series master for "all events") with its body
  // first, so the form starts from the master's real fields and the PATCH can
  // leave body/recurrence alone unless they were changed.
  const onEdit = async (scope: SeriesScope) => {
    if (!selected || isColleagueCalendar(selected.calendarId)) return;
    const base = selected;
    const wantMaster = scope === "all" && !!base.seriesMasterId;
    const id = wantMaster ? base.seriesMasterId! : base.id;
    let full: WallEvent;
    try {
      const fetched = await graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(id)}?$select=${EVENT_FIELDS},body`, {
        immutableIds: false,
        headers: { Prefer: `outlook.timezone="${tz}"` },
      });
      full = normalise({ ...fetched, calendarId: base.calendarId }, tz);
    } catch (e) {
      // Fall back to the cached copy; the description is then treated as unchanged unless edited.
      toast.error(wantMaster ? "Could not load the series; editing this copy" : "Could not load the full event", { description: (e as Error).message });
      full = { ...base, body: base.body ?? { contentType: "text", content: base.bodyPreview ?? "" } };
    }
    const orig = draftFromEvent(full);
    setEditing(full);
    setEditOrig(orig);
    setEditScope(base.seriesMasterId ? scope : undefined);
    setDraft(orig);
    setUrl({ eventId: null });
    setDialogOpen(true);
  };

  const onDelete = (scope: SeriesScope) => {
    if (!selected || isColleagueCalendar(selected.calendarId)) return;
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
    const problem = recurrenceProblem(draft);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (editing && editOrig && draft.id) {
      // Only what changed: Graph keeps every property absent from a PATCH, which is
      // what preserves the HTML body / Teams blob and the series' recurrence.
      const body = patchBody(editOrig, draft, {
        tz,
        defaultReminder: settings.defaultReminder,
        scope: editScope,
        originalBody: editing.body,
        isOnlineMeeting: !!editing.isOnlineMeeting,
        isSeriesMaster: editing.type === "seriesMaster",
      });
      if (Object.keys(body).length === 0) {
        toast("No changes to save");
        closeAll();
        return;
      }
      patch.mutate({ id: draft.id, body });
    } else {
      // The draft may predate the calendars query (Create clicked early).
      const calendarId = draft.calendarId || defaultCalendarId;
      if (!calendarId) {
        toast.error("Your calendars are still loading. Try again in a moment.");
        return;
      }
      create.mutate({ calendarId, body: draftToGraph(draft, tz, settings.defaultReminder) });
    }
    closeAll();
  };

  const onMove = (m: GridMove) => {
    patch.mutate({ id: m.ev.id, body: moveBody(m, tz), quiet: true }, { onError: () => m.revert() });
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
        setNavOpen(false);
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

  // ----- consent gating -----
  if (calendars.isError && isConsentError(calendars.error)) return <ConsentFallback error={calendars.error} />;
  if (events.isError && isConsentError(events.error)) return <ConsentFallback error={events.error} />;

  const gridView = view === "agenda" ? null : view;
  const failedNames = events.failed.map((f) => calById.get(f.id)?.name ?? f.id);

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
        onMenu={() => setNavOpen((o) => !o)}
        onCreate={() => openCreate()}
        updatedAt={updatedAt}
        onRefresh={live.refresh}
        refreshing={live.refreshing || events.isFetching}
      />
      <div className="flex min-h-0 flex-1">
        <LeftPanel
          date={date}
          onDate={(d) => {
            setUrl({ date: d });
            setNavOpen(false);
          }}
          weekStartsOn={settings.weekStartsOn}
          calendars={myCalendars}
          otherCalendars={otherCalendars}
          hidden={hidden}
          onToggle={toggle}
          colleagues={colleagues.people}
          colleagueErrors={overlays.errors}
          onAddColleague={colleagues.add}
          onRemoveColleague={colleagues.remove}
          onToggleColleague={colleagues.toggle}
          onColleagueColor={colleagues.setColor}
          onOnlyColleague={colleagues.only}
          onCreate={() => openCreate()}
          loading={calendars.isPending}
          createRef={createRef}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          failed={failed}
          colorOf={colorOf}
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
          {!events.isError && events.failed.length > 0 && (
            <div className="absolute inset-x-4 top-2 z-10 rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="partial-failure">
              <span className="font-medium">Could not load {failedNames.join(", ")}. </span>
              <span className="text-muted-foreground">{events.failed[0].message} </span>
              <button type="button" className="text-primary hover:underline" onClick={() => events.refetch()}>
                Retry
              </button>
            </div>
          )}
          {((events.isFetching && events.data) || overlays.isFetching) && <div className="absolute top-0 left-0 z-10 h-0.5 w-full animate-pulse bg-primary/60" />}
          {calendars.isSuccess && allCalendars.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No calendars found in this mailbox.</div>
          )}
          {calendars.isSuccess && allCalendars.length > 0 && visibleIds.length === 0 && (
            <div className="absolute inset-x-0 top-14 z-10 text-center text-xs text-muted-foreground">All calendars are hidden. Tick one on the left.</div>
          )}
          {gridView ? (
            <CalendarGrid view={gridView} date={date} timeZone={tz} weekStartsOn={settings.weekStartsOn} events={fcEvents} dark={dark} onSelect={openCreate} onEventClick={onEventClick} onEventChange={onMove} />
          ) : (
            <AgendaView events={wallEvents} calendars={allCalendars} range={events.range} today={today} onOpen={onEventClick} colorOf={colorOf} />
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
        calendars={editableCalendars}
        tz={tz}
        durationMinutes={settings.defaultDuration}
        saving={create.isPending}
        colorOf={colorOf}
      />
      <EventDialog open={dialogOpen} draft={draft} onChange={setDraft} onClose={closeAll} onSave={save} calendars={editableCalendars} tz={tz} durationMinutes={settings.defaultDuration} saving={create.isPending || patch.isPending} scope={editScope} colorOf={colorOf} />
      <EventDetail
        ev={selected}
        anchor={detailAnchor}
        calendar={selected ? calById.get(selected.calendarId) : undefined}
        color={selected && !isColleagueCalendar(selected.calendarId) ? colorOf(selected.calendarId) : undefined}
        person={selected ? colleagueByCal.get(selected.calendarId) : undefined}
        onClose={closeAll}
        onEdit={(scope) => void onEdit(scope)}
        onDelete={onDelete}
        onRsvp={onRsvp}
        tz={tz}
      />
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
