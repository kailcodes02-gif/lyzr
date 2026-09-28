// "Sort Inbox now": replays the mailbox's own inbox rules, in Outlook's
// order, over every message already in the Inbox and moves each one where
// the rules would have put it on arrival. Also keeps the Calendar label's
// rules complete and at the top of the rule list, so an invitation lands in
// "Calendar invites" whoever sends it. Pure planning plus Graph calls
// through the injected GraphApi (same code against the mock in tests).
import { ensureFolder, installLabel, presetSpec, replaceLabelRules, type GraphApi, type PageOf } from "./install";
import { completeConditions, conditionsFromRules, mergeConditions, moveFolderOf, ownRules, presetConditions, RULES_PATH, withCategory } from "./labels";
import { PRESET_LABELS } from "./presets";
import type { Message, MessageRule, MessageRulePredicates } from "./types";

export const CALENDAR_LABEL = "Calendar";
export const MEETING_SCRIPTS_LABEL = "Meeting scripts";
export const RESORT_MAX = 20000;

// ---- Rule priority ------------------------------------------------------------

const isMeetingRule = (r: MessageRule) => !!(r.conditions?.isMeetingRequest || r.conditions?.isMeetingResponse);

// Rules that must run before every other rule, lowest rank first: real
// invitations and responses (whoever sends them), then the AI-recorder
// recaps, then Calendar's join-link rule (after the recaps, whose bodies can
// quote the Teams meeting they recorded).
export function priorityRank(r: MessageRule): number | undefined {
  const calendar = ownRules(CALENDAR_LABEL, [r]).length > 0;
  if (calendar && isMeetingRule(r)) return 0;
  if (ownRules(MEETING_SCRIPTS_LABEL, [r]).length) return 1;
  if (calendar) return 2;
  return undefined;
}

// The rule list with the priority rules first (ranked, then in their current
// order) and everything else after, in its current order.
export function priorityOrder(rules: MessageRule[]): MessageRule[] {
  const bySeq = [...rules].sort((a, b) => a.sequence - b.sequence);
  const ranked = bySeq.filter((r) => priorityRank(r) !== undefined).sort((a, b) => priorityRank(a)! - priorityRank(b)!);
  return [...ranked, ...bySeq.filter((r) => priorityRank(r) === undefined)];
}

// Sequence PATCHes that put the rules in priorityOrder; none when they
// already are. New numbers start after the highest existing one, so no PATCH
// ever lands on a sequence another rule still holds. Read-only rules cannot
// be renumbered and keep their place.
export function planPriority(rules: MessageRule[]): { id: string; sequence: number }[] {
  const current = [...rules].sort((a, b) => a.sequence - b.sequence).map((r) => r.id);
  const wanted = priorityOrder(rules);
  if (wanted.every((r, i) => r.id === current[i])) return [];
  let seq = rules.reduce((m, r) => Math.max(m, r.sequence ?? 0), 0);
  return wanted.filter((r) => !r.isReadOnly).map((r) => ({ id: r.id, sequence: (seq += 1) }));
}

export async function prioritizeRules(api: GraphApi): Promise<number> {
  const rules = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  const plan = planPriority(rules);
  for (const p of plan) await api.patch(`${RULES_PATH}/${p.id}`, { sequence: p.sequence });
  return plan.length;
}

// Brings a preset label up to the preset (Calendar: meeting requests and
// responses plus the join-link phrases; Meeting scripts: the recorders and
// recap subjects) without dropping rows the user added. Installs the label
// when it has no rules yet. Returns true when rules were written.
export async function ensurePresetRules(api: GraphApi, label: string, meAddress?: string): Promise<boolean> {
  const preset = PRESET_LABELS.find((p) => p.name === label)!;
  const rules = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  const folderId = moveFolderOf(label, rules);
  if (!ownRules(label, rules).length || !folderId) {
    await installLabel(api, presetSpec(preset), meAddress, false);
    return true;
  }
  const current = conditionsFromRules(label, rules);
  // "All of these" would AND the new rows into the existing rules.
  if (current.match === "all") return false;
  const merged = mergeConditions(current, presetConditions(preset).conditions);
  if (JSON.stringify(completeConditions(merged.conditions)) === JSON.stringify(completeConditions(current.conditions))) return false;
  await replaceLabelRules(api, label, merged, { moveToFolder: folderId });
  return true;
}

export const ensureCalendarRules = (api: GraphApi, meAddress?: string) => ensurePresetRules(api, CALENDAR_LABEL, meAddress);

// ---- Replaying the rules --------------------------------------------------------

type Predicates = MessageRulePredicates & Record<string, unknown>;

