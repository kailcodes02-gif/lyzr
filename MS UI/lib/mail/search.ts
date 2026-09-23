// Gmail-style search model for the mail box: structured chips (people, quick
// operators) plus free text, round-tripped to and from the KQL string that
// travels in the URL (?q=) and reaches Graph through $search.
//
// KQL properties used (Graph mail $search): from:, to:, cc:, subject:,
// hasAttachments:true, isRead:false, received>=YYYY-MM-DD, received<=YYYY-MM-DD.
// searchListPath() in logic.ts strips every double quote before the request
// (Graph's grammar has no escape), so quotes here only matter for readability.

export type PersonKind = "from" | "to" | "cc";
export type PersonChip = { kind: PersonKind; name: string; email: string };
export type SearchChip =
  | PersonChip
  | { kind: "subject"; value: string }
  | { kind: "has"; value: "attachment" }
  | { kind: "is"; value: "unread" }
  | { kind: "after" | "before"; value: string };

export type SearchState = { chips: SearchChip[]; text: string };

export const PERSON_KINDS: PersonKind[] = ["from", "to", "cc"];
export const EMPTY_SEARCH: SearchState = { chips: [], text: "" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clean(s: string): string {
  return s.replace(/["\\]/g, "").trim();
}

function key(c: SearchChip): string {
  return "email" in c ? `${c.kind}:${c.email.toLowerCase()}` : `${c.kind}:${c.value.toLowerCase()}`;
}

// Add a chip unless an equal one is present (same kind and value / email).
export function addChip(chips: SearchChip[], chip: SearchChip): SearchChip[] {
  const k = key(chip);
  if (chips.some((c) => key(c) === k)) return chips;
  // Only one after: and one before: make sense.
  if (chip.kind === "after" || chip.kind === "before") return [...chips.filter((c) => c.kind !== chip.kind), chip];
  return [...chips, chip];
}

export function chipLabel(c: SearchChip): string {
  switch (c.kind) {
    case "from": return `From: ${c.name || c.email}`;
    case "to": return `To: ${c.name || c.email}`;
    case "cc": return `Cc: ${c.name || c.email}`;
    case "subject": return `Subject: ${c.value}`;
    case "has": return "Has attachment";
    case "is": return "Unread";
    case "after": return `After ${c.value}`;
    case "before": return `Before ${c.value}`;
  }
}

function chipKql(c: SearchChip): string {
  switch (c.kind) {
    case "from":
    case "to":
    case "cc": return `${c.kind}:"${clean(c.email)}"`;
    case "subject": return `subject:${clean(c.value).replace(/\s+/g, " ")}`;
    case "has": return "hasAttachments:true";
    case "is": return "isRead:false";
    case "after": return `received>=${c.value}`;
    case "before": return `received<=${c.value}`;
  }
}

// Chips first, then free text. Empty when nothing is set.
export function buildSearchKql(state: SearchState): string {
  const parts = state.chips.map(chipKql);
  const text = clean(state.text).replace(/\s+/g, " ");
  if (text) parts.push(text);
  return parts.join(" ");
}

// Split a KQL string back into chips and free text. `people` (email -> name)
// gives person chips a display name; otherwise the email stands in.
export function parseSearchKql(kql: string, people?: Map<string, string> | Record<string, string>): SearchState {
  const nameOf = (email: string) => (people instanceof Map ? people.get(email.toLowerCase()) : people?.[email.toLowerCase()]) ?? email;
  let chips: SearchChip[] = [];
  const text: string[] = [];
  for (const raw of kql.split(/\s+/).filter(Boolean)) {
    const tok = raw.replace(/"/g, "");
    let m = /^(from|to|cc):(.+)$/i.exec(tok);
    if (m) {
      const email = m[2];
      chips = addChip(chips, { kind: m[1].toLowerCase() as PersonKind, email, name: nameOf(email) });
      continue;
    }
    m = /^subject:(.+)$/i.exec(tok);
    if (m) {
      chips = addChip(chips, { kind: "subject", value: m[1] });
      continue;
    }
    m = /^received(>=|<=)(\d{4}-\d{2}-\d{2})$/i.exec(tok);
    if (m) {
      chips = addChip(chips, { kind: m[1] === ">=" ? "after" : "before", value: m[2] });
      continue;
    }
    if (/^hasattachments:true$/i.test(tok)) {
      chips = addChip(chips, { kind: "has", value: "attachment" });
      continue;
    }
    if (/^isread:false$/i.test(tok)) {
      chips = addChip(chips, { kind: "is", value: "unread" });
      continue;
    }
    text.push(tok);
  }
  return { chips, text: text.join(" ") };
}

// ---- typed operators ---------------------------------------------------------

// The trailing token of the text when it is a person prefix such as "to:ani":
// which kind to suggest, the partial query and the text that precedes it.
export type PersonPrefix = { kind: PersonKind; query: string; before: string };

export function personPrefix(text: string): PersonPrefix | undefined {
  const m = /(^|\s)(from|to|cc):([^\s]*)$/i.exec(text);
  if (!m) return undefined;
  return { kind: m[2].toLowerCase() as PersonKind, query: m[3], before: text.slice(0, m.index + m[1].length).trimEnd() };
}

// Words typed in the box that a person suggestion should match. A person
// prefix wins; otherwise the whole text (so "ani" lists Ani Sharma).
export function peopleQuery(text: string): { kind: PersonKind; query: string } {
  const p = personPrefix(text);
  if (p) return { kind: p.kind, query: p.query };
  return { kind: "from", query: text.trim() };
}

// Promote completed operator tokens in the text ("has:attachment", "is:unread",
// "after:2026-01-01", "subject:foo", "from:a@b.c") to chips before a search runs.
export function absorbOperators(state: SearchState): SearchState {
  let chips = state.chips;
  const rest: string[] = [];
  for (const tok of state.text.split(/\s+/).filter(Boolean)) {
    const m = /^(from|to|cc|subject|has|is|after|before):(.+)$/i.exec(tok);
    if (!m) {
      rest.push(tok);
      continue;
    }
    const k = m[1].toLowerCase();
    const v = m[2].replace(/"/g, "");
    if ((k === "from" || k === "to" || k === "cc") && v) chips = addChip(chips, { kind: k, email: v, name: v });
    else if (k === "subject" && v) chips = addChip(chips, { kind: "subject", value: v });
    else if (k === "has" && /^attach/i.test(v)) chips = addChip(chips, { kind: "has", value: "attachment" });
    else if (k === "is" && /^unread$/i.test(v)) chips = addChip(chips, { kind: "is", value: "unread" });
    else if ((k === "after" || k === "before") && DATE_RE.test(v)) chips = addChip(chips, { kind: k, value: v });
    else rest.push(tok);
  }
  return { chips, text: rest.join(" ") };
}

// ---- suggestions -------------------------------------------------------------

export type QuickOperator = { id: string; label: string; hint: string; chip?: SearchChip; insert?: string };

export const QUICK_OPERATORS: QuickOperator[] = [
  { id: "from", label: "from:", hint: "Sender", insert: "from:" },
  { id: "to", label: "to:", hint: "Recipient", insert: "to:" },
  { id: "cc", label: "cc:", hint: "Copied", insert: "cc:" },
  { id: "subject", label: "subject:", hint: "Subject words", insert: "subject:" },
  { id: "has", label: "has:attachment", hint: "With attachments", chip: { kind: "has", value: "attachment" } },
  { id: "is", label: "is:unread", hint: "Unread only", chip: { kind: "is", value: "unread" } },
  { id: "after", label: "after:", hint: "Received on or after YYYY-MM-DD", insert: "after:" },
  { id: "before", label: "before:", hint: "Received on or before YYYY-MM-DD", insert: "before:" },
];

// Operators worth showing for the text: all of them when nothing is typed,
// otherwise those whose label starts with the last word ("ha" -> has:attachment).
// A finished "after:2026-01-01" style token gets a chip offer.
export function matchOperators(text: string, chips: SearchChip[] = []): QuickOperator[] {
  const last = text.split(/\s+/).filter(Boolean).pop()?.toLowerCase() ?? "";
  const present = new Set(chips.map(key));
  if (!last) return QUICK_OPERATORS.filter((o) => !o.chip || !present.has(key(o.chip)));
  const m = /^(after|before):(\d{4}-\d{2}-\d{2})$/.exec(last);
  if (m) return [{ id: `${m[1]}-date`, label: last, hint: m[1] === "after" ? "Received on or after" : "Received on or before", chip: { kind: m[1] as "after" | "before", value: m[2] } }];
  return QUICK_OPERATORS.filter((o) => o.label.startsWith(last) && o.label !== last && (!o.chip || !present.has(key(o.chip))));
}

// ---- recent searches -----------------------------------------------------------

export const RECENT_SEARCHES_KEY = "msui.recentSearches";
export const RECENT_SEARCHES_MAX = 8;

export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s).slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(kql: string): string[] {
  const q = kql.trim();
  if (!q) return recentSearches();
  const next = [q, ...recentSearches().filter((s) => s !== q)].slice(0, RECENT_SEARCHES_MAX);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // storage blocked
  }
  return next;
}

export function forgetSearch(kql: string): string[] {
  const next = recentSearches().filter((s) => s !== kql);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // storage blocked
  }
  return next;
}
