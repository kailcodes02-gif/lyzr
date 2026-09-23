import type { MailFolder, Message, Thread } from "./types";

// ---- Folders --------------------------------------------------------------

// Gmail order for the well-known folders; custom folders follow alphabetically.
export const WELL_KNOWN_ORDER = ["inbox", "starred", "sentitems", "drafts", "archive", "junkemail", "deleteditems"] as const;
export type WellKnown = (typeof WELL_KNOWN_ORDER)[number];

export const WELL_KNOWN_LABEL: Record<WellKnown, string> = {
  inbox: "Inbox",
  starred: "Starred",
  sentitems: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  junkemail: "Spam",
  deleteditems: "Trash",
};

export const STARRED_ID = "starred";

export function orderFolders(folders: MailFolder[]): MailFolder[] {
  const rank = (f: MailFolder) => {
    const i = WELL_KNOWN_ORDER.indexOf((f.wellKnownName ?? "").toLowerCase() as WellKnown);
    return i === -1 ? WELL_KNOWN_ORDER.length : i;
  };
  return [...folders].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });
}

// Well-known folders that we never show in the tree (Outlook internals).
const HIDDEN = new Set(["outbox", "conversationhistory", "syncissues", "recoverableitemsdeletions", "clutter", "scheduled", "searchfolders", "serverfailures", "localfailures", "conflicts"]);
export function visibleFolders(folders: MailFolder[]): MailFolder[] {
  return folders.filter((f) => !HIDDEN.has((f.wellKnownName ?? "").toLowerCase()));
}

// Virtual folder keys: views that span folders rather than one Graph folder.
export const SEARCH_ID = "search";
export function isVirtualFolderKey(key: string): boolean {
  return key === STARRED_ID || key === SEARCH_ID || key.startsWith("label:");
}

// Graph rejects $filter + $orderby unless every $orderby property leads the
// $filter (InefficientFilter). Every sorted list query goes through here so
// the invariant lives in one place; the 1970 sentinel matches everything.
export const SORTABLE_FILTER_PREFIX = "receivedDateTime ge 1970-01-01T00:00:00Z";
export function sortableFilter(...clauses: (string | false | undefined)[]): string {
  return [SORTABLE_FILTER_PREFIX, ...clauses.filter((c): c is string => !!c)].join(" and ");
}

// The list endpoint for a folder key from the URL. `tab` narrows to Outlook's
// Focused/Other classification when given.
export function folderListPath(folderKey: string, tab?: string): string {
  const select = "$select=id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,flag,categories,importance,inferenceClassification,isDraft,webLink,parentFolderId";
  if (folderKey === STARRED_ID) return `/me/messages?${select}&$filter=${sortableFilter("flag/flagStatus eq 'flagged'")}&$orderby=receivedDateTime desc&$top=50`;
  const filter = tab === "focused" || tab === "other" ? `&$filter=${sortableFilter(`inferenceClassification eq '${tab}'`)}` : "";
  return `/me/mailFolders/${encodeURIComponent(folderKey)}/messages?${select}${filter}&$orderby=receivedDateTime desc&$top=50`;
}

// $search takes a KQL string in double quotes; Graph's grammar has no escape
// for an inner quote, so quotes typed by the user are dropped.
export function searchListPath(kql: string): string {
  const select = "$select=id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,flag,categories,importance,inferenceClassification,isDraft,webLink,parentFolderId";
  return `/me/messages?${select}&$search=${encodeURIComponent(JSON.stringify(kql.replace(/"/g, "").trim()))}&$top=50`;
}

// ---- Action scope -----------------------------------------------------------

const WELL_KNOWN_KEYS = new Set<string>([...WELL_KNOWN_ORDER, ...HIDDEN]);

// The well-known name behind a folder key, whether the key is the name
// itself (the usual URL state) or the folder's opaque id (a deep link, or a
// tree whose alias batch failed so the row fell back to its id). Undefined
// for custom and virtual folders.
export function wellKnownOfKey(key: string, folders: MailFolder[]): string | undefined {
  const lc = key.toLowerCase();
  if (isVirtualFolderKey(lc)) return undefined;
  if (WELL_KNOWN_KEYS.has(lc)) return lc;
  const wk = folders.find((f) => f.id === key)?.wellKnownName;
  return wk ? wk.toLowerCase() : undefined;
}

