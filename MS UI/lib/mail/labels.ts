// Labels with conditions: Gmail-style filters emulated with Outlook inbox
// rules (messageRule) that assign an Outlook category and, for "skip the
// inbox" labels, move the message into a folder of the same name. Pure
// functions only; hooks live in ./hooks.ts, Graph calls in ./install.ts.
import { sortableFilter } from "./logic";
import { PRESET_LABELS, SORTING_PRESETS, type PresetLabel } from "./presets";
import type { Message, MessageRule, MessageRulePredicates } from "./types";

// ---- Conditions <-> rules -------------------------------------------------
//
// Outlook's own vocabulary, one row per condition. "any" = one inbox rule per
// row (Graph ANDs every predicate inside a rule, so OR needs several rules);
// "all" = one rule carrying every predicate. Exceptions use the same rows and
// ride on every rule (`messageRule.exceptions`: any matching exception blocks).

export type ConditionKind =
  | "fromContains" // senderContains: words in the sender's name or address (@accenture.com, infosys)
  | "fromIs" // fromAddresses: exact addresses
  | "sentTo" // sentToAddresses: exact recipient addresses
  | "recipientContains" // recipientContains
  | "subjectContains"
  | "subjectOrBodyContains" // bodyOrSubjectContains
  | "bodyContains"
  | "hasAttachment" // hasAttachments
  | "importance"
  | "headerContains" // List-Unsubscribe = newsletter
  | "meeting" // isMeetingRequest + isMeetingResponse (two rules)
  | "sentOnlyToMe"
  | "sentToMe"
  | "sizeBetween"; // withinSizeRange, KB

export type Condition = {
  kind: ConditionKind;
  values?: string[]; // text kinds
  importance?: "low" | "normal" | "high";
  minKb?: number;
  maxKb?: number;
};

export type LabelConditions = { match: "any" | "all"; conditions: Condition[]; exceptions: Condition[] };

export const EMPTY_CONDITIONS: LabelConditions = { match: "any", conditions: [], exceptions: [] };

export const NEWSLETTER_HEADER = "List-Unsubscribe";
export const isNewsletterHeader = (h: string) => h.trim().toLowerCase() === NEWSLETTER_HEADER.toLowerCase();

export const CONDITION_KINDS: ConditionKind[] = ["fromContains", "fromIs", "sentTo", "recipientContains", "subjectContains", "subjectOrBodyContains", "bodyContains", "hasAttachment", "importance", "headerContains", "meeting", "sentOnlyToMe", "sentToMe", "sizeBetween"];

// Outlook's menu labels for the row picker.
export const CONDITION_LABEL: Record<ConditionKind, string> = {
  fromContains: "From contains",
  fromIs: "From is exactly",
  sentTo: "Sent to",
  recipientContains: "Recipient contains",
  subjectContains: "Subject contains",
  subjectOrBodyContains: "Subject or body contains",
  bodyContains: "Body contains",
  hasAttachment: "Has attachment",
  importance: "Importance is",
  headerContains: "Header contains",
  meeting: "Message is a meeting request or response",
  sentOnlyToMe: "Sent only to me",
  sentToMe: "Sent to me (any)",
  sizeBetween: "Message size between (KB)",
};

export const TEXT_KINDS = new Set<ConditionKind>(["fromContains", "fromIs", "sentTo", "recipientContains", "subjectContains", "subjectOrBodyContains", "bodyContains", "headerContains"]);
export const FLAG_KINDS = new Set<ConditionKind>(["hasAttachment", "meeting", "sentOnlyToMe", "sentToMe"]);
export const conditionValueKind = (k: ConditionKind): "text" | "importance" | "size" | "none" => (TEXT_KINDS.has(k) ? "text" : k === "importance" ? "importance" : k === "sizeBetween" ? "size" : "none");

const trimmed = (values?: string[]) => (values ?? []).map((s) => s.trim()).filter(Boolean);

// A row that would produce no predicate (blank chips, no size) is dropped.
export function isCompleteCondition(c: Condition): boolean {
  switch (conditionValueKind(c.kind)) {
    case "text":
      return trimmed(c.values).length > 0;
    case "importance":
      return !!c.importance;
    case "size":
      return (c.minKb ?? 0) > 0 || (c.maxKb ?? 0) > 0;
    default:
      return true;
  }
}

export const completeConditions = (rows: Condition[]) => rows.filter(isCompleteCondition);
export const hasConditions = (c: LabelConditions) => completeConditions(c.conditions).length > 0;

