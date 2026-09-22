import { describe, expect, it } from "vitest";
import { mockRules } from "@/lib/mock/mail";
import { enableSorting } from "../hooks";
import { backfillLabel } from "../install";
import { isSortingRule, SORTING_RULES } from "../labels";
import { alwaysSortSender, categoriesForTab, isSenderRule, parseSenderRule, planSenderRuleInsert, ruleSentence, senderRule, senderRuleName, senderRulesFor, singleSender, tabMoveUpdates, tabOf } from "../tabs";
import type { Message, MessageRule } from "../types";
import { mockApi } from "./helpers";

const msg = (id: string, categories?: string[], addr = "x@example.com"): Message => ({ id, categories, from: { emailAddress: { name: "X", address: addr } } });

describe("tab category math", () => {
  it("derives the tab from the sorting categories, Social first", () => {
    expect(tabOf(msg("1"))).toBe("primary");
    expect(tabOf(msg("1", ["GSI"]))).toBe("primary");
    expect(tabOf(msg("1", ["social"]))).toBe("social");
    expect(tabOf(msg("1", ["Promotions"]))).toBe("promotions");
    expect(tabOf(msg("1", ["Promotions", "Social"]))).toBe("social");
  });
  it("adds the target category, drops the other one and keeps every other label", () => {
    expect(categoriesForTab(["GSI", "Social"], "primary")).toEqual(["GSI"]);
    expect(categoriesForTab(["Promotions"], "social")).toEqual(["Social"]);
    expect(categoriesForTab(["GSI", "Social", "Promotions"], "promotions")).toEqual(["GSI", "Promotions"]);
    expect(categoriesForTab(undefined, "primary")).toEqual([]);
    expect(categoriesForTab(undefined, "social")).toEqual(["Social"]);
  });
  it("updates only the messages whose categories change", () => {
    const updates = tabMoveUpdates([msg("a", ["Social"]), msg("b", []), msg("c", ["GSI", "Promotions"])], "primary");
    expect(updates).toEqual([{ id: "a", categories: [] }, { id: "c", categories: ["GSI"] }]);
    expect(tabMoveUpdates([msg("a", ["Social"])], "social")).toEqual([]);
  });
  it("names the single sender behind a move, or none for a mixed selection", () => {
    expect(singleSender([msg("a", [], "Mayuri.Murthy@linkedin.com"), msg("b", [], "mayuri.murthy@linkedin.com")])).toBe("mayuri.murthy@linkedin.com");
    expect(singleSender([msg("a", [], "a@x.com"), msg("b", [], "b@x.com")])).toBeUndefined();
    expect(singleSender([])).toBeUndefined();
  });
});

