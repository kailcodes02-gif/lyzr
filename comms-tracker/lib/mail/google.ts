import { refreshGoogleAccessToken } from "../knowledge/drive";
import {
  extractEmails,
  INTERNAL_KNOWLEDGE_SENDERS,
  lookbackStart,
  MAX_INBOX_PER_RUN,
  MAX_INTERNAL_PER_RUN,
  MAX_SENT_PER_RUN,
  type MailboxRead,
  type MailMessage,
} from "./types";

// Gmail read side of the per-user mailbox connection. Same Google OAuth
// client + refresh token as Drive (one "Connect Google" consent grants
// drive.readonly AND gmail.readonly); token refresh is shared with drive.ts.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GoogleEnv = { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string };

async function gmailGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GMAIL_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchGmailProfileEmail(token: string): Promise<string | null> {
  const profile = await gmailGet<{ emailAddress?: string }>(token, "profile", {});
  return profile.emailAddress?.toLowerCase() ?? null;
}

async function listMessageIds(token: string, q: string, cap: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const page = await gmailGet<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(token, "messages", {
      q,
      maxResults: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < cap);
  return ids.slice(0, cap);
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
};

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function findTextPart(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  }
  return null;
}

async function getMessage(token: string, id: string, direction: MailMessage["direction"], full: boolean): Promise<MailMessage | null> {
  const msg = await gmailGet<GmailMessage>(
    token,
    `messages/${id}`,
    full
      ? { format: "full" }
      : { format: "metadata", metadataHeaders: "From,To,Cc,Subject,Date,Message-ID" }
  );
  const headers = new Map((msg.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const messageId = headers.get("message-id") ?? `gmail:${msg.id}`;
  const sentAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
  if (!sentAt) return null;
  return {
    messageId,
    providerId: msg.id,
    direction,
    from: extractEmails(headers.get("from"))[0] ?? null,
    to: extractEmails(headers.get("to")),
    cc: extractEmails(headers.get("cc")),
    subject: headers.get("subject") ?? null,
    snippet: msg.snippet ?? null,
    body: full ? (findTextPart(msg.payload)?.slice(0, 20000) ?? null) : null,
    sentAt,
  };
}

async function getMany(token: string, ids: string[], direction: MailMessage["direction"], full: boolean): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  // Modest concurrency: Gmail's per-user quota is generous but not infinite,
  // and a Worker cron has a wall-clock budget.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map((id) => getMessage(token, id, direction, full).catch(() => null)));
    for (const m of batch) if (m) out.push(m);
  }
  return out;
}

export async function readGmail(env: GoogleEnv, refreshToken: string, cursor: string | null): Promise<MailboxRead & { accessToken: string }> {
  const accessToken = await refreshGoogleAccessToken(env, refreshToken);
  const afterEpoch = Math.floor(lookbackStart(cursor).getTime() / 1000);
  const noise = "-in:spam -in:trash -category:promotions -category:social";

  const [sentIds, inboxIds, internalIds] = await Promise.all([
    listMessageIds(accessToken, `in:sent after:${afterEpoch}`, MAX_SENT_PER_RUN),
    listMessageIds(accessToken, `in:inbox after:${afterEpoch} ${noise}`, MAX_INBOX_PER_RUN),
    listMessageIds(
      accessToken,
      `(${INTERNAL_KNOWLEDGE_SENDERS.map((s) => `from:${s}`).join(" OR ")}) after:${afterEpoch}`,
      MAX_INTERNAL_PER_RUN
    ),
  ]);

  const [sent, inbox, internal] = await Promise.all([
    getMany(accessToken, sentIds, "outbound", false),
    getMany(accessToken, inboxIds, "inbound", false),
    getMany(accessToken, internalIds, "inbound", true),
  ]);
  return { sent, inbox, internal, accessToken };
}

// Full bodies for a chosen subset (the messages that matched a tracked
// contact) -- the first pass is metadata-only to keep the read cheap.
export async function fetchGmailBodies(accessToken: string, providerIds: string[], cap = 150): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = providerIds.slice(0, cap);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map((id) => getMessage(accessToken, id, "outbound", true).catch(() => null)));
    for (const m of batch) if (m?.body) out.set(m.providerId, m.body);
  }
  return out;
}