// The simple form (presets, inbox sorting, tests): sender addresses or
// keywords, subjects, meetings, newsletters, sent only to me, sender exceptions.
export type SimpleConditions = { from?: string[]; subject?: string[]; meetings?: boolean; newsletters?: boolean; toMe?: boolean; exceptFrom?: string[] };
export function simpleConditions(s: SimpleConditions): LabelConditions {
  const conditions: Condition[] = [];
  const addresses = (s.from ?? []).map((x) => x.trim()).filter(isFullAddress);
  const keywords = (s.from ?? []).map((x) => x.trim()).filter((x) => x && !isFullAddress(x));
  if (addresses.length) conditions.push({ kind: "fromIs", values: addresses });
  if (keywords.length) conditions.push({ kind: "fromContains", values: keywords });
  if (trimmed(s.subject).length) conditions.push({ kind: "subjectContains", values: trimmed(s.subject) });
  if (s.meetings) conditions.push({ kind: "meeting" });
  if (s.newsletters) conditions.push({ kind: "headerContains", values: [NEWSLETTER_HEADER] });
  if (s.toMe) conditions.push({ kind: "sentOnlyToMe" });
  const exceptions: Condition[] = trimmed(s.exceptFrom).length ? [{ kind: "fromContains", values: trimmed(s.exceptFrom) }] : [];
  return { match: "any", conditions, exceptions };
}

export const isFullAddress = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const LABEL_RULE_PREFIX = "Label: ";
export const SORTING_RULE_PREFIX = "Sorting: ";
export const RULES_PATH = "/me/mailFolders/inbox/messageRules";

export function ruleName(label: string, group: string): string {
  return `${LABEL_RULE_PREFIX}${label} (${group})`;
}

export type RuleOptions = {
  // Folder id: the rule also moves the message there and stops other rules,
  // so it leaves the Inbox and is never stamped Social / Promotions.
  moveToFolder?: string;
};

export function ruleActions(label: string, opts: RuleOptions = {}): MessageRule["actions"] {
  return opts.moveToFolder ? { assignCategories: [label], moveToFolder: opts.moveToFolder, stopProcessingRules: true } : { assignCategories: [label], stopProcessingRules: false };
}

const asRecipients = (values: string[]) => values.map((address) => ({ emailAddress: { address } }));

// Rows of one kind merge into one predicate (Outlook ORs the values inside a
// predicate); `meeting` is two predicates that can never share a rule.
const GROUP_NAME: Record<ConditionKind, string> = {
  fromIs: "senders", fromContains: "sender keywords", sentTo: "sent to", recipientContains: "recipients", subjectContains: "subject", subjectOrBodyContains: "subject or body", bodyContains: "body",
  hasAttachment: "attachments", importance: "importance", headerContains: "header", meeting: "meetings", sentOnlyToMe: "only to me", sentToMe: "to me", sizeBetween: "size",
};

// Merges the rows into Graph predicates. `meeting` is left out and reported
// separately (the caller emits one rule per meeting predicate).
export function predicatesOf(rows: Condition[]): { predicates: MessageRulePredicates; meeting: boolean } {
  const p: MessageRulePredicates = {};
  let meeting = false;
  const add = (key: "senderContains" | "subjectContains" | "bodyOrSubjectContains" | "bodyContains" | "recipientContains" | "headerContains", values: string[]) => {
    p[key] = uniqueSpellings([...(p[key] ?? []), ...values]);
  };
  for (const c of completeConditions(rows)) {
    const v = trimmed(c.values);
    switch (c.kind) {
      case "fromIs": p.fromAddresses = [...(p.fromAddresses ?? []), ...asRecipients(v.map((a) => a.toLowerCase()))]; break;
      case "fromContains": add("senderContains", v); break;
      case "sentTo": p.sentToAddresses = [...(p.sentToAddresses ?? []), ...asRecipients(v.map((a) => a.toLowerCase()))]; break;
      case "recipientContains": add("recipientContains", v); break;
      case "subjectContains": add("subjectContains", v); break;
      case "subjectOrBodyContains": add("bodyOrSubjectContains", v); break;
      case "bodyContains": add("bodyContains", v); break;
      case "headerContains": add("headerContains", v); break;
      case "hasAttachment": p.hasAttachments = true; break;
      case "importance": p.importance = c.importance; break;
      case "sentOnlyToMe": p.sentOnlyToMe = true; break;
      case "sentToMe": p.sentToMe = true; break;
      case "sizeBetween": p.withinSizeRange = { ...(c.minKb ? { minimumSize: c.minKb } : {}), ...(c.maxKb ? { maximumSize: c.maxKb } : {}) }; break;
      case "meeting": meeting = true; break;
    }
  }
  return { predicates: p, meeting };
}

