// Non-secret app configuration. The client ID and tenant ID are public by
// design (they ship in every browser bundle); the app has no client secret.
export const MS_CLIENT_ID = process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "cd569c2f-9121-4a99-8ba0-691c6df81cbd";
export const MS_TENANT_ID = process.env.NEXT_PUBLIC_MS_TENANT_ID ?? "4b1018eb-9480-4542-89d0-4e6233aba226";
// Must match next.config.ts basePath and the Entra redirect URIs.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/MS";

export const GRAPH = "https://graph.microsoft.com/v1.0";

// Scopes requested at sign-in: the minimum, so sign-in works even before the
// admin has approved the rest. Data pages ask for their own scopes lazily.
export const LOGIN_SCOPES = ["openid", "profile", "offline_access", "User.Read"];

// One entry per feature area; the consent status panel checks each one.
export const FEATURE_SCOPES: { key: string; label: string; scopes: string[] }[] = [
  { key: "mail", label: "Outlook: read, organise, categorise", scopes: ["Mail.ReadWrite"] },
  { key: "send", label: "Outlook: send", scopes: ["Mail.Send"] },
  { key: "drive", label: "OneDrive: files and folders, sharing", scopes: ["Files.ReadWrite"] },
  { key: "calendar", label: "Calendar: events, invites, RSVP", scopes: ["Calendars.ReadWrite"] },
  { key: "calendarShared", label: "Calendar: colleagues' shared calendars", scopes: ["Calendars.Read.Shared"] },
  { key: "contacts", label: "Contacts: recipient suggestions", scopes: ["Contacts.Read"] },
  { key: "people", label: "People: suggest colleagues from the Lyzr directory", scopes: ["People.Read", "User.ReadBasic.All"] },
  { key: "settings", label: "Mailbox settings: categories, rules, time zone", scopes: ["MailboxSettings.ReadWrite"] },
];