const present = (v: unknown) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);
const keysOf = (p?: MessageRulePredicates) => Object.entries((p ?? {}) as Predicates).filter(([, v]) => present(v)).map(([k]) => k);

// Predicates this replay can judge from a list payload. Anything else
// (sensitivity, flags, size, automatic replies...) makes the rule unknown
// here, and an unknown rule is never applied.
const EVALUABLE = new Set(["fromAddresses", "senderContains", "subjectContains", "bodyOrSubjectContains", "bodyContains", "headerContains", "recipientContains", "sentToAddresses", "isMeetingRequest", "isMeetingResponse", "sentToMe", "sentOnlyToMe", "hasAttachments", "importance", "categories"]);

const usesHeaders = (r: MessageRule) => keysOf(r.conditions).includes("headerContains") || keysOf(r.exceptions).includes("headerContains");
// Outlook stops running a rule it flags with an error, but what the rule
// asks for is still what the label means: the replay runs it anyway (and
// repairBrokenRules recreates it so Outlook runs it again on new mail).
const runs = (r: MessageRule) => r.isEnabled;
const live = (r: MessageRule) => r.isEnabled && !r.hasError;

// Headers are heavy on a whole-Inbox scan: fetched only when a header rule
// can move a message or stop the rules after it (Promotions only stamps a
// category, so it alone does not need them).
export const needsHeaders = (rules: MessageRule[]) => rules.some((r) => runs(r) && usesHeaders(r) && (!!r.actions?.moveToFolder || !!r.actions?.stopProcessingRules));

export function canReplay(r: MessageRule, withHeaders: boolean): boolean {
  const keys = [...keysOf(r.conditions), ...keysOf(r.exceptions)];
  if (!keysOf(r.conditions).length) return false;
  return keys.every((k) => EVALUABLE.has(k) && (k !== "headerContains" || withHeaders));
}

const lower = (s?: string | null) => (s ?? "").toLowerCase();
const containsAny = (hay: string, values: string[]) => values.some((v) => hay.includes(lower(v)));
const recipients = (m: Message) => [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])];
const type = (m: Message) => m["@odata.type"] ?? "";

// PR_MESSAGE_CLASS: IPM.Schedule.Meeting.Request / .Canceled / .Resp.Pos ...
// The authoritative meeting marker; @odata.type is the fallback when the
// scan did not expand it.
export const MESSAGE_CLASS_PROP = "String 0x001A";
export const messageClass = (m: Message) => m.singleValueExtendedProperties?.find((p) => p.id.toLowerCase() === MESSAGE_CLASS_PROP.toLowerCase())?.value ?? "";
export function meetingKind(m: Message): "request" | "response" | undefined {
  const cls = messageClass(m);
  if (/^IPM\.Schedule\.Meeting\.Resp/i.test(cls)) return "response";
  if (/^IPM\.Schedule\.Meeting\./i.test(cls)) return "request";
  if (/eventMessageResponse/i.test(type(m))) return "response";
  if (/eventMessage/i.test(type(m))) return "request";
  return undefined;
}

// A scanned message plus the body phrases Outlook's search found in it (the
// preview of a Teams invite is the block's underscore divider, so the join
// link is never in it).
export type ScanMessage = Message & { bodyHits?: string[] };
const bodyHas = (m: ScanMessage, list: string[]) => containsAny(lower(m.bodyPreview), list) || list.some((v) => (m.bodyHits ?? []).includes(lower(v)));

// One predicate against the message. Body predicates see the preview plus
// the search hits, so they can still miss what the server would match.
function predicateMatches(key: string, value: unknown, m: ScanMessage, me: string): boolean {
  const addr = lower(m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address);
  const list = value as string[];
  switch (key) {
    case "fromAddresses": return (value as MessageRulePredicates["fromAddresses"])!.some((a) => lower(a.emailAddress?.address) === addr);
    case "senderContains": return containsAny(`${lower(m.from?.emailAddress?.name)} ${addr}`, list);
    case "subjectContains": return containsAny(lower(m.subject), list);
    case "bodyOrSubjectContains": return containsAny(lower(m.subject), list) || bodyHas(m, list);
    case "bodyContains": return bodyHas(m, list);
    case "headerContains": return (m.internetMessageHeaders ?? []).some((h) => containsAny(`${lower(h.name)}: ${lower(h.value)}`, list));
    case "recipientContains": return recipients(m).some((r) => containsAny(`${lower(r.emailAddress.name)} ${lower(r.emailAddress.address)}`, list));
    case "sentToAddresses": return recipients(m).some((r) => (value as MessageRulePredicates["sentToAddresses"])!.some((a) => lower(a.emailAddress?.address) === lower(r.emailAddress.address)));
    // Requests cover updates and cancellations (#eventMessage, #eventMessageRequest).
    case "isMeetingRequest": return meetingKind(m) === "request";
    case "isMeetingResponse": return meetingKind(m) === "response";
    case "sentToMe": return !!me && (m.toRecipients ?? []).some((r) => lower(r.emailAddress.address) === me);
    case "sentOnlyToMe": return !!me && (m.toRecipients ?? []).length === 1 && lower(m.toRecipients![0].emailAddress.address) === me && !(m.ccRecipients ?? []).length;
    case "hasAttachments": return !!m.hasAttachments;
    case "importance": return (m.importance ?? "normal") === value;
    case "categories": return (m.categories ?? []).some((c) => list.some((v) => lower(v) === lower(c)));
    default: return false;
  }
}

