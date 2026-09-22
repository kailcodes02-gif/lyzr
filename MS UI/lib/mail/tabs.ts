// "Move to tab" (Gmail's Primary / Social / Promotions) on top of the two
// Outlook categories the sorting rules assign. Moving is a categories PATCH:
// the target category is added, the other sorting category removed, and
// Primary means neither. "Always for this sender" is one inbox rule on the
// exact address, placed before the "Sorting: Social/Promotions" rules; Graph
// rules cannot remove a category, so the Primary rule assigns nothing and
// stops processing before the sorting rules can run. Pure functions only.
import type { GraphApi } from "./install";
import { isSortingRule, maxSequence, PROMOTIONS_LABEL, RULES_PATH, SOCIAL_LABEL, SORTING_RULE_PREFIX, summarizeRule } from "./labels";
import type { Message, MessageRule } from "./types";
import type { MailTab } from "./url";

export type TabTarget = MailTab;

export const TAB_LABEL: Record<TabTarget, string> = { primary: "Primary", social: "Social", promotions: "Promotions" };
export const TAB_CATEGORY: Record<TabTarget, string | undefined> = { primary: undefined, social: SOCIAL_LABEL, promotions: PROMOTIONS_LABEL };
export const TAB_TARGETS: TabTarget[] = ["primary", "social", "promotions"];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isSortingCategory = (c: string) => same(c, SOCIAL_LABEL) || same(c, PROMOTIONS_LABEL);

// The tab a message shows in: Social wins when a message somehow carries both.
export function tabOf(m: Pick<Message, "categories">): TabTarget {
  const cats = m.categories ?? [];
  if (cats.some((c) => same(c, SOCIAL_LABEL))) return "social";
  if (cats.some((c) => same(c, PROMOTIONS_LABEL))) return "promotions";
  return "primary";
}

// The categories a message must carry to show in `target`, other labels kept.
export function categoriesForTab(existing: string[] | undefined, target: TabTarget): string[] {
  const kept = (existing ?? []).filter((c) => !isSortingCategory(c));
  const add = TAB_CATEGORY[target];
  return add ? [...kept, add] : kept;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// One update per message whose categories actually change.
export function tabMoveUpdates(messages: Message[], target: TabTarget): { id: string; categories: string[] }[] {
  const out: { id: string; categories: string[] }[] = [];
  for (const m of messages) {
    const next = categoriesForTab(m.categories, target);
    if (!sameSet(m.categories ?? [], next)) out.push({ id: m.id, categories: next });
  }
  return out;
}

// The one sender address behind a move (for "Do this for all mail from X?");
// undefined when the messages come from several senders or none.
export function singleSender(messages: Message[]): string | undefined {
  const addrs = new Set(messages.map((m) => (m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address ?? "").trim().toLowerCase()).filter(Boolean));
  return addrs.size === 1 ? [...addrs][0] : undefined;
}

// ---- Per-sender rules -------------------------------------------------------

export const senderRuleName = (target: TabTarget, address: string) => `${SORTING_RULE_PREFIX}${TAB_LABEL[target]} (${address.trim().toLowerCase()})`;

// The rule body: exact address (never the domain). Into Social / Promotions
// it assigns that category; into Primary it assigns nothing. Both stop
// processing so the "Sorting: Social/Promotions" rules never re-sort the sender.
export function senderRule(target: TabTarget, address: string): Omit<MessageRule, "id" | "sequence"> {
  const addr = address.trim().toLowerCase();
  const cat = TAB_CATEGORY[target];
  return {
    displayName: senderRuleName(target, addr),
    isEnabled: true,
    conditions: { fromAddresses: [{ emailAddress: { address: addr } }] },
    // No empty assignCategories for Primary: Graph may reject an empty array.
    actions: cat ? { assignCategories: [cat], stopProcessingRules: true } : { stopProcessingRules: true },
  };
}

// Parses a rule this module created: "Sorting: <Tab> (<address>)" with a
// single fromAddresses predicate. Anything else is not a sender rule.
export function parseSenderRule(r: MessageRule): { target: TabTarget; address: string } | undefined {
  const m = /^Sorting: (Primary|Social|Promotions) \((.+)\)$/i.exec(r.displayName.trim());
  if (!m) return undefined;
  const from = r.conditions?.fromAddresses ?? [];
  if (from.length !== 1 || !from[0].emailAddress?.address) return undefined;
  const target = m[1].toLowerCase() as TabTarget;
  const address = from[0].emailAddress.address.trim().toLowerCase();
  if (address !== m[2].trim().toLowerCase()) return undefined;
  return { target, address };
}

export const isSenderRule = (r: MessageRule) => parseSenderRule(r) !== undefined;

// Every sender rule for an address, whatever its tab (a move to Social after
// "always Primary" replaces the Primary rule).
export function senderRulesFor(address: string, rules: MessageRule[]): MessageRule[] {
  const addr = address.trim().toLowerCase();
  return rules.filter((r) => parseSenderRule(r)?.address === addr);
}

// Where the new rule goes: before every "Sorting: " rule (the two tab rules
// and other sender rules), pushing them down by one, highest first; with a
// read-only rule in the way it is appended after the last rule instead.
export function planSenderRuleInsert(existing: MessageRule[]): { sequence: number; renumber: { id: string; sequence: number }[] } {
  const sorting = existing.filter(isSortingRule);
  if (!sorting.length) return { sequence: maxSequence(existing) + 1, renumber: [] };
  const at = Math.min(...sorting.map((r) => r.sequence));
  if (existing.some((r) => r.isReadOnly && r.sequence >= at)) return { sequence: maxSequence(existing) + 1, renumber: [] };
  const renumber = existing
    .filter((r) => r.sequence >= at)
    .sort((a, b) => b.sequence - a.sequence)
    .map((r) => ({ id: r.id, sequence: r.sequence + 1 }));
  return { sequence: at, renumber };
}

// Creates (or replaces) the sender's rule against Graph: older sender rules
// for the address are deleted first, then the block is renumbered and the
// new rule inserted before the sorting rules. Returns the created rule.
export async function alwaysSortSender(api: GraphApi, target: TabTarget, address: string): Promise<MessageRule> {
  const all = await api.get<{ value: MessageRule[] }>(RULES_PATH).then((p) => p.value);
  const old = senderRulesFor(address, all);
  for (const r of old) await api.del(`${RULES_PATH}/${r.id}`);
  const rest = all.filter((r) => !old.includes(r));
  const plan = planSenderRuleInsert(rest);
  for (const p of plan.renumber) await api.patch(`${RULES_PATH}/${p.id}`, { sequence: p.sequence });
  return api.post<MessageRule>(RULES_PATH, { ...senderRule(target, address), sequence: plan.sequence });
}

// Filters dialog line: sender rules read as a sentence, the rest as
// "When ..., then ...".
export function ruleSentence(r: MessageRule, folderName?: (id: string) => string | undefined): string {
  const s = parseSenderRule(r);
  if (s) return s.target === "primary" ? `Always keep mail from ${s.address} in Primary.` : `Always put mail from ${s.address} in ${TAB_LABEL[s.target]}.`;
  const { when, then } = summarizeRule(r, folderName);
  return `When ${when}, then ${then}.`;
}
