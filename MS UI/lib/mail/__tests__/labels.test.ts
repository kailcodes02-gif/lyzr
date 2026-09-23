import { describe, expect, it } from "vitest";
import { handleMail, mockRules } from "@/lib/mock/mail";
import { backfillTargets, conditionsFromRules, EMPTY_CONDITIONS, simpleConditions as S, labelSentence, outlookRuleSentence, predicatesOf, conditionsOfPredicates, type Condition, escapeOData, folderByNamePath, foreignRules, inboxTabPath, isOwnRule, labelListPath, labelSaveBlocked, matchesConditions, moveFolderOf, ownRules, planLabelInsert, presetSpellings, PROMOTIONS_CONDITIONS, rulesForLabel, rulesOfLabel, senderMatches, SOCIAL_CONDITIONS, SOCIAL_SENDERS, SORTING_RULES, summarizeRule, tabFilter, uniqueSpellings, withCategory, withoutCategory } from "../labels";
import { SORTING_PRESETS } from "../presets";
import type { Message, MessageRule } from "../types";
import { backfillLabel } from "../install";
import { mockApi, type Page } from "./helpers";

const msg = (p: Partial<Message> & { addr?: string; name?: string }): Message => ({ id: p.id ?? Math.random().toString(36), from: { emailAddress: { name: p.name ?? "Someone", address: p.addr ?? "x@example.com" } }, ...p });