// Well-known keys are URL state; Graph returns parentFolderId as the opaque id.
export function resolveFolderId(key: string, folders: MailFolder[]): string | undefined {
  const lc = key.toLowerCase();
  return folders.find((f) => f.id === key || (f.wellKnownName ?? "").toLowerCase() === lc)?.id;
}

const KEEP_OUT = ["sentitems", "drafts", "deleteditems", "junkemail", "outbox"];

// Ids a move-type action (archive, trash, spam, move, delete forever) may
// touch for a conversation loaded across every folder. In a real folder only
// the copies that live there; in a virtual view (starred, label, search)
// everything except Sent/Drafts/Trash/Junk copies. Empty until the folder
// list is known, so callers disable the action rather than guess.
export function moveScopeIds(messages: Message[], currentFolder: string, folders: MailFolder[]): string[] {
  if (isVirtualFolderKey(currentFolder)) {
    if (!folders.length) return [];
    const keepOut = new Set(KEEP_OUT.map((k) => resolveFolderId(k, folders)).filter(Boolean));
    return messages.filter((m) => !keepOut.has(m.parentFolderId ?? "")).map((m) => m.id);
  }
  // Custom folders (including child folders, which the top-level list lacks) carry their id as the key.
  const id = resolveFolderId(currentFolder, folders) ?? (WELL_KNOWN_KEYS.has(currentFolder.toLowerCase()) ? undefined : currentFolder);
  if (!id) return [];
  return messages.filter((m) => m.parentFolderId === id).map((m) => m.id);
}

// ---- Threads --------------------------------------------------------------

const dateOf = (m: Message) => m.receivedDateTime ?? m.sentDateTime ?? m.lastModifiedDateTime ?? "";

export function sortMessagesAsc(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const d = dateOf(a).localeCompare(dateOf(b));
    if (d !== 0) return d;
    return (a.conversationIndex ?? "").localeCompare(b.conversationIndex ?? "");
  });
}

function nameOf(m: Message): string {
  const e = m.from?.emailAddress ?? m.sender?.emailAddress;
  const n = e?.name || e?.address || "";
  return n;
}

// Groups a flat, date-desc message page into Gmail-style conversations,
// newest conversation first. Messages without a conversationId are their own thread.
export function groupThreads(messages: Message[]): Thread[] {
  const byConv = new Map<string, Message[]>();
  for (const m of messages) {
    if (m["@removed"]) continue;
    const key = m.conversationId ?? m.id;
    const list = byConv.get(key);
    if (list) list.push(m);
    else byConv.set(key, [m]);
  }
  const threads: Thread[] = [];
  for (const [conversationId, list] of byConv) {
    const sorted = sortMessagesAsc(list);
    const latest = sorted[sorted.length - 1];
    const participants: string[] = [];
    for (const m of sorted) {
      const n = nameOf(m);
      if (n && !participants.includes(n)) participants.push(n);
    }
    threads.push({
      conversationId,
      messages: sorted,
      latest,
      unread: sorted.some((m) => m.isRead === false),
      starred: sorted.some((m) => m.flag?.flagStatus === "flagged"),
      hasAttachments: sorted.some((m) => m.hasAttachments),
      participants,
      categories: Array.from(new Set(sorted.flatMap((m) => m.categories ?? []))),
    });
  }
  return threads.sort((a, b) => dateOf(b.latest).localeCompare(dateOf(a.latest)));
}

// Gmail sender column: "Priya, Kailash, Daniel 3" style, first names only after the first.
export function participantLabel(thread: Thread, meAddress?: string): string {
  const names = thread.messages.map((m) => {
    const addr = (m.from?.emailAddress?.address ?? "").toLowerCase();
    if (meAddress && addr === meAddress.toLowerCase()) return "me";
    return nameOf(m).split(" ")[0] || "Unknown";
  });
  const uniq: string[] = [];
  for (const n of names) if (!uniq.includes(n)) uniq.push(n);
  if (uniq.length <= 1) return nameOf(thread.latest) || uniq[0] || "Unknown";
  if (uniq.length <= 3) return uniq.join(", ");
  return `${uniq[0]} .. ${uniq[uniq.length - 1]}`;
}