// Conditions AND together; any one matching exception blocks the rule.
export function ruleMatches(r: MessageRule, m: ScanMessage, meAddress?: string): boolean {
  const me = lower(meAddress);
  const cond = (r.conditions ?? {}) as Predicates;
  const keys = keysOf(r.conditions);
  if (!keys.length || !keys.every((k) => predicateMatches(k, cond[k], m, me))) return false;
  const ex = (r.exceptions ?? {}) as Predicates;
  return !keysOf(r.exceptions).some((k) => predicateMatches(k, ex[k], m, me));
}

export type RuleOutcome = { folderId?: string; categories: string[]; rules: string[] };

// What Outlook would do with the message on arrival: the rules in sequence
// order, categories accumulated (a later rule can test them), the first move
// wins, a stop ends the run. A rule that deletes is never replayed: the
// message is left alone.
export function replayRules(m: ScanMessage, rules: MessageRule[], meAddress?: string, withHeaders = false): RuleOutcome {
  let categories = [...(m.categories ?? [])];
  let folderId: string | undefined;
  const fired: string[] = [];
  for (const r of [...rules].sort((a, b) => a.sequence - b.sequence)) {
    if (!runs(r) || !canReplay(r, withHeaders)) continue;
    if (!ruleMatches(r, { ...m, categories }, meAddress)) continue;
    const a = r.actions ?? {};
    if (a.delete) return { categories: [...(m.categories ?? [])], rules: [] };
    fired.push(r.displayName);
    for (const c of a.assignCategories ?? []) categories = withCategory(categories, c);
    if (a.moveToFolder && !folderId) folderId = a.moveToFolder;
    if (a.stopProcessingRules) break;
  }
  return { folderId, categories, rules: fired };
}

export type ResortMove = { message: Message; folderId: string; categories: string[]; rule: string };
export type ResortPlan = { moves: ResortMove[]; labelOnly: { message: Message; categories: string[] }[]; unknownRules: string[] };

const sameCats = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((c) => b.some((x) => lower(x) === lower(c)));

// Every Inbox message whose rules would have moved it (and the categories it
// should carry), plus the ones that only miss a category.
export function planResort(messages: ScanMessage[], rules: MessageRule[], meAddress?: string, withHeaders = false): ResortPlan {
  const moves: ResortMove[] = [];
  const labelOnly: ResortPlan["labelOnly"] = [];
  for (const m of messages) {
    const out = replayRules(m, rules, meAddress, withHeaders);
    if (out.folderId && out.folderId !== m.parentFolderId) moves.push({ message: m, folderId: out.folderId, categories: out.categories, rule: out.rules[0] ?? "" });
    else if (!sameCats(out.categories, m.categories)) labelOnly.push({ message: m, categories: out.categories });
  }
  const unknownRules = rules.filter((r) => runs(r) && !canReplay(r, withHeaders) && (!!r.actions?.moveToFolder || !!r.actions?.stopProcessingRules)).map((r) => r.displayName);
  return { moves, labelOnly, unknownRules };
}

// ---- Running it ---------------------------------------------------------------

const SCAN_SELECT = "id,conversationId,internetMessageId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,categories,receivedDateTime,hasAttachments,importance,parentFolderId";
const CLASS_EXPAND = `singleValueExtendedProperties($filter=id eq '${MESSAGE_CLASS_PROP}')`;
export const resortScanPath = (withHeaders: boolean) => `/me/mailFolders/inbox/messages?$select=${SCAN_SELECT}${withHeaders ? ",internetMessageHeaders" : ""}&$expand=${encodeURIComponent(CLASS_EXPAND)}&$orderby=receivedDateTime desc&$top=${withHeaders ? 100 : 250}`;