describe("per-sender rules", () => {
  it("builds a stop rule on the exact address: Primary assigns nothing, a tab assigns its category", () => {
    const primary = senderRule("primary", " Mayuri.Murthy@linkedin.com ");
    expect(primary).toEqual({
      displayName: "Sorting: Primary (mayuri.murthy@linkedin.com)",
      isEnabled: true,
      conditions: { fromAddresses: [{ emailAddress: { address: "mayuri.murthy@linkedin.com" } }] },
      actions: { stopProcessingRules: true },
    });
    expect(senderRule("social", "a@b.com").actions).toEqual({ assignCategories: ["Social"], stopProcessingRules: true });
    expect(senderRule("promotions", "a@b.com").actions).toEqual({ assignCategories: ["Promotions"], stopProcessingRules: true });
    expect(senderRuleName("promotions", "A@B.com")).toBe("Sorting: Promotions (a@b.com)");
    // Never the domain.
    expect(JSON.stringify(primary.conditions)).not.toContain("senderContains");
  });
  it("recognises its own rules and nothing else", () => {
    const own: MessageRule = { id: "1", sequence: 1, ...senderRule("primary", "a@b.com") };
    expect(parseSenderRule(own)).toEqual({ target: "primary", address: "a@b.com" });
    expect(isSenderRule(own)).toBe(true);
    expect(isSortingRule(own)).toBe(true);
    const social: MessageRule = { id: "2", sequence: 2, ...SORTING_RULES[0] };
    expect(parseSenderRule(social)).toBeUndefined();
    const renamed: MessageRule = { ...own, displayName: "Sorting: Primary (someone@else.com)" };
    expect(parseSenderRule(renamed)).toBeUndefined();
    const domain: MessageRule = { ...own, conditions: { senderContains: ["a@b.com"] } };
    expect(parseSenderRule(domain)).toBeUndefined();
    expect(senderRulesFor("A@B.COM", [own, social])).toEqual([own]);
  });
  it("inserts before the first Sorting: rule and pushes the rest down, highest first", () => {
    const mk = (id: string, name: string, sequence: number, isReadOnly = false): MessageRule => ({ id, displayName: name, sequence, isEnabled: true, isReadOnly });
    const existing = [mk("a", "Weekly reports", 1), mk("l", "Label: GSI (senders)", 2), mk("s1", "Sorting: Social", 3), mk("s2", "Sorting: Promotions", 4)];
    expect(planSenderRuleInsert(existing)).toEqual({ sequence: 3, renumber: [{ id: "s2", sequence: 5 }, { id: "s1", sequence: 4 }] });
    expect(planSenderRuleInsert([mk("a", "Weekly reports", 1)])).toEqual({ sequence: 2, renumber: [] });
    expect(planSenderRuleInsert([])).toEqual({ sequence: 1, renumber: [] });
    expect(planSenderRuleInsert([...existing, mk("ro", "Tenant policy", 4, true)])).toEqual({ sequence: 5, renumber: [] });
  });
  it("summarises sender rules as a sentence and other rules as Outlook phrases them", () => {
    expect(ruleSentence({ id: "1", sequence: 1, ...senderRule("primary", "mayuri.murthy@linkedin.com") })).toBe("Always keep mail from mayuri.murthy@linkedin.com in Primary.");
    expect(ruleSentence({ id: "1", sequence: 1, ...senderRule("social", "a@b.com") })).toBe("Always put mail from a@b.com in Social.");
    expect(ruleSentence({ id: "2", displayName: "x", sequence: 1, isEnabled: true, conditions: { subjectContains: ["report"] }, actions: { moveToFolder: "f" } }, () => "Reports")).toBe("Apply this rule after the message arrives: with 'report' in the subject, move it to the Reports folder");
  });
  it("against the demo mailbox: the Primary rule lands before Sorting: Social and a later move replaces it", async () => {
    const api = mockApi();
    await enableSorting(api, (label, c) => backfillLabel(api, label, c));
    const before = mockRules.find((r) => r.displayName === "Sorting: Social")!.sequence;
    const created = await alwaysSortSender(api, "primary", "mayuri.murthy@linkedin.com");
    expect(created.sequence).toBe(before);
    expect(created.actions).toEqual({ stopProcessingRules: true });
    const social = mockRules.find((r) => r.displayName === "Sorting: Social")!;
    const promos = mockRules.find((r) => r.displayName === "Sorting: Promotions")!;
    expect(social.sequence).toBe(before + 1);
    expect(promos.sequence).toBe(before + 2);
    expect(created.sequence).toBeLessThan(social.sequence);
    // Sequences stay unique.
    expect(new Set(mockRules.map((r) => r.sequence)).size).toBe(mockRules.length);
    // Moving the sender to Promotions "always": one rule per address, the Primary one gone.
    const again = await alwaysSortSender(api, "promotions", "mayuri.murthy@linkedin.com");
    const mine = mockRules.filter((r) => parseSenderRule(r)?.address === "mayuri.murthy@linkedin.com");
    expect(mine.map((r) => r.id)).toEqual([again.id]);
    expect(again.actions).toEqual({ assignCategories: ["Promotions"], stopProcessingRules: true });
    expect(again.sequence).toBeLessThan(mockRules.find((r) => r.displayName === "Sorting: Social")!.sequence);
  });
});
