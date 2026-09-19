// Microsoft Graph v1.0 calendar shapes (only the fields this app reads).

export type DateTimeTimeZone = { dateTime: string; timeZone: string };

export type EmailAddress = { name?: string; address?: string };

export type ResponseType = "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";

export type Attendee = {
  type?: "required" | "optional" | "resource";
  status?: { response?: ResponseType; time?: string };
  emailAddress: EmailAddress;
};

export type CalendarColor =
  | "auto"
  | "lightBlue"
  | "lightGreen"
  | "lightOrange"
  | "lightGray"
  | "lightYellow"
  | "lightTeal"
  | "lightPink"
  | "lightBrown"
  | "lightRed"
  | "maxColor";

export type OnlineMeetingProvider = "unknown" | "teamsForBusiness" | "skypeForBusiness" | "skypeForConsumer";

export type GraphCalendar = {
  id: string;
  name: string;
  color?: CalendarColor;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  owner?: EmailAddress;
  allowedOnlineMeetingProviders?: OnlineMeetingProvider[];
  defaultOnlineMeetingProvider?: OnlineMeetingProvider;
};

export type RecurrencePatternType = "daily" | "weekly" | "absoluteMonthly" | "relativeMonthly" | "absoluteYearly" | "relativeYearly";
export type DayOfWeek = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
export type WeekIndex = "first" | "second" | "third" | "fourth" | "last";

export type RecurrencePattern = {
  type: RecurrencePatternType;
  interval: number;
  month?: number;
  dayOfMonth?: number;
  daysOfWeek?: DayOfWeek[];
  firstDayOfWeek?: DayOfWeek;
  index?: WeekIndex;
};

export type RecurrenceRange = {
  type: "endDate" | "noEnd" | "numbered";
  startDate: string;
  endDate?: string;
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
};

export type PatternedRecurrence = { pattern: RecurrencePattern; range: RecurrenceRange };

export type ShowAs = "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
export type Sensitivity = "normal" | "personal" | "private" | "confidential";
export type EventType = "singleInstance" | "occurrence" | "exception" | "seriesMaster";

export type GraphEvent = {
  id: string;
  subject?: string;
  start: DateTimeTimeZone;
  end: DateTimeTimeZone;
  isAllDay?: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress: EmailAddress };
  attendees?: Attendee[];
  showAs?: ShowAs;
  sensitivity?: Sensitivity;
  categories?: string[];
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingProvider?: OnlineMeetingProvider;
  seriesMasterId?: string | null;
  type?: EventType;
  recurrence?: PatternedRecurrence | null;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  webLink?: string;
  responseStatus?: { response?: ResponseType; time?: string };
  isCancelled?: boolean;
  importance?: "low" | "normal" | "high";
  reminderMinutesBeforeStart?: number;
  isReminderOn?: boolean;
  isOrganizer?: boolean;
  "@removed"?: { reason: string };
};

// A Graph event tagged with the calendar it came from.
export type CalEvent = GraphEvent & { calendarId: string };

export type Reminder = {
  eventId: string;
  eventSubject?: string;
  eventStartTime: DateTimeTimeZone;
  eventEndTime: DateTimeTimeZone;
  reminderFireTime: DateTimeTimeZone;
  eventLocation?: { displayName?: string };
  changeKey?: string;
};

export type ScheduleInformation = {
  scheduleId: string;
  availabilityView: string;
  error?: { message: string };
  workingHours?: unknown;
};

export type ViewKind = "day" | "week" | "month" | "4day" | "agenda";

// What the create / edit forms carry. Times are wall-clock in the display zone.
export type EventDraft = {
  id?: string;
  calendarId: string;
  subject: string;
  start: string; // "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" when allDay
  end: string; // exclusive date when allDay
  allDay: boolean;
  attendees: { name: string; email: string }[];
  location: string;
  teams: boolean;
  reminder: number | null; // minutes, null = none
  description: string;
  recurrence: PatternedRecurrence | null;
  showAs: ShowAs;
  isPrivate: boolean;
};