// ---- Search ---------------------------------------------------------------

export type SearchFields = { text?: string; from?: string; to?: string; subject?: string; hasAttachment?: boolean; unread?: boolean };

// Builds a KQL string for $search. Quotes are stripped from user input.
export function buildKql(f: SearchFields): string {
  const q = (s: string) => s.replace(/"/g, "").trim();
  const parts: string[] = [];
  if (f.text && q(f.text)) parts.push(q(f.text));
  if (f.from && q(f.from)) parts.push(`from:${q(f.from)}`);
  if (f.to && q(f.to)) parts.push(`to:${q(f.to)}`);
  if (f.subject && q(f.subject)) parts.push(`subject:${q(f.subject)}`);
  if (f.hasAttachment) parts.push("hasAttachments:true");
  if (f.unread) parts.push("isRead:false");
  return parts.join(" ");
}

export function parseKql(kql: string): SearchFields {
  const out: SearchFields = {};
  const text: string[] = [];
  for (const tok of kql.split(/\s+/).filter(Boolean)) {
    const [k, v] = tok.includes(":") ? tok.split(/:(.*)/) : ["", tok];
    switch (k.toLowerCase()) {
      case "from": out.from = v; break;
      case "to": out.to = v; break;
      case "subject": out.subject = v; break;
      case "hasattachments": out.hasAttachment = v === "true"; break;
      case "isread": out.unread = v === "false"; break;
      default: text.push(tok);
    }
  }
  if (text.length) out.text = text.join(" ");
  return out;
}

// ---- Categories -----------------------------------------------------------

// Outlook's preset palette (preset0..preset24), hex from the Outlook web client.
export const PRESET_COLORS: Record<string, { hex: string; name: string }> = {
  preset0: { hex: "#e74856", name: "Red" },
  preset1: { hex: "#ff8c00", name: "Orange" },
  preset2: { hex: "#ffab45", name: "Brown" },
  preset3: { hex: "#fff100", name: "Yellow" },
  preset4: { hex: "#47d041", name: "Green" },
  preset5: { hex: "#30c6cc", name: "Teal" },
  preset6: { hex: "#73aa24", name: "Olive" },
  preset7: { hex: "#00bcf2", name: "Blue" },
  preset8: { hex: "#8764b8", name: "Purple" },
  preset9: { hex: "#f7adc1", name: "Cranberry" },
  preset10: { hex: "#a0aeb2", name: "Steel" },
  preset11: { hex: "#004b60", name: "Dark steel" },
  preset12: { hex: "#8f8f8f", name: "Gray" },
  preset13: { hex: "#5b5b5b", name: "Dark gray" },
  preset14: { hex: "#000000", name: "Black" },
  preset15: { hex: "#a4262c", name: "Dark red" },
  preset16: { hex: "#ca5010", name: "Dark orange" },
  preset17: { hex: "#8e562e", name: "Dark brown" },
  preset18: { hex: "#986f0b", name: "Dark yellow" },
  preset19: { hex: "#0b6a0b", name: "Dark green" },
  preset20: { hex: "#038387", name: "Dark teal" },
  preset21: { hex: "#498205", name: "Dark olive" },
  preset22: { hex: "#004e8c", name: "Dark blue" },
  preset23: { hex: "#5c2e91", name: "Dark purple" },
  preset24: { hex: "#750b1c", name: "Dark cranberry" },
};

export function presetHex(color?: string | null): string {
  return PRESET_COLORS[color ?? ""]?.hex ?? "#8f8f8f";
}

// ---- Misc -----------------------------------------------------------------

export function senderName(m: Message): string {
  return nameOf(m);
}

export function recipientsLabel(list?: { emailAddress: { name?: string; address?: string } }[]): string {
  return (list ?? []).map((r) => r.emailAddress.name || r.emailAddress.address || "").filter(Boolean).join(", ");
}

export function isNearBottom(el: HTMLElement, px = 400): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < px;
}
