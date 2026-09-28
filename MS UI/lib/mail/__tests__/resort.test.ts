import { describe, expect, it } from "vitest";
import { mockFolders, mockMessages } from "@/lib/mock/mail";
import { installPresets } from "../install";
import { RULES_PATH } from "../labels";
import { PRESET_LABELS } from "../presets";
import { calendarHealth, canReplay, meetingKind, newMailPath, planPriority, planResort, priorityOrder, repairBrokenRules, replayRules, resortInbox, sortNewMail } from "../resort";
import type { Message, MessageRule } from "../types";
import { mockApi, mockCall, type Page } from "./helpers";

const ME = "kailash.gm@lyzr.com";

const rule = (id: string, displayName: string, sequence: number, conditions: MessageRule["conditions"], actions: MessageRule["actions"], extra: Partial<MessageRule> = {}): MessageRule => ({ id, displayName, sequence, isEnabled: true, conditions, actions, ...extra });
const moveTo = (label: string, folder: string) => ({ assignCategories: [label], moveToFolder: folder, stopProcessingRules: true });

// The order a mailbox had before this fix: people labels first, Calendar last.
const RULES: MessageRule[] = [
  rule("lead", "Label: Leadership (senders)", 1, { fromAddresses: [{ emailAddress: { address: "siva@lyzr.ai" } }] }, moveTo("Leadership", "f-lead")),
  rule("ms1", "Label: Meeting scripts (sender keywords)", 2, { senderContains: ["fireflies.ai"] }, moveTo("Meeting scripts", "f-ms")),
  rule("ms2", "Label: Meeting scripts (subject)", 3, { subjectContains: ["Meeting recap"] }, moveTo("Meeting scripts", "f-ms")),
  rule("cal1", "Label: Calendar (invitations)", 4, { isMeetingRequest: true }, moveTo("Calendar", "f-cal")),
  rule("cal2", "Label: Calendar (responses)", 5, { isMeetingResponse: true }, moveTo("Calendar", "f-cal")),
  rule("cal3", "Label: Calendar (body)", 6, { bodyContains: ["Microsoft Teams meeting", "teams.microsoft.com/meet/"] }, moveTo("Calendar", "f-cal")),
  rule("social", "Sorting: Social", 7, { senderContains: ["linkedin.com"] }, { assignCategories: ["Social"], stopProcessingRules: false }),
];

const msg = (id: string, from: string, extra: Partial<Message> = {}): Message =>
  ({ id, subject: "Hello", bodyPreview: "", from: { emailAddress: { address: from, name: from } }, toRecipients: [{ emailAddress: { address: ME } }], categories: [], parentFolderId: "inbox", ...extra }) as Message;