const isEmptyPredicates = (p: MessageRulePredicates) => Object.keys(p).length === 0;

// The rule bodies for a label: "any" = one rule per condition kind (rows of
// one kind merged), "all" = one rule with every predicate. A meeting row
// becomes two rules (invitations, responses) either way. Each rule gets its
// own sequence, starting after `maxSequence`.
export function rulesForLabel(label: string, c: LabelConditions, maxSequence: number, opts: RuleOptions = {}): Omit<MessageRule, "id">[] {
  const out: Omit<MessageRule, "id">[] = [];
  const actions = ruleActions(label, opts);
  const ex = predicatesOf(c.exceptions);
  const exceptions: MessageRulePredicates | undefined = isEmptyPredicates(ex.predicates) && !ex.meeting ? undefined : { ...ex.predicates, ...(ex.meeting ? { isMeetingRequest: true } : {}) };
  let seq = Math.max(0, Math.floor(maxSequence));
  const push = (group: string, conditions: MessageRulePredicates) => {
    seq += 1;
    out.push({ displayName: ruleName(label, group), sequence: seq, isEnabled: true, conditions, ...(exceptions ? { exceptions } : {}), actions });
  };
  const rows = completeConditions(c.conditions);
  if (!rows.length) return out;
  if (c.match === "all") {
    const { predicates, meeting } = predicatesOf(rows);
    if (meeting) {
      push("invitations", { ...predicates, isMeetingRequest: true });
      push("responses", { ...predicates, isMeetingResponse: true });
    } else push("all conditions", predicates);
    return out;
  }
  // any: merge by kind, in the order the kinds first appear
  const kinds: ConditionKind[] = [];
  for (const r of rows) if (!kinds.includes(r.kind)) kinds.push(r.kind);
  for (const kind of kinds) {
    const group = rows.filter((r) => r.kind === kind);
    if (kind === "meeting") {
      push("invitations", { isMeetingRequest: true });
      push("responses", { isMeetingResponse: true });
      continue;
    }
    if (kind === "sizeBetween" || kind === "importance") {
      // Ranges and levels cannot be merged: one rule per row.
      for (const r of group) push(GROUP_NAME[kind], predicatesOf([r]).predicates);
      continue;
    }
    const name = kind === "headerContains" && group.every((r) => trimmed(r.values).every(isNewsletterHeader)) ? "newsletters" : GROUP_NAME[kind];
    push(name, predicatesOf(group).predicates);
  }
  return out;
}