describe("rulesForLabel", () => {
  it("creates one rule per condition group with sequences after the max", () => {
    const rules = rulesForLabel("GSI", S({ from: ["siva@lyzr.ai", "@accenture.com", "infosys"], subject: ["partner"], meetings: true, newsletters: true, toMe: true }), 3);
    expect(rules.map((r) => r.displayName)).toEqual(["Label: GSI (senders)", "Label: GSI (sender keywords)", "Label: GSI (subject)", "Label: GSI (invitations)", "Label: GSI (responses)", "Label: GSI (newsletters)", "Label: GSI (only to me)"]);
    expect(rules.map((r) => r.sequence)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(rules[0].conditions).toEqual({ fromAddresses: [{ emailAddress: { address: "siva@lyzr.ai" } }] });
    expect(rules[1].conditions).toEqual({ senderContains: ["@accenture.com", "infosys"] });
    expect(rules[2].conditions).toEqual({ subjectContains: ["partner"] });
    expect(rules[3].conditions).toEqual({ isMeetingRequest: true });
    expect(rules[5].conditions).toEqual({ headerContains: ["List-Unsubscribe"] });
    // sentOnlyToMe: the owner must be the only recipient (sentToMe matches any mail listing the owner in To)
    expect(rules[6].conditions).toEqual({ sentOnlyToMe: true });
    for (const r of rules) expect(r.actions).toEqual({ assignCategories: ["GSI"], stopProcessingRules: false });
    for (const r of rules) expect(r.exceptions).toBeUndefined();
  });
  it("skip-inbox rules move into the folder and stop other rules; exceptions become senderContains exceptions", () => {
    const rules = rulesForLabel("Leadership", S({ from: ["siva@lyzr.ai"], newsletters: true }), 0, { moveToFolder: "f-lead" });
    expect(rules).toHaveLength(2);
    for (const r of rules) expect(r.actions).toEqual({ assignCategories: ["Leadership"], moveToFolder: "f-lead", stopProcessingRules: true });
    const [promo] = rulesForLabel("Promotions", PROMOTIONS_CONDITIONS, 0);
    expect(promo.conditions).toEqual({ headerContains: ["List-Unsubscribe"] });
    expect(promo.exceptions).toEqual({ senderContains: SOCIAL_SENDERS });
    expect(SOCIAL_SENDERS).toEqual(SORTING_PRESETS[0].conditions.senderContains);
    expect(SORTING_RULES[1].exceptions).toEqual({ senderContains: SOCIAL_SENDERS });
    expect(SORTING_RULES[0].conditions).toEqual({ senderContains: SOCIAL_SENDERS });
  });
  it("places label rules before the sorting rules and renumbers what follows, highest first", () => {
    const mk = (id: string, name: string, sequence: number): MessageRule => ({ id, displayName: name, sequence, isEnabled: true });
    const existing = [mk("a", "Weekly reports", 1), mk("s1", "Sorting: Social", 2), mk("s2", "Sorting: Promotions", 3), mk("b", "Label: GSI (senders)", 4)];
    expect(planLabelInsert(existing, 2)).toEqual({ start: 2, renumber: [{ id: "b", sequence: 6 }, { id: "s2", sequence: 5 }, { id: "s1", sequence: 4 }] });
    expect(planLabelInsert([mk("a", "Weekly reports", 1)], 2)).toEqual({ start: 2, renumber: [] });
    expect(planLabelInsert(existing, 0).renumber).toEqual([]);
    const bodies = rulesForLabel("Leadership", S({ from: ["siva@lyzr.ai", "lyzr"] }), planLabelInsert(existing, 2).start - 1, { moveToFolder: "f" });
    expect(bodies.map((r) => r.sequence)).toEqual([2, 3]);
  });
  it("never reuses a read-only rule's sequence: with one at or after the sorting rules the block is appended", () => {
    const mk = (id: string, name: string, sequence: number, isReadOnly = false): MessageRule => ({ id, displayName: name, sequence, isEnabled: true, isReadOnly });
    const existing = [mk("a", "Weekly reports", 1), mk("s1", "Sorting: Social", 2), mk("ro", "Tenant policy", 2, true), mk("s2", "Sorting: Promotions", 3)];
    const plan = planLabelInsert(existing, 2);
    expect(plan).toEqual({ start: 4, renumber: [] });
    const taken = new Set(existing.map((r) => r.sequence));
    for (const r of rulesForLabel("Leadership", S({ from: ["siva@lyzr.ai", "lyzr"] }), plan.start - 1)) expect(taken.has(r.sequence)).toBe(false);
    // A read-only rule before the insertion point changes nothing.
    const before = [mk("ro", "Tenant policy", 1, true), mk("s1", "Sorting: Social", 2)];
    expect(planLabelInsert(before, 1)).toEqual({ start: 2, renumber: [{ id: "s1", sequence: 3 }] });
    // Read-only rules after the block: appended, since the PATCH that would push them down is refused.
    const after = [mk("s1", "Sorting: Social", 1), mk("ro", "Tenant policy", 5, true)];
    expect(planLabelInsert(after, 1)).toEqual({ start: 6, renumber: [] });
  });
  it("de-duplicates Graph's upper-cased predicate strings case-insensitively and restores the known spelling", () => {
    expect(uniqueSpellings(["RECAP:", "Recap:", "Meeting notes", "MEETING NOTES"])).toEqual(["Recap:", "Meeting notes"]);
    expect(uniqueSpellings(["RECAP:", "MEETING NOTES"], ["Recap:", "Meeting notes"])).toEqual(["Recap:", "Meeting notes"]);
    const own = (id: string, group: string, conditions: MessageRule["conditions"]): MessageRule => ({ id, displayName: `Label: Meeting scripts (${group})`, sequence: 1, isEnabled: true, conditions, actions: { assignCategories: ["Meeting scripts"], stopProcessingRules: false } });
    const echoed = [
      own("1", "subject", { subjectContains: ["MEETING SUMMARY", "RECAP:", "Recap:"] }),
      own("2", "sender keywords", { senderContains: ["FIREFLIES.AI", "Fireflies.ai"] }),
      own("3", "senders", { fromAddresses: [{ emailAddress: { address: "Fred@Fireflies.ai" } }, { emailAddress: { address: "fred@fireflies.ai" } }] }),
    ];
    // The preset's spelling wins for its own values; unknown ones keep the first spelling seen; addresses are lower-cased.
    const c = conditionsFromRules("Meeting scripts", echoed);
    const of = (kind: string, x = c) => x.conditions.find((r) => r.kind === kind)?.values;
    expect(of("subjectContains")).toEqual(["Meeting summary", "Recap:"]);
    expect(of("fromContains")).toEqual(["fireflies.ai"]);
    expect(of("fromIs")).toEqual(["fred@fireflies.ai"]);
    expect(c.match).toBe("any");
    expect(presetSpellings("meeting SCRIPTS")).toContain("Meeting summary");
    expect(presetSpellings("Nope")).toEqual([]);
    // Explicit spellings (the dialog's current chips) override.
    expect(of("subjectContains", conditionsFromRules("Meeting scripts", echoed, ["recap:"]))).toEqual(["MEETING SUMMARY", "recap:"]);
    const exc: MessageRule = { ...own("4", "newsletters", { headerContains: ["List-Unsubscribe"] }), exceptions: { senderContains: ["LINKEDIN.COM", "linkedin.com"] } };
    expect(conditionsFromRules("Meeting scripts", [exc]).exceptions).toEqual([{ kind: "fromContains", values: ["linkedin.com"] }]);
  });
  it("blocks Save while editing until the rules loaded, and for good when they failed to load", () => {
    const base = { name: "GSI", busy: false, editing: true, loaded: true, rulesFailed: false };
    expect(labelSaveBlocked(base)).toBe(false);
    expect(labelSaveBlocked({ ...base, loaded: false })).toBe(true);
    expect(labelSaveBlocked({ ...base, rulesFailed: true })).toBe(true);
    expect(labelSaveBlocked({ ...base, loaded: false, rulesFailed: true })).toBe(true);
    expect(labelSaveBlocked({ ...base, busy: true })).toBe(true);
    expect(labelSaveBlocked({ ...base, name: "  " })).toBe(true);
    // Creating never depends on the rules list.
    expect(labelSaveBlocked({ ...base, editing: false, loaded: true, rulesFailed: true })).toBe(false);
  });
  it("tells this app's rules from Outlook-made rules that assign the same category", () => {
    const own: MessageRule = { id: "1", displayName: "Label: GSI (senders)", sequence: 1, isEnabled: true, conditions: { senderContains: ["x"] }, actions: { assignCategories: ["GSI"], moveToFolder: "f", stopProcessingRules: true } };
    const sorting: MessageRule = { id: "2", displayName: "Sorting: GSI", sequence: 2, isEnabled: true, actions: { assignCategories: ["GSI"], stopProcessingRules: false } };
    const foreign: MessageRule = { id: "3", displayName: "Label: GSI (senders)", sequence: 3, isEnabled: true, actions: { assignCategories: ["GSI"], forwardTo: [{ emailAddress: { address: "a@b.c" } }] } };
    const outlook: MessageRule = { id: "4", displayName: "My GSI rule", sequence: 4, isEnabled: true, actions: { assignCategories: ["GSI", "Urgent"], markAsRead: true } };
    expect(isOwnRule("gsi", own)).toBe(true);
    expect(isOwnRule("GSI", sorting)).toBe(true);
    expect(isOwnRule("GSI", foreign)).toBe(false);
    expect(isOwnRule("GSI", outlook)).toBe(false);
    expect(ownRules("GSI", [own, sorting, foreign, outlook]).map((r) => r.id)).toEqual(["1", "2"]);
    expect(foreignRules("GSI", [own, sorting, foreign, outlook]).map((r) => r.id)).toEqual(["3", "4"]);
    expect(moveFolderOf("GSI", [own, outlook])).toBe("f");
    expect(moveFolderOf("GSI", [sorting])).toBeUndefined();
    // conditionsFromRules only reads own rules, so a foreign forward rule cannot leak into the dialog
    expect(conditionsFromRules("GSI", [own, foreign, outlook])).toEqual(S({ from: ["x"] }));
  });
  it("returns nothing for empty conditions and drops blank chips", () => {
    expect(rulesForLabel("X", EMPTY_CONDITIONS, 0)).toEqual([]);
    expect(rulesForLabel("X", S({ subject: ["  "] }), 0)).toEqual([]);
    expect(rulesForLabel("X", { ...EMPTY_CONDITIONS, conditions: [{ kind: "subjectContains", values: [" "] }, { kind: "sizeBetween" }] }, 0)).toEqual([]);
  });
  it("round-trips through conditionsFromRules", () => {
    const c = S({ from: ["siva@lyzr.ai", "@accenture.com"], subject: ["Weekly"], meetings: true, newsletters: false, toMe: true });
    const rules = rulesForLabel("GSI", c, 0).map((r, i) => ({ ...r, id: String(i) }));
    const other: MessageRule = { id: "o", displayName: "Other", sequence: 99, isEnabled: true, actions: { assignCategories: ["Events"] } };
    expect(rulesOfLabel("gsi", [...rules, other])).toHaveLength(rules.length);
    expect(conditionsFromRules("GSI", [...rules, other])).toEqual(c);
  });
});

describe("backfill matcher", () => {
  const list = [
    msg({ id: "a", addr: "priya.raman@accenture.com", subject: "Webinar", categories: ["GSI"] }),
    msg({ id: "b", addr: "sub.mail.accenture.com".replace(/^/, "x@"), subject: "Hi" }),
    msg({ id: "c", addr: "siva@lyzr.ai", subject: "Weekly GSI report" }),
    msg({ id: "d", addr: "notaccenture.com@evil.io", subject: "phish" }),
    msg({ id: "e", addr: "news@gartner.com", subject: "Trends", internetMessageHeaders: [{ name: "List-Unsubscribe", value: "<mailto:x>" }] }),
    msg({ id: "f", addr: "anirudh@lyzr.ai", subject: "1:1", toRecipients: [{ emailAddress: { address: "me@lyzr.com" } }] }),
    msg({ id: "g", addr: "anirudh@lyzr.ai", subject: "Invitation: sync", "@odata.type": "#microsoft.graph.eventMessageRequest" }),
    msg({ id: "h", addr: "pulse@linkedin.com", subject: "Digest", internetMessageHeaders: [{ name: "List-Unsubscribe", value: "<mailto:x>" }] }),
  ];
  it("matches exact addresses, domain suffixes and subject substrings case-insensitively", () => {
    expect(senderMatches(list[0], "priya.raman@accenture.com")).toBe(true);
    expect(senderMatches(list[0], "PRIYA.RAMAN@ACCENTURE.COM")).toBe(true);
    expect(senderMatches(list[0], "raman@accenture.com")).toBe(false);
    expect(senderMatches(list[0], "@accenture.com")).toBe(true);
    expect(senderMatches(list[1], "@accenture.com")).toBe(true);
    expect(senderMatches(list[3], "@accenture.com")).toBe(false);
    expect(senderMatches(list[3], "accenture")).toBe(true); // keyword, like Outlook's senderContains
    expect(matchesConditions(list[2], S({ subject: ["gsi REPORT"] }))).toBe(true);
    expect(matchesConditions(list[2], S({ subject: ["daily"] }))).toBe(false);
  });
  it("honours newsletter and sent-only-to-me toggles when the payload has the data", () => {
    expect(matchesConditions(list[4], S({ newsletters: true }))).toBe(true);
    expect(matchesConditions(list[2], S({ newsletters: true }))).toBe(false);
    expect(matchesConditions(list[5], S({ toMe: true }), "me@lyzr.com")).toBe(true);
    expect(matchesConditions(list[5], S({ toMe: true }))).toBe(false);
  });
  it("detects meeting mail from @odata.type and honours sender exceptions", () => {
    expect(matchesConditions(list[6], S({ meetings: true }))).toBe(true);
    expect(matchesConditions(list[5], S({ meetings: true }))).toBe(false);
    expect(matchesConditions(list[7], PROMOTIONS_CONDITIONS)).toBe(false); // LinkedIn digest: Social, not Promotions
    expect(matchesConditions(list[4], PROMOTIONS_CONDITIONS)).toBe(true);
  });
  it("skips already-labelled messages and preserves existing categories", () => {
    const targets = backfillTargets(list, "GSI", S({ from: ["@accenture.com"], subject: ["weekly"] }));
    expect(targets.map((m) => m.id)).toEqual(["b", "c"]);
    expect(withCategory(["Urgent"], "GSI")).toEqual(["Urgent", "GSI"]);
    expect(withCategory(["gsi"], "GSI")).toEqual(["gsi"]);
    expect(withoutCategory(["Urgent", "GSI"], "gsi")).toEqual(["Urgent"]);
  });
});

describe("query builders", () => {
  it("escapes single quotes, percent-encodes the filter and orders by receivedDateTime with it leading the filter", () => {
    expect(escapeOData("Priya's")).toBe("Priya''s");
    const p = labelListPath("Priya's team");
    const filter = new URL(`https://graph.microsoft.com/v1.0${p}`).searchParams.get("$filter");
    expect(filter).toBe("receivedDateTime ge 1970-01-01T00:00:00Z and categories/any(c:c eq 'Priya''s team')");
    expect(p).toContain("$filter=receivedDateTime%20ge%20");
    expect(p).toContain("$orderby=receivedDateTime desc");
    expect(labelListPath("GSI", "search")).toContain('$search=%22category%3AGSI%22');
    // & and # in a name no longer split or truncate the query string
    const tricky = labelListPath("R&D #1");
    expect(tricky).not.toMatch(/[&#]/.source.replace("&", "") + "1");
    expect(new URL(`https://graph.microsoft.com/v1.0${tricky}`).searchParams.get("$filter")).toContain("categories/any(c:c eq 'R&D #1')");
    expect(new URL(`https://graph.microsoft.com/v1.0${folderByNamePath("R&D")}`).searchParams.get("$filter")).toBe("displayName eq 'R&D'");
  });
  it("builds tab filters and the client fallback", () => {
    expect(tabFilter("social")).toBe("categories/any(c:c eq 'Social')");
    expect(tabFilter("promotions", true)).toBe("inferenceClassification eq 'focused' and categories/any(c:c eq 'Promotions')");
    expect(tabFilter("primary")).toBe("not(categories/any(c:c eq 'Social')) and not(categories/any(c:c eq 'Promotions'))");
    expect(inboxTabPath("primary", false, "client")).not.toContain("categories/any");
    expect(new URL(`https://graph.microsoft.com/v1.0${inboxTabPath("primary", true, "client")}`).searchParams.get("$filter")).toBe("receivedDateTime ge 1970-01-01T00:00:00Z and inferenceClassification eq 'focused'");
    expect(inboxTabPath("social")).toContain("/me/mailFolders/inbox/messages?");
  });
  it("phrases rules exactly as Outlook does", () => {
    const s = summarizeRule({ id: "1", displayName: "x", sequence: 1, isEnabled: true, conditions: { senderContains: ["linkedin.com"], headerContains: ["List-Unsubscribe"] }, actions: { assignCategories: ["Social"], moveToFolder: "f1", markAsRead: true } }, (id) => (id === "f1" ? "Archive" : undefined));
    expect(s.when).toBe("with 'linkedin.com' in the sender's address and which is a newsletter (has an unsubscribe header)");
    expect(s.then).toBe("move it to the Archive folder and assign it to the Social category and mark it as read");
    expect(summarizeRule({ id: "2", displayName: "y", sequence: 1, isEnabled: true })).toEqual({ when: "on every message", then: "do nothing" });
    const skip = { id: "3", displayName: "z", sequence: 1, isEnabled: true, conditions: { fromAddresses: [{ emailAddress: { address: "siva@lyzr.ai" } }, { emailAddress: { address: "anju@lyzr.ai" } }] }, exceptions: { senderContains: ["linkedin.com"] }, actions: { assignCategories: ["Leadership"], moveToFolder: "f2", stopProcessingRules: true } };
    expect(outlookRuleSentence(skip, (id) => (id === "f2" ? "Leadership" : undefined))).toBe(
      "Apply this rule after the message arrives: from siva@lyzr.ai or anju@lyzr.ai, except if with 'linkedin.com' in the sender's address, move it to the Leadership folder and assign it to the Leadership category and stop processing more rules"
    );
    // The whole label, as the dialog previews it: "any" joins with or, "all" with and.
    const c = { match: "any" as const, conditions: [{ kind: "fromIs" as const, values: ["siva@lyzr.ai"] }, { kind: "subjectContains" as const, values: ["offsite"] }], exceptions: [{ kind: "hasAttachment" as const }] };
    expect(labelSentence("Leadership", c, { folderName: "Leadership" })).toBe(
      "Apply this rule after the message arrives: from siva@lyzr.ai or with 'offsite' in the subject, except if which has an attachment, move it to the Leadership folder and assign it to the Leadership category and stop processing more rules"
    );
    expect(labelSentence("Leadership", { ...c, match: "all" })).toBe("Apply this rule after the message arrives: from siva@lyzr.ai and with 'offsite' in the subject, except if which has an attachment, assign it to the Leadership category");
    expect(labelSentence("X", { match: "any", conditions: [{ kind: "meeting" }, { kind: "sizeBetween", minKb: 100, maxKb: 5000 }, { kind: "importance", importance: "high" }], exceptions: [] })).toContain(
      "which is a meeting invitation, update or response or with a size between 100 KB and 5000 KB or marked as high importance"
    );
  });
});

describe("Outlook vocabulary: predicates and round-trips", () => {
  const rows: Condition[] = [
    { kind: "fromIs", values: ["siva@lyzr.ai"] },
    { kind: "fromContains", values: ["@accenture.com"] },
    { kind: "sentTo", values: ["partners@lyzr.ai"] },
    { kind: "recipientContains", values: ["marketing"] },
    { kind: "subjectContains", values: ["Weekly"] },
    { kind: "subjectOrBodyContains", values: ["co-sell"] },
    { kind: "bodyContains", values: ["unsubscribe"] },
    { kind: "headerContains", values: ["X-Priority"] },
    { kind: "hasAttachment" },
    { kind: "importance", importance: "high" },
    { kind: "sentOnlyToMe" },
    { kind: "sentToMe" },
    { kind: "sizeBetween", minKb: 10, maxKb: 200 },
  ];
  it("maps every kind to its messageRulePredicates field", () => {
    const { predicates, meeting } = predicatesOf([...rows, { kind: "meeting" }]);
    expect(meeting).toBe(true);
    expect(predicates).toEqual({
      senderContains: ["@accenture.com"],
      fromAddresses: [{ emailAddress: { address: "siva@lyzr.ai" } }],
      sentToAddresses: [{ emailAddress: { address: "partners@lyzr.ai" } }],
      recipientContains: ["marketing"],
      subjectContains: ["Weekly"],
      bodyOrSubjectContains: ["co-sell"],
      bodyContains: ["unsubscribe"],
      headerContains: ["X-Priority"],
      hasAttachments: true,
      importance: "high",
      sentOnlyToMe: true,
      sentToMe: true,
      withinSizeRange: { minimumSize: 10, maximumSize: 200 },
    });
    // Back again, every kind accounted for.
    expect(conditionsOfPredicates(predicates).map((r) => r.kind).sort()).toEqual(rows.map((r) => r.kind).sort());
  });
  it("any-of = one rule per kind, all-of = one rule with every predicate; a meeting row is always two rules", () => {
    const any = rulesForLabel("X", { match: "any", conditions: rows, exceptions: [{ kind: "fromContains", values: ["noreply"] }, { kind: "hasAttachment" }] }, 0);
    expect(any).toHaveLength(rows.length);
    for (const r of any) expect(r.exceptions).toEqual({ senderContains: ["noreply"], hasAttachments: true });
    expect(any.map((r) => r.displayName)).toContain("Label: X (size)");
    const all = rulesForLabel("X", { match: "all", conditions: rows, exceptions: [] }, 0);
    expect(all).toHaveLength(1);
    expect(all[0].displayName).toBe("Label: X (all conditions)");
    expect(all[0].conditions).toEqual(predicatesOf(rows).predicates);
    const allMeeting = rulesForLabel("X", { match: "all", conditions: [{ kind: "fromIs", values: ["a@b.c"] }, { kind: "meeting" }], exceptions: [] }, 0);
    expect(allMeeting.map((r) => r.conditions)).toEqual([{ fromAddresses: [{ emailAddress: { address: "a@b.c" } }], isMeetingRequest: true }, { fromAddresses: [{ emailAddress: { address: "a@b.c" } }], isMeetingResponse: true }]);
  });
  it("Edit label round-trips any-of, all-of, the meeting pair and the exceptions", () => {
    const withId = (rs: Omit<MessageRule, "id">[]) => rs.map((r, i) => ({ ...r, id: String(i) }));
    const anyC = { match: "any" as const, conditions: rows, exceptions: [{ kind: "fromContains" as const, values: ["noreply"] }] };
    expect(conditionsFromRules("X", withId(rulesForLabel("X", anyC, 0)), [])).toEqual(anyC);
    const allC = { match: "all" as const, conditions: rows, exceptions: [{ kind: "subjectContains" as const, values: ["fwd"] }] };
    expect(conditionsFromRules("X", withId(rulesForLabel("X", allC, 0)), [])).toEqual(allC);
    const allMeeting = { match: "all" as const, conditions: [{ kind: "fromIs" as const, values: ["a@b.c"] }, { kind: "meeting" as const }], exceptions: [] };
    expect(conditionsFromRules("X", withId(rulesForLabel("X", allMeeting, 0)), [])).toEqual(allMeeting);
    const anyMeeting = { match: "any" as const, conditions: [{ kind: "fromIs" as const, values: ["a@b.c"] }, { kind: "meeting" as const }], exceptions: [] };
    expect(conditionsFromRules("X", withId(rulesForLabel("X", anyMeeting, 0)), [])).toEqual(anyMeeting);
  });
  it("matches the new kinds client-side for the backfill, honouring all-of and exceptions", () => {
    const m = msg({ id: "m", addr: "priya@accenture.com", subject: "Weekly co-sell", bodyPreview: "please unsubscribe here", hasAttachments: true, importance: "high", toRecipients: [{ emailAddress: { name: "Marketing", address: "partners@lyzr.ai" } }, { emailAddress: { address: "me@lyzr.com" } }] });
    const one = (c: Condition, me?: string) => matchesConditions(m, { match: "any", conditions: [c], exceptions: [] }, me);
    expect(one({ kind: "sentTo", values: ["PARTNERS@lyzr.ai"] })).toBe(true);
    expect(one({ kind: "recipientContains", values: ["market"] })).toBe(true);
    expect(one({ kind: "subjectOrBodyContains", values: ["unsubscribe"] })).toBe(true);
    expect(one({ kind: "bodyContains", values: ["co-sell"] })).toBe(false);
    expect(one({ kind: "hasAttachment" })).toBe(true);
    expect(one({ kind: "importance", importance: "low" })).toBe(false);
    expect(one({ kind: "sentToMe" }, "me@lyzr.com")).toBe(true);
    expect(one({ kind: "sentOnlyToMe" }, "me@lyzr.com")).toBe(false);
    expect(one({ kind: "sizeBetween", minKb: 1 })).toBe(false); // unknown in a list payload
    expect(matchesConditions(m, { match: "all", conditions: [{ kind: "fromContains", values: ["accenture"] }, { kind: "subjectContains", values: ["weekly"] }], exceptions: [] })).toBe(true);
    expect(matchesConditions(m, { match: "all", conditions: [{ kind: "fromContains", values: ["accenture"] }, { kind: "subjectContains", values: ["daily"] }], exceptions: [] })).toBe(false);
    expect(matchesConditions(m, { match: "any", conditions: [{ kind: "fromContains", values: ["accenture"] }], exceptions: [{ kind: "hasAttachment" }] })).toBe(false);
  });
});

describe("mock: categories, rules and sorting", () => {
  const call = <T,>(method: string, path: string, body?: unknown) => handleMail(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;
  it("filters by categories/any and not(...) across folders and in the inbox", () => {
    const gsi = call<Page<Message>>("GET", `/me/messages?${labelListPath("GSI").split("?")[1]}`);
    expect(gsi.value.length).toBeGreaterThan(3);
    expect(gsi.value.every((m) => m.categories?.includes("GSI"))).toBe(true);
    expect(gsi.value.some((m) => m.parentFolderId === "f-partners-acc")).toBe(true);
    const search = call<Page<Message>>("GET", labelListPath("GSI", "search"));
    // $search answers with REST ids (no immutable Prefer on $search): same messages, other id format.
    expect(search.value.every((m) => m.id.startsWith("rest:"))).toBe(true);
    expect(search.value.map((m) => m.id.replace(/^rest:/, "")).sort()).toEqual(gsi.value.map((m) => m.id).sort());
    const primary = call<Page<Message>>("GET", inboxTabPath("primary"));
    expect(primary.value.length).toBeGreaterThan(10);
    expect(primary.value.every((m) => !m.categories?.includes("Social"))).toBe(true);
  });
  it("creates sorting rules, backfills existing newsletters and social mail like the app, with PATCH/DELETE", async () => {
    const before = mockRules.length;
    const social = call<MessageRule>("POST", "/me/mailFolders/inbox/messageRules", { ...SORTING_RULES[0], sequence: 7 });
    const promos = call<MessageRule>("POST", "/me/mailFolders/inbox/messageRules", { ...SORTING_RULES[1], sequence: 8 });
    expect(mockRules.length).toBe(before + 2);
    // App-made rules are not auto-applied by the mock (Outlook only runs rules on arrival); the app backfills.
    expect(call<Page<Message>>("GET", inboxTabPath("social")).value).toHaveLength(0);
    const api = mockApi();
    const s = await backfillLabel(api, "Social", SOCIAL_CONDITIONS);
    const p = await backfillLabel(api, "Promotions", PROMOTIONS_CONDITIONS);
    expect(s.labelled).toBeGreaterThanOrEqual(3);
    expect(p.labelled).toBe(3);
    const socialTab = call<Page<Message>>("GET", inboxTabPath("social"));
    expect(socialTab.value.length).toBeGreaterThanOrEqual(3);
    expect(socialTab.value.every((m) => /linkedin\.com|facebookmail\.com/.test(m.from!.emailAddress.address!))).toBe(true);
    const promoTab = call<Page<Message>>("GET", inboxTabPath("promotions"));
    expect(promoTab.value.length).toBe(3); // LinkedIn Pulse carries List-Unsubscribe but is a Social sender (exception)
    expect(promoTab.value.every((m) => m.internetMessageHeaders?.some((h) => h.name === "List-Unsubscribe"))).toBe(true);
    expect(promoTab.value.some((m) => /linkedin/.test(m.from!.emailAddress.address!))).toBe(false);
    expect(socialTab.value.some((m) => m.categories?.includes("Promotions"))).toBe(false);
    const primary = call<Page<Message>>("GET", inboxTabPath("primary"));
    expect(primary.value.some((m) => m.categories?.includes("Social") || m.categories?.includes("Promotions"))).toBe(false);
    const patched = call<MessageRule>("PATCH", `/me/mailFolders/inbox/messageRules/${social.id}`, { isEnabled: false });
    expect(patched.isEnabled).toBe(false);
    call("DELETE", `/me/mailFolders/inbox/messageRules/${promos.id}`);
    const list = call<Page<MessageRule>>("GET", "/me/mailFolders/inbox/messageRules");
    expect(list.value.some((r) => r.id === promos.id)).toBe(false);
    expect(list.value.map((r) => r.sequence)).toEqual([...list.value.map((r) => r.sequence)].sort((a, b) => a - b));
  });
  it("applies fromAddresses rules made outside the app on creation", () => {
    const r = call<MessageRule>("POST", "/me/mailFolders/inbox/messageRules", { displayName: "Accenture to category", sequence: 20, isEnabled: true, conditions: { fromAddresses: [{ emailAddress: { address: "priya.raman@accenture.com" } }] }, actions: { assignCategories: ["Accenture"] } });
    expect(r.id).toBeTruthy();
    const acc = call<Page<Message>>("GET", `/me/messages?${labelListPath("Accenture").split("?")[1]}`);
    expect(acc.value.length).toBeGreaterThan(0);
    expect(acc.value.every((m) => m.from?.emailAddress?.address === "priya.raman@accenture.com")).toBe(true);
  });
});
