// Gmail-style Unsubscribe: where a message says how to leave its list.
// Pure functions only; the Graph calls live in ./hooks.ts.
//
// RFC 2369 List-Unsubscribe carries one or more <uri> entries (mailto: and
// https:); RFC 8058 List-Unsubscribe-Post: List-Unsubscribe=One-Click marks
// the https one as safe to POST without a page. A browser cannot POST it
// cross-origin, so the app opens the URL in a new tab either way. Failing a
// header, an anchor in the body whose text or href reads like "unsubscribe"
// is the next best thing.
import type { Message } from "./types";

export type UnsubscribeSource = "header" | "body";

export type MailtoTarget = { address: string; subject?: string; body?: string };

export type UnsubscribeInfo = {
  source: UnsubscribeSource;
  // https URL from the header (or the body link when source is "body").
  url?: string;
  mailto?: MailtoTarget;
  // RFC 8058 one-click POST advertised for `url`.
  oneClick: boolean;
};

export const UNSUBSCRIBE_LINK_RE = /unsubscribe|opt[- ]?out|manage (your )?preferences|email preferences/i;

export const SOURCE_LABEL: Record<UnsubscribeSource, string> = {
  header: "From the List-Unsubscribe header",
  body: "Link found in the message",
};

const headerValue = (headers: Message["internetMessageHeaders"], name: string): string | undefined => {
  const lc = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lc)?.value;
};

// "mailto:a@b.com?subject=Unsubscribe&body=..." -> parts. Returns undefined
// for anything without an address.
export function parseMailto(raw: string): MailtoTarget | undefined {
  const m = /^mailto:([^?]*)(?:\?(.*))?$/i.exec(raw.trim());
  if (!m) return undefined;
  let address = "";
  try {
    address = decodeURIComponent(m[1]).trim();
  } catch {
    address = m[1].trim();
  }
  if (!address || !address.includes("@")) return undefined;
  const out: MailtoTarget = { address: address.split(",")[0].trim() };
  if (m[2]) {
    const sp = new URLSearchParams(m[2]);
    const subject = sp.get("subject")?.trim();
    const body = sp.get("body")?.trim();
    if (subject) out.subject = subject;
    if (body) out.body = body;
  }
  return out;
}

const isHttps = (s: string) => /^https:\/\/\S+$/i.test(s);

// The entries of a List-Unsubscribe value: "<mailto:...>, <https://...>".
// Anything not wrapped in angle brackets, not mailto/https, or malformed is
// skipped rather than trusted.
export function parseListUnsubscribe(value: string | undefined): { mailto?: MailtoTarget; url?: string } {
  const out: { mailto?: MailtoTarget; url?: string } = {};
  if (!value) return out;
  const entries = [...value.matchAll(/<([^<>]+)>/g)].map((m) => m[1].trim());
  for (const e of entries) {
    if (!out.mailto && /^mailto:/i.test(e)) {
      const mt = parseMailto(e);
      if (mt) out.mailto = mt;
    } else if (!out.url && isHttps(e)) {
      try {
        out.url = new URL(e).toString();
      } catch {
        // malformed URL: skip
      }
    }
  }
  return out;
}

export function isOneClick(headers: Message["internetMessageHeaders"]): boolean {
  const v = headerValue(headers, "List-Unsubscribe-Post");
  return !!v && /list-unsubscribe\s*=\s*one-click/i.test(v);
}

// Unsubscribe target from the headers alone, or undefined.
export function unsubscribeFromHeaders(headers: Message["internetMessageHeaders"]): UnsubscribeInfo | undefined {
  const { mailto, url } = parseListUnsubscribe(headerValue(headers, "List-Unsubscribe"));
  if (!mailto && !url) return undefined;
  return { source: "header", url, mailto, oneClick: !!url && isOneClick(headers) };
}

// First anchor whose visible text or href reads like an unsubscribe link.
// Runs on the sanitised HTML (DOMParser; returns undefined off the browser).
export function findUnsubscribeLink(html: string | undefined): string | undefined {
  if (!html || typeof DOMParser === "undefined") return undefined;
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = (a.getAttribute("href") ?? "").trim();
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!href || !/^(https?:|mailto:)/i.test(href)) continue;
    if (UNSUBSCRIBE_LINK_RE.test(text) || UNSUBSCRIBE_LINK_RE.test(href)) return href;
  }
  return undefined;
}

// Header first (authoritative), body link as the fallback.
export function unsubscribeInfoOf(headers: Message["internetMessageHeaders"], bodyHtml?: string): UnsubscribeInfo | undefined {
  const fromHeaders = unsubscribeFromHeaders(headers);
  if (fromHeaders) return fromHeaders;
  const link = findUnsubscribeLink(bodyHtml);
  if (!link) return undefined;
  if (/^mailto:/i.test(link)) {
    const mailto = parseMailto(link);
    return mailto ? { source: "body", mailto, oneClick: false } : undefined;
  }
  return { source: "body", url: link, oneClick: false };
}

export type UnsubscribePlan = { kind: "open"; url: string } | { kind: "mail"; mailto: MailtoTarget };

// What a click does: an https URL opens in a new tab (the browser cannot
// POST it cross-origin); only a mailto: sends a mail through Graph.
export function planUnsubscribe(info: UnsubscribeInfo): UnsubscribePlan {
  if (info.url) return { kind: "open", url: info.url };
  return { kind: "mail", mailto: info.mailto! };
}

// The sendMail payload for a mailto: target.
export function unsubscribeMailPayload(mailto: MailtoTarget, from?: string) {
  return {
    message: {
      subject: mailto.subject || "Unsubscribe",
      body: { contentType: "text" as const, content: mailto.body || (from ? `Please unsubscribe ${from} from this list.` : "Please unsubscribe me from this list.") },
      toRecipients: [{ emailAddress: { address: mailto.address } }],
    },
    saveToSentItems: true,
  };
}