describe("rule priority", () => {
  it("puts real invitations first, then recaps, then Calendar's link rule, then everything else in its old order", () => {
    expect(priorityOrder(RULES).map((r) => r.id)).toEqual(["cal1", "cal2", "ms1", "ms2", "cal3", "lead", "social"]);
  });

  it("renumbers above the highest sequence (no collisions) and does nothing once ordered", () => {
    const plan = planPriority(RULES);
    expect(plan.map((p) => p.id)).toEqual(["cal1", "cal2", "ms1", "ms2", "cal3", "lead", "social"]);
    expect(plan.map((p) => p.sequence)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    const after = RULES.map((r) => ({ ...r, sequence: plan.find((p) => p.id === r.id)!.sequence }));
    expect(planPriority(after)).toEqual([]);
  });

  it("leaves read-only rules where they are", () => {
    const ro = [...RULES, rule("admin", "Org rule", 0, { subjectContains: ["x"] }, { markAsRead: true }, { isReadOnly: true })];
    expect(planPriority(ro).some((p) => p.id === "admin")).toBe(false);
  });
});

describe("replaying rules", () => {
  const ordered = priorityOrder(RULES).map((r, i) => ({ ...r, sequence: i + 1 }));

  it("sends an invitation from a Leadership sender to Calendar invites once Calendar runs first", () => {
    const invite = msg("a", "siva@lyzr.ai", { "@odata.type": "#microsoft.graph.eventMessageRequest" });
    expect(replayRules(invite, RULES, ME).folderId).toBe("f-lead"); // the old order: the bug
    expect(replayRules(invite, ordered, ME)).toMatchObject({ folderId: "f-cal", categories: ["Calendar"] });
  });

  it("treats cancellations as requests and accept/decline as responses", () => {
    const cancel = msg("c", "rohit@lyzr.com", { "@odata.type": "#microsoft.graph.eventMessage" });
    const accepted = msg("r", "rohit@lyzr.com", { "@odata.type": "#microsoft.graph.eventMessageResponse" });
    expect(replayRules(cancel, ordered, ME).rules).toEqual(["Label: Calendar (invitations)"]);
    expect(replayRules(accepted, ordered, ME).rules).toEqual(["Label: Calendar (responses)"]);
  });

  it("files a plain email carrying a Teams join link under Calendar, but a Teams recap under Meeting scripts", () => {
    const link = msg("l", "rohit.mallavarapu@lyzr.com", { bodyPreview: "Microsoft Teams meeting Join: https://teams.microsoft.com/meet/258861177664815" });
    const recap = msg("m", "noreply@teams.microsoft.com", { subject: "Meeting recap: GSI sync", bodyPreview: "Microsoft Teams meeting recap is ready" });
    expect(replayRules(link, ordered, ME).folderId).toBe("f-cal");
    expect(replayRules(recap, ordered, ME).folderId).toBe("f-ms");
  });

  it("honours stop-processing rules, never replays deletes and skips rules it cannot read", () => {
    const keep = rule("keep", "Sorting: Primary (rohit@lyzr.com)", 0, { fromAddresses: [{ emailAddress: { address: "rohit@lyzr.com" } }] }, { stopProcessingRules: true });
    const invite = msg("k", "rohit@lyzr.com", { "@odata.type": "#microsoft.graph.eventMessageRequest" });
    expect(replayRules(invite, [keep, ...ordered], ME).folderId).toBeUndefined();

    const del = rule("del", "Delete spam", 0, { subjectContains: ["Hello"] }, { delete: true });
    expect(replayRules(msg("d", "x@y.com", { "@odata.type": "#microsoft.graph.eventMessageRequest" }), [del, ...ordered], ME)).toEqual({ categories: [], rules: [] });

    const sized = rule("big", "Big mail", 0, { withinSizeRange: { minimumSize: 1000 } }, moveTo("Big", "f-big"));
    expect(canReplay(sized, false)).toBe(false);
    expect(planResort([msg("s", "x@y.com")], [sized], ME).unknownRules).toEqual(["Big mail"]);
  });

  it("reads the meeting class (PR_MESSAGE_CLASS) before @odata.type", () => {
    const cls = (value: string) => msg("x", "a@b.com", { "@odata.type": "#microsoft.graph.message", singleValueExtendedProperties: [{ id: "String 0x001A", value }] });
    expect(meetingKind(cls("IPM.Schedule.Meeting.Request"))).toBe("request");
    expect(meetingKind(cls("IPM.Schedule.Meeting.Canceled"))).toBe("request");
    expect(meetingKind(cls("IPM.Schedule.Meeting.Resp.Pos"))).toBe("response");
    expect(meetingKind(cls("IPM.Note"))).toBeUndefined();
    expect(replayRules(cls("IPM.Schedule.Meeting.Request"), ordered, ME).folderId).toBe("f-cal");
  });

  it("matches body phrases found by search when the preview is the Teams divider", () => {
    const m = { ...msg("u", "sejal@lyzr.com", { bodyPreview: "_".repeat(200) }), bodyHits: ["teams.microsoft.com/meet/"] };
    expect(replayRules(m, ordered, ME).folderId).toBe("f-cal");
  });

  it("explains why Calendar misses new mail: turned off, broken, or a stop rule ahead of it", () => {
    const rules = ordered.map((r) => (r.id === "cal2" ? { ...r, isEnabled: false } : r.id === "cal3" ? { ...r, hasError: true } : r));
    const stopper = rule("stop", "Old Outlook rule", 0, { senderContains: ["lyzr"] }, { stopProcessingRules: true });
    const health = calendarHealth([stopper, ...rules]);
    expect(health.join("\n")).toMatch(/Calendar \(responses\)" is turned off/);
    expect(health.join("\n")).toMatch(/error on "Label: Calendar \(body\)"/);
    expect(health.join("\n")).toMatch(/"Old Outlook rule" runs before Calendar/);
    expect(calendarHealth(ordered)).toEqual([]);
  });

  it("disabled rules do not replay; a rule Outlook flags as broken still does (and is repaired for new mail)", () => {
    const off = ordered.map((r) => (r.id === "cal1" ? { ...r, isEnabled: false } : r.id === "cal2" ? { ...r, hasError: true } : r));
    const invite = msg("o", "rohit@lyzr.com", { "@odata.type": "#microsoft.graph.eventMessageRequest" });
    const accepted = msg("p", "rohit@lyzr.com", { "@odata.type": "#microsoft.graph.eventMessageResponse" });
    const plan = planResort([invite, accepted], off, ME);
    expect(plan.moves.map((x) => x.message.id)).toEqual(["p"]); // the broken responses rule still files Rohit's accept
  });
});

describe("Sort Inbox now against the mock", () => {
  it("updates Calendar, puts it first and moves stale invitations and join-link mail out of the Inbox", async () => {
    const api = mockApi();
    await installPresets(api, PRESET_LABELS, ME);
    const inboxId = mockMessages.find((m) => m.parentFolderId === "f-inbox")!.parentFolderId;
    const template = mockMessages.find((m) => m.parentFolderId === inboxId)!;
    const stale = (id: string, extra: Partial<Message>) => mockMessages.push({ ...template, id, conversationId: `conv-${id}`, categories: [], isRead: false, ...extra } as Message);
    // Arrived before the rules existed, from a Leadership sender.
    stale("stale-invite", { subject: "Partner QBR", from: { emailAddress: { address: "siva@lyzr.ai", name: "Siva" } }, "@odata.type": "#microsoft.graph.eventMessageRequest" });
    // Real invites: preview is the divider, the link only in the body, the type only in the message class.
    const divider = "_".repeat(200);
    stale("stale-class", { subject: "All Hands Sync: Fortnightly Catch Up", bodyPreview: divider, body: { contentType: "html", content: "<p>Microsoft Teams meeting</p>" }, from: { emailAddress: { address: "sejal@lyzr.com", name: "Sejal Agarwal" } }, "@odata.type": "#microsoft.graph.message", singleValueExtendedProperties: [{ id: "String 0x001A", value: "IPM.Schedule.Meeting.Request" }] });
    stale("stale-notes", { subject: "Notes: “Product Team” Sep 25, 2026", bodyPreview: "Notes from Product Team", from: { emailAddress: { address: "gemini-notes@google.com", name: "Gemini" } }, "@odata.type": "#microsoft.graph.message" });
    stale("stale-link", { subject: "Join here", bodyPreview: divider, body: { contentType: "html", content: "Join: https://teams.microsoft.com/meet/1?p=x" }, from: { emailAddress: { address: "rohit.mallavarapu@lyzr.com", name: "Rohit" } }, "@odata.type": "#microsoft.graph.message" });
    stale("stale-plain", { subject: "Lunch?", bodyPreview: "Free at 1?", from: { emailAddress: { address: "rohit.mallavarapu@lyzr.com", name: "Rohit" } }, "@odata.type": "#microsoft.graph.message" });

    const steps: string[] = [];
    const res = await resortInbox(api, ME, (s) => steps.push(s));
    expect(steps).toEqual(["calendar", "order", "scan", "search", "move"]);

    const calFolder = mockFolders.find((f) => f.displayName === "Calendar invites")!;
    const bySubject = (s: string) => mockMessages.find((m) => m.subject === s)!;
    expect(bySubject("Partner QBR").parentFolderId).toBe(calFolder.id);
    expect(bySubject("Partner QBR").categories).toContain("Calendar");
    expect(bySubject("Join here").parentFolderId).toBe(calFolder.id);
    expect(bySubject("All Hands Sync: Fortnightly Catch Up").parentFolderId).toBe(calFolder.id);
    expect(bySubject("Notes: “Product Team” Sep 25, 2026").categories).toContain("Meeting scripts");
    expect(res.meetingsLeft).toBe(0);
    expect(res.health).toEqual([]);
    expect(bySubject("Lunch?").parentFolderId).toBe(inboxId);
    expect(res.byFolder[calFolder.id]).toBeGreaterThanOrEqual(2);
    expect(res.failed).toBe(0);

    const rules = (mockCall("GET", RULES_PATH) as Page<MessageRule>).value.sort((a, b) => a.sequence - b.sequence);
    expect(rules.slice(0, 2).map((r) => r.displayName)).toEqual(["Label: Calendar (invitations)", "Label: Calendar (responses)"]);
    expect(rules.find((r) => r.displayName === "Label: Calendar (body)")?.conditions?.bodyContains).toContain("teams.microsoft.com/meet/");

    // A second run finds nothing left to move and changes no rules.
    const again = await resortInbox(api, ME);
    expect(again).toMatchObject({ moved: 0, reordered: 0, calendarUpdated: false });
  });
});


describe("hands-free sorting against the mock", () => {
  it("repairBrokenRules recreates a broken label rule with the same conditions and leaves Outlook-made rules alone", async () => {
    const api = mockApi();
    await installPresets(api, PRESET_LABELS, ME);
    const all = () => (mockCall("GET", RULES_PATH) as Page<MessageRule>).value;
    const target = all().find((r) => r.displayName === "Label: Calendar (invitations)")!;
    target.hasError = true;
    const foreign = all().find((r) => !r.displayName.startsWith("Label:"));
    if (foreign) foreign.hasError = true;
    const fixed = await repairBrokenRules(api);
    expect(fixed).toEqual(["Label: Calendar (invitations)"]);
    const again = all().find((r) => r.displayName === "Label: Calendar (invitations)")!;
    expect(again.id).not.toBe(target.id);
    expect(again.hasError).toBeFalsy();
    expect(again.conditions).toEqual(target.conditions);
    expect(again.sequence).toBe(target.sequence);
  });

  it("sortNewMail files an invitation that arrived after the rules, reading the join link from the full body", async () => {
    const api = mockApi();
    await installPresets(api, PRESET_LABELS, ME);
    const since = new Date(Date.now() - 60_000).toISOString();
    const template = mockMessages.find((m) => m.parentFolderId === "f-inbox")!;
    mockMessages.push({ ...template, id: "fresh-accept", conversationId: "conv-fresh", subject: "Accepted: Paid Ads GSI", receivedDateTime: new Date().toISOString(), categories: [], from: { emailAddress: { address: "rishabh@lyzr.com", name: "rishabh TM" } }, "@odata.type": "#microsoft.graph.eventMessageResponse", parentFolderId: "f-inbox" } as Message);
    mockMessages.push({ ...template, id: "fresh-link", conversationId: "conv-fresh2", subject: "Gulf partnerships catchup", receivedDateTime: new Date().toISOString(), categories: [], bodyPreview: "_".repeat(120), body: { contentType: "html", content: "<a href=https://teams.microsoft.com/meet/9>Join</a>" }, from: { emailAddress: { address: "rohit.mallavarapu@lyzr.com", name: "Rohit" } }, "@odata.type": "#microsoft.graph.message", parentFolderId: "f-inbox" } as Message);
    const r = await sortNewMail(api, since, ME);
    expect(r.moved).toBeGreaterThanOrEqual(2);
    const cal = mockFolders.find((f) => f.displayName === "Calendar invites")!.id;
    expect(mockMessages.find((m) => m.subject === "Accepted: Paid Ads GSI")!.parentFolderId).toBe(cal);
    expect(mockMessages.find((m) => m.subject === "Gulf partnerships catchup")!.parentFolderId).toBe(cal);
  });

  it("newMailPath orders before filtering and asks for the body", () => {
    const p = newMailPath("2026-09-28T00:00:00Z");
    expect(decodeURIComponent(p)).toContain("$orderby=receivedDateTime desc");
    expect(p).toContain(",body");
    expect(decodeURIComponent(p)).toContain("receivedDateTime ge 2026-09-28T00:00:00Z");
  });
});
