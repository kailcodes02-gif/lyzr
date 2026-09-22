// Labels with conditions: Gmail-style filters emulated with Outlook inbox
// rules (messageRule) that assign an Outlook category and, for "skip the
// inbox" labels, move the message into a folder of the same name. Pure
// functions only; hooks live in ./hooks.ts, Graph calls in ./install.ts.
import { sortableFilter } from "./logic";
import { PRESET_LABELS, SORTING_PRESETS, type PresetLabel } from "./presets";
import type { Message, MessageRule, MessageRulePredicates } from "./types";

// ---- Conditions <-> rules -------------------------------------------------

export type LabelConditions = {
  from: string[]; // full addresses (siva@lyzr.ai) or domains/keywords (@accenture.com, accenture)
  subject: string[];
  meetings: boolean; // calendar invitations and responses
  newsletters: boolean; // has a List-Unsubscribe header
  toMe: boolean; // sent only to me (rule predicate sentOnlyToMe)
  exceptFrom?: string[]; // never match these senders (rule `exceptions.senderContains`)
};

export const EMPTY_CONDITIONS: LabelConditions = { from: [], subject: [], meetings: false, newsletters: false, toMe: false };

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

// One rule per condition group, because Graph ANDs predicates inside a rule.
// Each rule gets its own sequence, starting after `maxSequence`.
export function rulesForLabel(label: string, c: LabelConditions, maxSequence: number, opts: RuleOptions = {}): Omit<MessageRule, "id">[] {
  const out: Omit<MessageRule, "id">[] = [];
  const actions = ruleActions(label, opts);
  const exceptFrom = (c.exceptFrom ?? []).map((s) => s.trim()).filter(Boolean);
  const exceptions = exceptFrom.length ? { senderContains: exceptFrom } : undefined;
  let seq = Math.max(0, Math.floor(maxSequence));
  const push = (group: string, conditions: MessageRulePredicates) => {
    seq += 1;
    out.push({ displayName: ruleName(label, group), sequence: seq, isEnabled: true, conditions, ...(exceptions ? { exceptions } : {}), actions });
  };
  const addresses = c.from.map((s) => s.trim()).filter(isFullAddress);
  const keywords = c.from.map((s) => s.trim()).filter((s) => s && !isFullAddress(s));
  if (addresses.length) push("senders", { fromAddresses: addresses.map((address) => ({ emailAddress: { address } })) });
  if (keywords.length) push("sender keywords", { senderContains: keywords });
  const subjects = c.subject.map((s) => s.trim()).filter(Boolean);
  if (subjects.length) push("subject", { subjectContains: subjects });
  if (c.meetings) {
    push("invitations", { isMeetingRequest: true });
    push("responses", { isMeetingResponse: true });
  }
  if (c.newsletters) push("newsletters", { headerContains: ["List-Unsubscribe"] });
  // sentOnlyToMe: the owner is the only recipient (sentToMe would match any
  // mail that lists the owner in To, whatever the recipient count).
  if (c.toMe) push("only to me", { sentOnlyToMe: true });
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

// De-duplicates case-insensitively, keeping the first spelling seen; a value
// listed in `spellings` takes that spelling (the one the user typed).
export function uniqueSpellings(values: string[], spellings: string[] = []): string[] {
  const preferred = new Map(spellings.map((s) => [s.toLowerCase(), s]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(preferred.get(k) ?? v);
  }
  return out;
}

// Rebuilds the dialog state from a label's own rules. Graph echoes predicate
// strings upper-cased (senderContains ['adele'] comes back as ['ADELE']), so
// values are matched case-insensitively and `spellings` (the preset's or the
// dialog's own values) restores the casing the user knows.
export function conditionsFromRules(label: string, rules: MessageRule[], spellings: string[] = presetSpellings(label)): LabelConditions {
  const c: LabelConditions = { from: [], subject: [], meetings: false, newsletters: false, toMe: false };
  const except: string[] = [];
  for (const r of ownRules(label, rules)) {
    const p = r.conditions ?? {};
    for (const a of p.fromAddresses ?? []) if (a.emailAddress?.address) c.from.push(a.emailAddress.address);
    for (const s of p.senderContains ?? []) c.from.push(s);
    for (const s of p.subjectContains ?? []) c.subject.push(s);
    if (p.isMeetingRequest || p.isMeetingResponse) c.meetings = true;
    if ((p.headerContains ?? []).some((h) => h.toLowerCase() === "list-unsubscribe")) c.newsletters = true;
    if (p.sentToMe || p.sentOnlyToMe) c.toMe = true;
    for (const s of r.exceptions?.senderContains ?? []) except.push(s);
  }
  c.from = uniqueSpellings(c.from.map((s) => (isFullAddress(s) ? s.toLowerCase() : s)), spellings);
  c.subject = uniqueSpellings(c.subject, spellings);
  if (except.length) c.exceptFrom = uniqueSpellings(except.map((s) => s.toLowerCase()), spellings);
  return c;
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

// Client-side approximation of the rules. Newsletter and sent-only-to-me
// toggles are only honoured when the list payload carries the information.
export function matchesConditions(m: Message, c: LabelConditions, meAddress?: string): boolean {
  if ((c.exceptFrom ?? []).some((p) => senderMatches(m, p))) return false;
  if (c.from.some((p) => senderMatches(m, p))) return true;
  const subject = (m.subject ?? "").toLowerCase();
  if (c.subject.some((s) => s.trim() && subject.includes(s.trim().toLowerCase()))) return true;
  if (c.meetings && isMeetingMail(m)) return true;
  if (c.newsletters && hasUnsubscribeHeader(m)) return true;
  if (c.toMe && meAddress) {
    const to = m.toRecipients ?? [];
    if (to.length === 1 && (to[0].emailAddress.address ?? "").toLowerCase() === meAddress.toLowerCase()) return true;
  }
  return false;
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
  return {
    from: [...(p.conditions.fromAddresses ?? []), ...(p.conditions.senderContains ?? [])],
    subject: [...(p.conditions.subjectContains ?? [])],
    meetings: !!p.conditions.meetingRequests,
    newsletters: !!p.conditions.newsletters,
    toMe: false,
  };
}

// The spellings a preset label was installed with, for conditionsFromRules.
export function presetSpellings(label: string): string[] {
  const p = [...PRESET_LABELS, ...SORTING_PRESETS].find((x) => sameName(x.name, label));
  if (!p) return [];
  const c = presetConditions(p);
  return [...c.from, ...c.subject];
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
export const PROMOTIONS_CONDITIONS: LabelConditions = { ...presetConditions(promotionsPreset), exceptFrom: SOCIAL_SENDERS };

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

// ---- Rule summary (Filters dialog) ----------------------------------------

function describePredicates(p: MessageRulePredicates): string[] {
  const when: string[] = [];
  if (p.fromAddresses?.length) when.push(`from ${p.fromAddresses.map((a) => a.emailAddress?.address ?? "").filter(Boolean).join(", ")}`);
  if (p.senderContains?.length) when.push(`sender contains ${p.senderContains.join(", ")}`);
  if (p.subjectContains?.length) when.push(`subject contains ${p.subjectContains.join(", ")}`);
  if (p.bodyOrSubjectContains?.length) when.push(`subject or body contains ${p.bodyOrSubjectContains.join(", ")}`);
  if (p.headerContains?.length) when.push(p.headerContains.some((h) => /list-unsubscribe/i.test(h)) ? "is a newsletter" : `header contains ${p.headerContains.join(", ")}`);
  if (p.recipientContains?.length) when.push(`recipient contains ${p.recipientContains.join(", ")}`);
  if (p.isMeetingRequest) when.push("is a calendar invitation");
  if (p.isMeetingResponse) when.push("is a calendar response");
  if (p.sentToMe) when.push("sent to me");
  if (p.sentOnlyToMe) when.push("sent only to me");
  if (p.hasAttachments) when.push("has attachments");
  if (p.importance) when.push(`importance is ${p.importance}`);
  if (p.categories?.length) when.push(`labelled ${p.categories.join(", ")}`);
  return when;
}

export function summarizeRule(r: MessageRule, folderName?: (id: string) => string | undefined): { when: string; then: string } {
  const when = describePredicates(r.conditions ?? {});
  const except = describePredicates(r.exceptions ?? {});
  const a = r.actions ?? {};
  const then: string[] = [];
  if (a.assignCategories?.length) then.push(`label ${a.assignCategories.join(", ")}`);
  if (a.moveToFolder) then.push(`move to ${folderName?.(a.moveToFolder) ?? "a folder"}`);
  if (a.copyToFolder) then.push(`copy to ${folderName?.(a.copyToFolder) ?? "a folder"}`);
  if (a.markAsRead) then.push("mark as read");
  if (a.markImportance) then.push(`mark ${a.markImportance} importance`);
  if (a.delete) then.push("delete");
  if (a.forwardTo?.length) then.push(`forward to ${a.forwardTo.map((x) => x.emailAddress?.address ?? "").join(", ")}`);
  if (a.stopProcessingRules) then.push("stop other rules");
  const whenText = (when.length ? when.join(" and ") : "every message") + (except.length ? ` (except ${except.join(" or ")})` : "");
  return { when: whenText, then: then.length ? then.join(", ") : "do nothing" };
}
