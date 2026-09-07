export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  d = d.split(":")[0];
  return d || null;
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return normalizeDomain(email.split("@")[1]);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// Good-enough plain-text snippet from an email body — not a full sanitizer.
// Instantly only returns `body.html`, no plain-text field.
export function htmlToSnippet(html: string | null | undefined, maxLen = 400): string | null {
  if (!html) return null;
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(char);
  }
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length > maxLen) {
    // Array.from splits by Unicode code point, not UTF-16 code unit — a
    // plain .slice(0, maxLen) can cut a surrogate pair (e.g. an emoji) in
    // half, producing a lone surrogate that Postgres/PostgREST rejects as
    // invalid JSON on the next upsert ("Unicode low surrogate must follow
    // a high surrogate"), failing the whole batch.
    text = Array.from(text).slice(0, maxLen).join("").trimEnd() + "…";
  }
  return text || null;
}
