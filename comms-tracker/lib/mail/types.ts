// One normalized message shape for both Gmail and Microsoft Graph so the
// matching/upsert logic in run.ts is written once.
export type MailMessage = {
  // RFC 5322 Message-ID when the provider exposes it (both do) -- the same
  // email read from two connected mailboxes then dedupes to one event.
  messageId: string;
  providerId: string;
  direction: "outbound" | "inbound";
  from: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  snippet: string | null;
  // Only populated for internal-knowledge messages (siva@), where the full
  // text is the point; skipped for everything else to keep reads cheap.
  body: string | null;
  sentAt: string;
};

export type MailboxRead = {
  sent: MailMessage[];
  inbox: MailMessage[];
  internal: MailMessage[];
};

export const INTERNAL_KNOWLEDGE_SENDERS = ["siva@lyzr.ai", "siva@lyzr.com"];
export const INTERNAL_DOMAINS = ["lyzr.ai", "lyzr.com"];

export const MAX_SENT_PER_RUN = 300;
export const MAX_INBOX_PER_RUN = 300;
export const MAX_INTERNAL_PER_RUN = 50;
export const FIRST_RUN_LOOKBACK_DAYS = 90;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Pulls every address out of a raw header like `"Tom Peach" <tom@wtwco.com>, x@y.com`.
export function extractEmails(header: string | null | undefined): string[] {
  if (!header) return [];
  return Array.from(new Set((header.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())));
}

export function isInternalAddress(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.includes(domain);
}

export function lookbackStart(cursor: string | null): Date {
  if (cursor) return new Date(cursor);
  return new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}