export function maxSequence(rules: MessageRule[]): number {
  return rules.reduce((m, r) => Math.max(m, r.sequence ?? 0), 0);
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Rules whose actions assign the given category (ours or made in Outlook).
export function rulesOfLabel(label: string, rules: MessageRule[]): MessageRule[] {
  return rules.filter((r) => (r.actions?.assignCategories ?? []).some((c) => sameName(c, label)));
}

export const isSortingRule = (r: MessageRule) => r.displayName.startsWith(SORTING_RULE_PREFIX);

// A rule this app created for the label: named "Label: <name> (...)" or
// "Sorting: <name>", assigning exactly that category and using only the
// actions the dialog produces (category, optional move, stop). Anything else
// (rules built in Outlook that also forward, mark read, use other predicates
// or exceptions) is foreign and must never be replaced or deleted here.
export function isOwnRule(label: string, r: MessageRule): boolean {
  const name = r.displayName.toLowerCase();
  const own = name.startsWith(`${LABEL_RULE_PREFIX}${label} (`.toLowerCase()) || name === `${SORTING_RULE_PREFIX}${label}`.toLowerCase();
  if (!own) return false;
  const a = r.actions ?? {};
  const cats = a.assignCategories ?? [];
  if (cats.length !== 1 || !sameName(cats[0], label)) return false;
  const allowed = new Set(["assignCategories", "moveToFolder", "stopProcessingRules"]);
  return Object.entries(a).every(([k, v]) => allowed.has(k) || v === undefined || v === false || v === null || (Array.isArray(v) && v.length === 0));
}

export const ownRules = (label: string, rules: MessageRule[]) => rulesOfLabel(label, rules).filter((r) => isOwnRule(label, r));
export const foreignRules = (label: string, rules: MessageRule[]) => rulesOfLabel(label, rules).filter((r) => !isOwnRule(label, r));

// The folder a label's own rules move into, if any.
export function moveFolderOf(label: string, rules: MessageRule[]): string | undefined {
  return ownRules(label, rules).map((r) => r.actions?.moveToFolder).find((id): id is string => !!id);
}

// De-duplicates case-insensitively. A value listed in `spellings` takes that
// spelling (the one the user typed); otherwise the first spelling seen wins,
// unless it is Graph's all-caps echo and a later copy is not.
export function uniqueSpellings(values: string[], spellings: string[] = []): string[] {
  const preferred = new Map(spellings.map((s) => [s.toLowerCase(), s]));
  const at = new Map<string, number>();
  const out: string[] = [];
  const shouting = (v: string) => v === v.toUpperCase() && v !== v.toLowerCase();
  for (const v of values) {
    const k = v.toLowerCase();
    const i = at.get(k);
    if (i !== undefined) {
      if (!preferred.has(k) && shouting(out[i]) && !shouting(v)) out[i] = v;
      continue;
    }
    at.set(k, out.length);
    out.push(preferred.get(k) ?? v);
  }
  return out;
}

// Rows for one rule's predicates (conditions or exceptions).
export function conditionsOfPredicates(p: MessageRulePredicates, spellings: string[] = []): Condition[] {
  const rows: Condition[] = [];
  const text = (kind: ConditionKind, values?: string[]) => {
    if (values?.length) rows.push({ kind, values: uniqueSpellings(values, spellings) });
  };
  const addrs = (kind: ConditionKind, list?: { emailAddress?: { address?: string } }[]) => {
    const values = (list ?? []).map((a) => a.emailAddress?.address?.toLowerCase() ?? "").filter(Boolean);
    if (values.length) rows.push({ kind, values: uniqueSpellings(values, spellings) });
  };
  addrs("fromIs", p.fromAddresses);
  text("fromContains", p.senderContains);
  addrs("sentTo", p.sentToAddresses);
  text("recipientContains", p.recipientContains);
  text("subjectContains", p.subjectContains);
  text("subjectOrBodyContains", p.bodyOrSubjectContains);
  text("bodyContains", p.bodyContains);
  text("headerContains", p.headerContains);
  if (p.hasAttachments) rows.push({ kind: "hasAttachment" });
  if (p.importance) rows.push({ kind: "importance", importance: p.importance });
  if (p.isMeetingRequest || p.isMeetingResponse) rows.push({ kind: "meeting" });
  if (p.sentOnlyToMe) rows.push({ kind: "sentOnlyToMe" });
  if (p.sentToMe) rows.push({ kind: "sentToMe" });
  if (p.withinSizeRange && (p.withinSizeRange.minimumSize || p.withinSizeRange.maximumSize)) rows.push({ kind: "sizeBetween", minKb: p.withinSizeRange.minimumSize, maxKb: p.withinSizeRange.maximumSize });
  return rows;
}

const sameRow = (a: Condition, b: Condition) => JSON.stringify(a) === JSON.stringify(b);
const mergeRows = (into: Condition[], rows: Condition[]) => {
  for (const r of rows) {
    const twin = into.find((x) => x.kind === r.kind && conditionValueKind(r.kind) === "text");
    if (twin) twin.values = uniqueSpellings([...(twin.values ?? []), ...(r.values ?? [])]);
    else if (!into.some((x) => sameRow(x, r))) into.push(r);
  }
};

// Rebuilds the dialog state from a label's own rules: one rule carrying
// several predicates is "all of these", several rules are "any of these"
// (the invitations + responses pair reads back as one meeting row). Graph
// echoes predicate strings upper-cased (senderContains ['adele'] comes back
// as ['ADELE']), so values are matched case-insensitively and `spellings`
// (the preset's or the dialog's own values) restores the casing the user knows.
export function conditionsFromRules(label: string, rules: MessageRule[], spellings: string[] = presetSpellings(label)): LabelConditions {
  const own = ownRules(label, rules);
  const conditions: Condition[] = [];
  const exceptions: Condition[] = [];
  let all = false;
  const meetingOnly = (p: MessageRulePredicates) => Object.keys(p).filter((k) => k !== "isMeetingRequest" && k !== "isMeetingResponse");
  for (const r of own) {
    const p = r.conditions ?? {};
    const rows = conditionsOfPredicates(p, spellings);
    // Several predicates in one rule (beyond the meeting flag) = all-of.
    if (rows.length > 1 || (rows.length === 1 && rows[0].kind === "meeting" && meetingOnly(p).length > 0)) all = true;
    mergeRows(conditions, rows);
    mergeRows(exceptions, conditionsOfPredicates(r.exceptions ?? {}, spellings));
  }
  // Two rules that share every non-meeting predicate are the meeting pair of an all-of set.
  if (all && own.length === 2) {
    const [a, b] = own.map((r) => JSON.stringify(meetingOnly(r.conditions ?? {}).sort().map((k) => [k, (r.conditions as Record<string, unknown>)[k]])));
    if (a !== b) all = false;
  } else if (all && own.length > 1) all = false;
  return { match: all ? "all" : "any", conditions, exceptions };
}

// Save in the label dialog: a name, not already saving and, when editing,
// the label's rules loaded (with them missing the save would replace the
// rules with none; a failed rules GET must not turn into a silent wipe).
export function labelSaveBlocked(s: { name: string; busy: boolean; editing: boolean; loaded: boolean; rulesFailed: boolean }): boolean {
  if (!s.name.trim() || s.busy) return true;
  return s.editing && (!s.loaded || s.rulesFailed);
}

// Where new label rules go: before every "Sorting: " rule (so a skip-inbox
// label wins over Social / Promotions), else after the last rule. Rules from
// the insertion point on are pushed down by `count` (highest first, so a
// PATCH never collides with a neighbour). A read-only rule cannot be
// renumbered but still owns its sequence, so when one sits at or after the
// insertion point the block goes after the last rule instead: no POST ever
// reuses an existing sequence.
export function planLabelInsert(existing: MessageRule[], count: number): { start: number; renumber: { id: string; sequence: number }[] } {
  const sorting = existing.filter(isSortingRule);
  const append = { start: maxSequence(existing) + 1, renumber: [] };
  if (!count || !sorting.length) return append;
  const at = Math.min(...sorting.map((r) => r.sequence));
  if (existing.some((r) => r.isReadOnly && r.sequence >= at)) return append;
  const renumber = existing
    .filter((r) => r.sequence >= at)
    .sort((a, b) => b.sequence - a.sequence)
    .map((r) => ({ id: r.id, sequence: r.sequence + count }));
  return { start: at, renumber };
}

// ---- Backfill matcher -------------------------------------------------------

const addressOf = (m: Message) => (m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address ?? "").toLowerCase();
const nameOf = (m: Message) => (m.from?.emailAddress?.name ?? "").toLowerCase();

export function senderMatches(m: Message, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const addr = addressOf(m);
  if (isFullAddress(p)) return addr === p;
  if (p.startsWith("@")) return addr.endsWith(p) || addr.endsWith(`.${p.slice(1)}`);
  // keyword: Outlook's senderContains matches the display name or the address
  return addr.includes(p) || nameOf(m).includes(p);
}

export function hasUnsubscribeHeader(m: Message): boolean {
  return (m.internetMessageHeaders ?? []).some((h) => h.name.toLowerCase() === "list-unsubscribe");
}

// Graph returns @odata.type on every list row of a derived type, so meeting
// mail is detectable without extra $select.
export const isMeetingMail = (m: Message) => /eventMessage/i.test(m["@odata.type"] ?? "");

const recipientsOf = (m: Message) => [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])];
const includesAny = (hay: string, values?: string[]) => trimmed(values).some((v) => hay.toLowerCase().includes(v.toLowerCase()));