// Body phrases the rules test (conditions and exceptions of rules that can
// move or stop), each looked up with one Inbox $search.
export function bodyPhrases(rules: MessageRule[], withHeaders: boolean): string[] {
  const out = new Set<string>();
  for (const r of rules) {
    if (!runs(r) || !canReplay(r, withHeaders) || !(r.actions?.moveToFolder || r.actions?.stopProcessingRules)) continue;
    for (const p of [r.conditions, r.exceptions]) for (const v of [...(p?.bodyContains ?? []), ...(p?.bodyOrSubjectContains ?? [])]) if (v.trim()) out.add(lower(v.trim()));
  }
  return [...out];
}
export const BODY_SEARCH_MAX = 1000;
export const bodySearchPath = (phrase: string) => `/me/mailFolders/inbox/messages?$search=${encodeURIComponent(`"${phrase.replace(/"/g, "")}"`)}&$select=id,internetMessageId&$top=250`;
// Search rows carry REST ids, list rows immutable ids: they meet on internetMessageId.
const keyOf = (m: Message) => m.internetMessageId ?? m.id;

// Attaches the phrases each message's full body contains. A phrase whose
// search Graph refuses is skipped (the preview check still applies).
export async function attachBodyHits(api: GraphApi, messages: ScanMessage[], phrases: string[]): Promise<void> {
  const hits = new Map<string, string[]>();
  for (const phrase of phrases) {
    const found = await api.getAll<Message>(bodySearchPath(phrase), BODY_SEARCH_MAX).catch(() => [] as Message[]);
    for (const m of found) hits.set(keyOf(m), [...(hits.get(keyOf(m)) ?? []), phrase]);
  }
  for (const m of messages) m.bodyHits = hits.get(keyOf(m));
}

// Why Calendar may not be catching new mail, in plain words.
export function calendarHealth(rules: MessageRule[]): string[] {
  const own = ownRules(CALENDAR_LABEL, rules);
  const out: string[] = [];
  if (!own.some((r) => r.conditions?.isMeetingRequest)) out.push("There is no Calendar rule for invitations.");
  for (const r of own) {
    if (!r.isEnabled) out.push(`"${r.displayName}" is turned off, so Outlook does not run it on new mail.`);
    if (r.hasError) out.push(`Outlook reports an error on "${r.displayName}", so it does not run on new mail. Delete it here and run Sort Inbox now to recreate it.`);
  }
  const working = own.filter(live);
  if (!working.length) return out;
  const first = Math.min(...working.map((r) => r.sequence));
  for (const r of rules) if (live(r) && r.sequence < first && r.actions?.stopProcessingRules && !own.includes(r)) out.push(`"${r.displayName}" runs before Calendar and stops the rules after it.`);
  return out;
}

export type ResortStep = "calendar" | "order" | "scan" | "search" | "move";
export const RESORT_STEP_LABEL: Record<ResortStep, string> = {
  calendar: "Updating the Calendar invites and Meeting scripts rules",
  order: "Putting the Calendar rules first",
  scan: "Reading every Inbox message",
  search: "Searching message bodies for meeting links",
  move: "Moving mail to its labels",
};

export type ResortResult = {
  scanned: number;
  moved: number;
  labelled: number;
  failed: number;
  byFolder: Record<string, number>; // folder id -> messages moved there
  calendarUpdated: boolean;
  reordered: number;
  unknownRules: string[];
  // Invitations / responses still in the Inbox after the run, and why Calendar may miss new ones.
  meetingsLeft: number;
  health: string[];
  // Present when the scan hit RESORT_MAX: older Inbox mail was not checked.
  truncated?: boolean;
};

// Recreates the label rules Outlook flags with an error (same name, order,
// conditions and actions), so Outlook runs them on new mail again. Rules
// made in Outlook are left alone. Returns the names recreated.
export async function repairBrokenRules(api: GraphApi): Promise<string[]> {
  const rules = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  const out: string[] = [];
  for (const r of rules) {
    const label = r.actions?.assignCategories?.[0];
    if (!r.hasError || r.isReadOnly || !label || !ownRules(label, [r]).length) continue;
    await api.del(`${RULES_PATH}/${r.id}`);
    await api.post(RULES_PATH, { displayName: r.displayName, sequence: r.sequence, isEnabled: true, conditions: r.conditions, ...(r.exceptions ? { exceptions: r.exceptions } : {}), actions: r.actions });
    out.push(r.displayName);
  }
  return out;
}

export type PlanOutcome = { moved: number; labelled: number; failed: number; byFolder: Record<string, number>; movedIds: Set<string> };

