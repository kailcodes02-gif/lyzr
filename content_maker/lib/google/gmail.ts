const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gmail API error: ${response.status} - ${text}`);
  }
  return response.json();
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Best-effort plain-text extraction: prefers text/plain, falls back to a
// crude HTML strip. Good enough as LLM input context — not a rendering path.
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractBodyText(payload: GmailPart): string {
  const collect = (part: GmailPart): string | null => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) {
        const text = collect(child);
        if (text) return text;
      }
    }
    return null;
  };

  const plain = collect(payload);
  if (plain) return plain;

  const collectHtml = (part: GmailPart): string | null => {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) {
        const text = collectHtml(child);
        if (text) return text;
      }
    }
    return null;
  };

  const html = collectHtml(payload);
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

// Searches the logged-in user's own inbox and pulls a compact, LLM-ready
// summary of each match. Capped at `maxResults` to keep the context payload
// (and Gemini's summarization cost) bounded.
export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 15
): Promise<GmailMessageSummary[]> {
  const list = await gmailFetch(
    accessToken,
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
  );
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const messages = await Promise.all(
    ids.map(async (id) => {
      const msg = await gmailFetch(accessToken, `/messages/${id}?format=full`);
      const headers = msg.payload?.headers ?? [];
      return {
        id: msg.id,
        threadId: msg.threadId,
        from: extractHeader(headers, "From"),
        subject: extractHeader(headers, "Subject"),
        date: extractHeader(headers, "Date"),
        snippet: msg.snippet ?? "",
        bodyText: extractBodyText(msg.payload ?? {}).slice(0, 4000),
      };
    })
  );

  return messages;
}

export interface ContactSuggestion {
  email: string;
  name: string | null;
}

// "Name <email@domain.com>" or bare "email@domain.com" — used to parse
// From/To headers into structured suggestions.
function parseAddressList(headerValue: string): ContactSuggestion[] {
  const results: ContactSuggestion[] = [];
  for (const part of headerValue.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<?([\w.+-]+@[\w.-]+\.\w+)>?$/);
    if (match) {
      const [, name, email] = match;
      results.push({ email: email.toLowerCase(), name: name?.trim() || null });
    }
  }
  return results;
}

async function fetchContactsFromMessageIds(
  accessToken: string,
  ids: string[]
): Promise<{ contact: ContactSuggestion; count: number }[]> {
  const headerSets = await Promise.all(
    ids.map((id) =>
      gmailFetch(
        accessToken,
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To`
      ).catch(() => null)
    )
  );

  const tally = new Map<string, { contact: ContactSuggestion; count: number }>();
  for (const msg of headerSets) {
    if (!msg) continue;
    const headers = msg.payload?.headers ?? [];
    for (const headerName of ["From", "To"]) {
      const value = extractHeader(headers, headerName);
      if (!value) continue;
      for (const contact of parseAddressList(value)) {
        if (contact.email.endsWith("@lyzr.ai")) continue; // internal addresses aren't sales contacts
        const existing = tally.get(contact.email);
        if (existing) {
          existing.count += 1;
          if (!existing.contact.name && contact.name) existing.contact.name = contact.name;
        } else {
          tally.set(contact.email, { contact, count: 1 });
        }
      }
    }
  }
  return Array.from(tally.values());
}

// Autosuggest source: searches the user's own inbox for the typed prefix and
// surfaces the people involved in matching threads, rather than requiring a
// separate contacts data source (HubSpot token / Google People API scope
// aren't guaranteed to be available).
export async function searchContactSuggestions(
  accessToken: string,
  query: string,
  maxResults = 15
): Promise<ContactSuggestion[]> {
  if (query.trim().length < 2) return [];

  // from:/to: match substrings within the address itself (Gmail's search
  // operators do partial matching on the address field) — a bare full-text
  // `q=<term>` search is tokenized and largely misses short partial queries
  // like "ani" against "anirudh@...".
  const q = `from:(${query}) OR to:(${query})`;
  const list = await gmailFetch(
    accessToken,
    `/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`
  );
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const needle = query.trim().toLowerCase();
  const ranked = await fetchContactsFromMessageIds(accessToken, ids);
  return ranked
    .filter(
      ({ contact }) =>
        contact.email.includes(needle) || contact.name?.toLowerCase().includes(needle)
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((r) => r.contact);
}

// Broad pull, no typed query required — "who have I actually been emailing"
// across the user's most recent inbox activity, ranked by how often they
// show up. This is what powers the "suggest from my inbox" action, as
// opposed to searchContactSuggestions' typed-prefix search.
export async function listFrequentContacts(
  accessToken: string,
  maxMessages = 40,
  maxContacts = 15
): Promise<ContactSuggestion[]> {
  const list = await gmailFetch(accessToken, `/messages?maxResults=${maxMessages}`);
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const ranked = await fetchContactsFromMessageIds(accessToken, ids);
  return ranked
    .sort((a, b) => b.count - a.count)
    .slice(0, maxContacts)
    .map((r) => r.contact);
}

function buildMimeMessage(to: string | undefined, subject: string, bodyText: string): string {
  const lines = [
    to ? `To: ${to}` : undefined,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    bodyText,
  ].filter((line): line is string => line !== undefined);
  return lines.join("\r\n");
}

// Creates a Gmail draft — never sends. This is the only write path this app
// has into the user's Gmail; there is no send/drafts.send call anywhere.
export async function createDraft(
  accessToken: string,
  params: { to?: string; subject: string; bodyText: string }
): Promise<string> {
  const raw = Buffer.from(buildMimeMessage(params.to, params.subject, params.bodyText)).toString(
    "base64url"
  );

  const draft = await gmailFetch(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });

  return draft.id;
}