// Client-side approximation of one row. Body rows only see the preview and
// the size is unknown in a list payload, so those never match here.
export function conditionMatches(m: Message, c: Condition, meAddress?: string): boolean {
  const me = (meAddress ?? "").toLowerCase();
  const subject = m.subject ?? "";
  const preview = m.bodyPreview ?? "";
  switch (c.kind) {
    case "fromContains": return trimmed(c.values).some((p) => senderMatches(m, p));
    case "fromIs": return trimmed(c.values).some((p) => addressOf(m) === p.toLowerCase());
    case "sentTo": return recipientsOf(m).some((r) => trimmed(c.values).some((p) => (r.emailAddress.address ?? "").toLowerCase() === p.toLowerCase()));
    case "recipientContains": return recipientsOf(m).some((r) => includesAny(`${r.emailAddress.name ?? ""} ${r.emailAddress.address ?? ""}`, c.values));
    case "subjectContains": return includesAny(subject, c.values);
    case "subjectOrBodyContains": return includesAny(`${subject}\n${preview}`, c.values);
    case "bodyContains": return includesAny(preview, c.values);
    case "hasAttachment": return !!m.hasAttachments;
    case "importance": return (m.importance ?? "normal") === c.importance;
    case "headerContains": return (m.internetMessageHeaders ?? []).some((h) => includesAny(h.name, c.values));
    case "meeting": return isMeetingMail(m);
    case "sentOnlyToMe": {
      const to = m.toRecipients ?? [];
      return !!me && to.length === 1 && (to[0].emailAddress.address ?? "").toLowerCase() === me;
    }
    case "sentToMe": return !!me && (m.toRecipients ?? []).some((r) => (r.emailAddress.address ?? "").toLowerCase() === me);
    case "sizeBetween": return false;
  }
}