// Categories first (a move changes the message id), then the moves.
export async function executePlan(api: GraphApi, plan: ResortPlan): Promise<PlanOutcome> {
  const stamp = [...plan.labelOnly, ...plan.moves].filter((x) => !sameCats(x.categories, x.message.categories));
  const failedIds = new Set<string>();
  if (stamp.length) {
    const res = await api.batch(stamp.map((x) => ({ id: x.message.id, method: "PATCH", url: `/me/messages/${x.message.id}`, body: { categories: x.categories } })));
    for (const f of res.failed) failedIds.add(f.id);
  }
  const byFolder: Record<string, number> = {};
  const movedIds = new Set<string>();
  if (plan.moves.length) {
    const res = await api.batch(plan.moves.map((x) => ({ id: x.message.id, method: "POST", url: `/me/messages/${x.message.id}/move`, body: { destinationId: x.folderId } })));
    const bad = new Set(res.failed.map((f) => f.id));
    for (const x of plan.moves) {
      if (bad.has(x.message.id)) continue;
      movedIds.add(x.message.id);
      byFolder[x.folderId] = (byFolder[x.folderId] ?? 0) + 1;
    }
    for (const id of bad) failedIds.add(id);
  }
  const labelled = plan.labelOnly.filter((x) => !failedIds.has(x.message.id)).length;
  return { moved: movedIds.size, labelled, failed: failedIds.size, byFolder, movedIds };
}

// New mail since `sinceIso`: read with the full body (at most 50 messages,
// so one page), replayed against the rules and moved. The body replaces the
// $search pass: every rule phrase is checked against it directly.
export const NEW_MAIL_MAX = 50;
export const newMailPath = (sinceIso: string) =>
  `/me/mailFolders/inbox/messages?$select=${SCAN_SELECT},body&$expand=${encodeURIComponent(CLASS_EXPAND)}&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}&$orderby=receivedDateTime desc&$top=${NEW_MAIL_MAX}`;

export async function sortNewMail(api: GraphApi, sinceIso: string, meAddress?: string): Promise<PlanOutcome & { scanned: number }> {
  const rules = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  const withHeaders = needsHeaders(rules);
  const fresh = await api.get<PageOf<ScanMessage>>(newMailPath(sinceIso)).then((p) => p.value);
  const phrases = bodyPhrases(rules, withHeaders);
  for (const m of fresh) {
    const body = lower(m.body?.content);
    m.bodyHits = phrases.filter((ph) => body.includes(ph));
    delete m.body;
  }
  const out = await executePlan(api, planResort(fresh, rules, meAddress, withHeaders));
  return { ...out, scanned: fresh.length };
}

// The whole "Sort Inbox now": Calendar rules complete and first, then every
// Inbox message replayed against the rules; categories are PATCHed before
// the move (a move changes the message id).
export async function resortInbox(api: GraphApi, meAddress?: string, onStep: (s: ResortStep) => void = () => {}): Promise<ResortResult> {
  onStep("calendar");
  const calendarUpdated = await ensureCalendarRules(api, meAddress);
  await ensurePresetRules(api, MEETING_SCRIPTS_LABEL, meAddress).catch(() => false);
  await repairBrokenRules(api).catch(() => []);
  onStep("order");
  const reordered = await prioritizeRules(api);
  const rules = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value);
  // The Calendar folder must exist for its rules to move anything.
  if (!moveFolderOf(CALENDAR_LABEL, rules)) await ensureFolder(api, PRESET_LABELS.find((p) => p.name === CALENDAR_LABEL)!.folderName!);
  onStep("scan");
  const withHeaders = needsHeaders(rules);
  const inbox = await api.getAll<ScanMessage>(resortScanPath(withHeaders), RESORT_MAX);
  onStep("search");
  await attachBodyHits(api, inbox, bodyPhrases(rules, withHeaders));
  const plan = planResort(inbox, rules, meAddress, withHeaders);
  onStep("move");
  const { moved, labelled, failed, byFolder, movedIds } = await executePlan(api, plan);
  // Rules as they stand after the repair, for the health lines.
  const after = await api.get<PageOf<MessageRule>>(RULES_PATH).then((p) => p.value).catch(() => rules);
  const meetingsLeft = inbox.filter((m) => meetingKind(m) && !movedIds.has(m.id)).length;
  return { scanned: inbox.length, moved, labelled, failed, byFolder, calendarUpdated, reordered, unknownRules: plan.unknownRules, meetingsLeft, health: calendarHealth(after), ...(inbox.length >= RESORT_MAX ? { truncated: true } : {}) };
}