// Client-side approximation of the rules: any / all of the rows, unless an
// exception matches. Empty conditions never match.
export function matchesConditions(m: Message, c: LabelConditions, meAddress?: string): boolean {
  const rows = completeConditions(c.conditions);
  if (!rows.length) return false;
  if (completeConditions(c.exceptions).some((e) => conditionMatches(m, e, meAddress))) return false;
  return c.match === "all" ? rows.every((r) => conditionMatches(m, r, meAddress)) : rows.some((r) => conditionMatches(m, r, meAddress));
}

export const hasCategory = (m: Message, label: string) => (m.categories ?? []).some((x) => sameName(x, label));

export function withCategory(existing: string[] | undefined, label: string): string[] {
  const cur = existing ?? [];
  return cur.some((c) => sameName(c, label)) ? cur : [...cur, label];
}

export function withoutCategory(existing: string[] | undefined, label: string): string[] {
  return (existing ?? []).filter((c) => !sameName(c, label));
}

// Messages that match but do not yet carry the label.
export function backfillTargets(messages: Message[], label: string, c: LabelConditions, meAddress?: string): Message[] {
  return messages.filter((m) => !hasCategory(m, label) && matchesConditions(m, c, meAddress));
}

// ---- Query builders ---------------------------------------------------------

export const escapeOData = (s: string) => s.replace(/'/g, "''");
// Reserved characters (& # + % ...) in a filter value would otherwise split
// or truncate the query string; Graph accepts the percent-encoded form.
export const encodeFilter = (filter: string) => encodeURIComponent(filter);

const LIST_SELECT = "id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,flag,categories,importance,inferenceClassification,isDraft,webLink,parentFolderId";

export const categoryFilter = (name: string) => `categories/any(c:c eq '${escapeOData(name)}')`;

// Label view: every message with the category across folders (Trash and
// Junk are dropped client-side, see clientFilterFor). receivedDateTime leads
// the filter (sortableFilter) because Graph requires $orderby properties to
// appear first in $filter.
export function labelListPath(name: string, strategy: "filter" | "search" = "filter"): string {
  if (strategy === "search") return `/me/messages?$select=${LIST_SELECT}&$search=${encodeURIComponent(JSON.stringify(`category:${name.replace(/"/g, "")}`))}&$top=50`;
  return `/me/messages?$select=${LIST_SELECT}&$filter=${encodeFilter(sortableFilter(categoryFilter(name)))}&$orderby=receivedDateTime desc&$top=50`;
}

// v1.0 mailFolder has no wellKnownName: never put it in a $select.
export const folderByNamePath = (name: string) => `/me/mailFolders?$select=id,displayName,parentFolderId&$filter=${encodeFilter(`displayName eq '${escapeOData(name)}'`)}`;

// ---- Presets -----------------------------------------------------------------

export function presetConditions(p: PresetLabel): LabelConditions {
  return simpleConditions({
    from: [...(p.conditions.fromAddresses ?? []), ...(p.conditions.senderContains ?? [])],
    subject: [...(p.conditions.subjectContains ?? [])],
    meetings: !!p.conditions.meetingRequests,
    newsletters: !!p.conditions.newsletters,
  });
}

// The spellings a preset label was installed with, for conditionsFromRules.
export function presetSpellings(label: string): string[] {
  const p = [...PRESET_LABELS, ...SORTING_PRESETS].find((x) => sameName(x.name, label));
  if (!p) return [];
  return presetConditions(p).conditions.flatMap((c) => c.values ?? []);
}

export const SOCIAL_LABEL = "Social";
export const PROMOTIONS_LABEL = "Promotions";
const socialPreset = SORTING_PRESETS.find((p) => p.name === SOCIAL_LABEL)!;
const promotionsPreset = SORTING_PRESETS.find((p) => p.name === PROMOTIONS_LABEL)!;
export const SOCIAL_COLOR = socialPreset.color;
export const PROMOTIONS_COLOR = promotionsPreset.color;
export const SOCIAL_SENDERS: string[] = socialPreset.conditions.senderContains ?? [];

export const SOCIAL_CONDITIONS: LabelConditions = presetConditions(socialPreset);
// Social senders' digests carry List-Unsubscribe too; the exception keeps
// each of them in one tab.
export const PROMOTIONS_CONDITIONS: LabelConditions = { ...presetConditions(promotionsPreset), exceptions: [{ kind: "fromContains", values: SOCIAL_SENDERS }] };

const sortingRule = (label: string, c: LabelConditions): Omit<MessageRule, "id" | "sequence"> => {
  const [first] = rulesForLabel(label, c, 0);
  return { displayName: `${SORTING_RULE_PREFIX}${label}`, isEnabled: true, conditions: first.conditions, ...(first.exceptions ? { exceptions: first.exceptions } : {}), actions: first.actions };
};
export const SORTING_RULES: Omit<MessageRule, "id" | "sequence">[] = [sortingRule(SOCIAL_LABEL, SOCIAL_CONDITIONS), sortingRule(PROMOTIONS_LABEL, PROMOTIONS_CONDITIONS)];

export const PRESET_NAMES = PRESET_LABELS.map((p) => p.name);

// Inbox tab filters. "server" uses not(any) which Graph may reject on mail;
// the hook then falls back to a plain inbox list plus client-side exclusion.
export function tabFilter(tab: "primary" | "social" | "promotions", focused?: boolean): string {
  const parts: string[] = [];
  if (focused) parts.push("inferenceClassification eq 'focused'");
  if (tab === "social") parts.push(categoryFilter(SOCIAL_LABEL));
  else if (tab === "promotions") parts.push(categoryFilter(PROMOTIONS_LABEL));
  else parts.push(`not(${categoryFilter(SOCIAL_LABEL)}) and not(${categoryFilter(PROMOTIONS_LABEL)})`);
  return parts.join(" and ");
}

export function inboxTabPath(tab: "primary" | "social" | "promotions", focused?: boolean, primaryStrategy: "server" | "client" = "server"): string {
  const base = `/me/mailFolders/inbox/messages?$select=${LIST_SELECT}`;
  if (tab === "primary" && primaryStrategy === "client") {
    const f = focused ? `&$filter=${encodeFilter(sortableFilter("inferenceClassification eq 'focused'"))}` : "";
    return `${base}${f}&$orderby=receivedDateTime desc&$top=50`;
  }
  return `${base}&$filter=${encodeFilter(sortableFilter(tabFilter(tab, focused)))}&$orderby=receivedDateTime desc&$top=50`;
}

export const isSortingCategory = (m: Message) => (m.categories ?? []).some((c) => c === SOCIAL_LABEL || c === PROMOTIONS_LABEL);

// ---- Outlook's rule sentence -------------------------------------------------
// "Apply this rule after the message arrives: from X or Y, move it to the
// Leadership folder and assign it to the Leadership category and stop
// processing more rules". Used by the label dialog preview, the Filters
// dialog and the preset summaries.

const orList = (values: string[]) => values.map((v) => `'${v}'`).join(" or ");
const addrList = (list?: { emailAddress?: { address?: string; name?: string } }[]) => (list ?? []).map((a) => a.emailAddress?.address || a.emailAddress?.name || "").filter(Boolean);

export function describePredicates(p: MessageRulePredicates): string[] {
  const out: string[] = [];
  if (p.fromAddresses?.length) out.push(`from ${addrList(p.fromAddresses).join(" or ")}`);
  if (p.senderContains?.length) out.push(`with ${orList(p.senderContains)} in the sender's address`);
  if (p.sentToAddresses?.length) out.push(`sent to ${addrList(p.sentToAddresses).join(" or ")}`);
  if (p.recipientContains?.length) out.push(`with ${orList(p.recipientContains)} in the recipient's address`);
  if (p.subjectContains?.length) out.push(`with ${orList(p.subjectContains)} in the subject`);
  if (p.bodyOrSubjectContains?.length) out.push(`with ${orList(p.bodyOrSubjectContains)} in the subject or body`);
  if (p.bodyContains?.length) out.push(`with ${orList(p.bodyContains)} in the body`);
  if (p.headerContains?.length) out.push(p.headerContains.every(isNewsletterHeader) ? "which is a newsletter (has an unsubscribe header)" : `with ${orList(p.headerContains)} in the message header`);
  if (p.hasAttachments) out.push("which has an attachment");
  if (p.importance) out.push(`marked as ${p.importance} importance`);
  if (p.isMeetingRequest && p.isMeetingResponse) out.push("which is a meeting invitation, update or response");
  else if (p.isMeetingRequest) out.push("which is a meeting invitation or update");
  else if (p.isMeetingResponse) out.push("which is a meeting response");
  if (p.sentOnlyToMe) out.push("sent only to me");
  if (p.sentToMe) out.push("where my name is in the To box");
  if (p.withinSizeRange && (p.withinSizeRange.minimumSize || p.withinSizeRange.maximumSize)) {
    const { minimumSize: lo, maximumSize: hi } = p.withinSizeRange;
    out.push(lo && hi ? `with a size between ${lo} KB and ${hi} KB` : lo ? `with a size of at least ${lo} KB` : `with a size of at most ${hi} KB`);
  }
  if (p.categories?.length) out.push(`assigned to the ${orList(p.categories)} category`);
  return out;
}

export function describeActions(a: MessageRule["actions"] | undefined, folderName?: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  const x = a ?? {};
  if (x.moveToFolder) out.push(`move it to the ${folderName?.(x.moveToFolder) ?? "chosen"} folder`);
  if (x.copyToFolder) out.push(`copy it to the ${folderName?.(x.copyToFolder) ?? "chosen"} folder`);
  if (x.assignCategories?.length) out.push(`assign it to the ${x.assignCategories.join(", ")} category`);
  if (x.markAsRead) out.push("mark it as read");
  if (x.markImportance) out.push(`mark it as ${x.markImportance} importance`);
  if (x.forwardTo?.length) out.push(`forward it to ${addrList(x.forwardTo).join(" or ")}`);
  if (x.delete) out.push("delete it");
  if (x.stopProcessingRules) out.push("stop processing more rules");
  return out;
}

export const APPLY_PREFIX = "Apply this rule after the message arrives";

// Outlook's sentence for one rule.
export function outlookRuleSentence(r: Pick<MessageRule, "conditions" | "exceptions" | "actions">, folderName?: (id: string) => string | undefined): string {
  const when = describePredicates(r.conditions ?? {});
  const except = describePredicates(r.exceptions ?? {});
  const then = describeActions(r.actions, folderName);
  const parts = [when.length ? when.join(" and ") : "on every message", ...(except.length ? [`except if ${except.join(" or ")}`] : []), then.length ? then.join(" and ") : "do nothing"];
  return `${APPLY_PREFIX}: ${parts.join(", ")}`;
}

// The sentence for a whole label as the dialog shows it: "any" joins the
// rows with "or", "all" with "and".
export function labelSentence(label: string, c: LabelConditions, opts: { folderName?: string } = {}): string {
  const rows = completeConditions(c.conditions);
  const joiner = c.match === "all" ? " and " : " or ";
  const when = rows.map((r) => describePredicates(predicatesOfRow(r)).join(" and ")).filter(Boolean);
  const except = completeConditions(c.exceptions).map((r) => describePredicates(predicatesOfRow(r)).join(" or ")).filter(Boolean);
  const then = describeActions(ruleActions(label, opts.folderName ? { moveToFolder: "x" } : {}), () => opts.folderName);
  const parts = [when.length ? when.join(joiner) : "on every message", ...(except.length ? [`except if ${except.join(" or ")}`] : []), then.join(" and ")];
  return `${APPLY_PREFIX}: ${parts.join(", ")}`;
}

const predicatesOfRow = (r: Condition): MessageRulePredicates => {
  const { predicates, meeting } = predicatesOf([r]);
  return meeting ? { ...predicates, isMeetingRequest: true, isMeetingResponse: true } : predicates;
};

// Kept for callers that want the two halves ("when", "then").
export function summarizeRule(r: MessageRule, folderName?: (id: string) => string | undefined): { when: string; then: string } {
  const when = describePredicates(r.conditions ?? {});
  const except = describePredicates(r.exceptions ?? {});
  const then = describeActions(r.actions, folderName);
  return { when: (when.length ? when.join(" and ") : "on every message") + (except.length ? `, except if ${except.join(" or ")}` : ""), then: then.length ? then.join(" and ") : "do nothing" };
}
