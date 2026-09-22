import { describe, expect, it } from "vitest";
import { mockFolders, mockRules } from "@/lib/mock/mail";
import { GraphError } from "@/lib/graph";
import { backfillLabel, ensureCategory, ensureFolder, installLabel, installPresets, moveLabelBackToInbox, replaceLabelRules, safeFolderName, type GraphApi } from "../install";
import { simpleConditions as S, inboxTabPath, isSortingRule, labelListPath, ownRules, SORTING_RULES } from "../labels";
import { PRESET_LABELS } from "../presets";
import type { MailFolder, Message, MessageRule } from "../types";
import { mockApi, mockCall, type Page } from "./helpers";

const calls: string[] = [];
const api = mockApi(calls);
const raw = mockCall;
const ME = "kailash.gm@lyzr.com";
const rules = () => (raw("GET", "/me/mailFolders/inbox/messageRules") as Page<MessageRule>).value;
const inbox = () => (raw("GET", inboxTabPath("primary")) as Page<Message>).value;
const labelled = (name: string) => (raw("GET", labelListPath(name)) as Page<Message>).value;
const folderNamed = (name: string) => mockFolders.find((f) => f.displayName === name && !f.parentFolderId);

describe("preset installer against the mock", () => {
  it("installs every preset once: category, folder, rules before sorting rules, backfill + move out of the inbox", async () => {
    // Sorting rules first, so the label rules must be inserted before them.
    for (const [i, r] of SORTING_RULES.entries()) raw("POST", "/me/mailFolders/inbox/messageRules", { ...r, sequence: 10 + i });
    const before = inbox();
    expect(before.some((m) => /Leadership offsite agenda/.test(m.subject ?? ""))).toBe(true);
    const results = await installPresets(api, PRESET_LABELS, ME);
    expect(results.map((r) => r.name)).toEqual(PRESET_LABELS.map((p) => p.name));
    for (const [i, r] of results.entries()) {
      const want = PRESET_LABELS[i].folderName ?? r.name;
      expect(r.folderId).toBe(folderNamed(want)?.id);
      expect(r.folderName).toBe(want);
      expect(r.error).toBeUndefined();
    }
    // "Calendar" is the mailbox's calendar folder (reserved sibling of the Inbox): the label keeps its name, the folder does not.
    expect(PRESET_LABELS.find((p) => p.name === "Calendar")?.folderName).toBe("Calendar invites");
    expect(folderNamed("Calendar")).toBeUndefined();
    expect(folderNamed("Calendar invites")).toBeDefined();
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.Leadership.moved).toBeGreaterThanOrEqual(1);
    expect(byName.GSI.moved).toBeGreaterThanOrEqual(1);
    expect(byName.Marketing.moved).toBeGreaterThanOrEqual(1);
    expect(byName["Meeting scripts"].moved).toBe(1);
    expect(byName.Calendar.moved).toBe(1);
    expect(results.every((r) => r.failed === 0)).toBe(true);
    // Every label rule sits before every sorting rule, and moves into the folder with stop.
    const all = rules();
    const maxLabel = Math.max(...all.filter((r) => r.displayName.startsWith("Label: ")).map((r) => r.sequence));
    const minSort = Math.min(...all.filter(isSortingRule).map((r) => r.sequence));
    expect(maxLabel).toBeLessThan(minSort);
    for (const p of PRESET_LABELS) {
      const own = ownRules(p.name, all);
      expect(own.length).toBeGreaterThan(0);
      for (const r of own) expect(r.actions).toEqual({ assignCategories: [p.name], moveToFolder: folderNamed(p.folderName ?? p.name)!.id, stopProcessingRules: true });
    }
    expect(all.find((r) => r.displayName === "Label: Calendar (invitations)")?.conditions).toEqual({ isMeetingRequest: true });
    expect(all.find((r) => r.displayName === "Label: Meeting scripts (subject)")?.conditions?.subjectContains).toContain("meeting transcript");
    // Siva's mail is under Leadership and gone from Primary; the invitation is under Calendar.
    const after = inbox();
    expect(after.some((m) => /Leadership offsite agenda/.test(m.subject ?? ""))).toBe(false);
    expect(after.some((m) => m.from?.emailAddress?.address === "pooja@lyzr.ai")).toBe(false);
    const lead = labelled("Leadership");
    expect(lead.some((m) => /Leadership offsite agenda/.test(m.subject ?? ""))).toBe(true);
    expect(lead.every((m) => m.parentFolderId === folderNamed("Leadership")!.id)).toBe(true);
    expect(labelled("Calendar").map((m) => m["@odata.type"])).toEqual(["#microsoft.graph.eventMessageRequest"]);
    expect(labelled("Calendar")[0].parentFolderId).toBe(folderNamed("Calendar invites")!.id);
    // Existing GSI-labelled partner mail (Accenture etc.) was not moved: it does not match the preset senders.
    expect(after.some((m) => m.categories?.includes("GSI"))).toBe(true);
  });

  it("is idempotent: a second run replaces rules and creates no duplicate category, folder or rule", async () => {
    const ruleCount = rules().length;
    const folderCount = mockFolders.length;
    const catCount = (raw("GET", "/me/outlook/masterCategories") as Page<{ displayName: string }>).value.length;
    calls.length = 0;
    const results = await installPresets(api, PRESET_LABELS, ME);
    expect(rules().length).toBe(ruleCount);
    expect(mockFolders.length).toBe(folderCount);
    expect((raw("GET", "/me/outlook/masterCategories") as Page<{ displayName: string }>).value.length).toBe(catCount);
    expect(calls.some((c) => c === "POST /me/mailFolders")).toBe(false);
    expect(calls.some((c) => c === "POST /me/outlook/masterCategories")).toBe(false);
    expect(results.every((r) => r.labelled === 0 && r.moved === 0)).toBe(true);
    const names = rules().map((r) => r.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("backfill with a folder labels then moves; without one it only labels; move back returns the label's mail", async () => {
    const folder = await ensureFolder(api, "Partners");
    expect(folder.displayName).toBe("Partners");
    expect(await ensureFolder(api, "partners")).toEqual(folder);
    const c = S({ from: ["@infosys.com"] });
    const dry = await backfillLabel(api, "Partners", c, ME);
    expect(dry.labelled).toBeGreaterThan(0);
    expect(dry.moved).toBe(0);
    expect(inbox().some((m) => m.from?.emailAddress?.address?.endsWith("@infosys.com"))).toBe(true);
    const wet = await backfillLabel(api, "Partners", c, ME, folder.id);
    expect(wet.labelled).toBe(0); // already labelled by the dry run
    expect(wet.moved).toBe(dry.labelled);
    expect(inbox().some((m) => m.from?.emailAddress?.address?.endsWith("@infosys.com"))).toBe(false);
    const back = await moveLabelBackToInbox(api, "Partners", folder.id);
    expect(back).toBe(wet.moved);
    expect(inbox().filter((m) => m.from?.emailAddress?.address?.endsWith("@infosys.com")).length).toBe(back);
  });

  it("replaceLabelRules leaves foreign rules alone and turning skip-inbox off recreates rules without the move", async () => {
    const foreign = raw("POST", "/me/mailFolders/inbox/messageRules", { displayName: "Outlook: forward Leadership", sequence: 99, isEnabled: true, conditions: { subjectContains: ["zzz-no-match"] }, actions: { assignCategories: ["Leadership"], forwardTo: [{ emailAddress: { address: "a@b.c" } }] } }) as MessageRule;
    const created = await replaceLabelRules(api, "Leadership", S({ from: ["siva@lyzr.ai"] }));
    expect(created).toHaveLength(1);
    expect(created[0].actions).toEqual({ assignCategories: ["Leadership"], stopProcessingRules: false });
    const all = rules();
    expect(all.some((r) => r.id === foreign.id)).toBe(true);
    expect(ownRules("Leadership", all).map((r) => r.id)).toEqual([created[0].id]);
    // Label rules still precede sorting rules
    expect(created[0].sequence).toBeLessThan(Math.min(...all.filter(isSortingRule).map((r) => r.sequence)));
    raw("DELETE", `/me/mailFolders/inbox/messageRules/${foreign.id}`);
    // installLabel with skipInbox=false never creates a folder
    const r = await installLabel(api, { name: "Urgent", color: "preset1", conditions: S({ subject: ["legal review"] }), skipInbox: false }, ME);
    expect(r.folderId).toBeUndefined();
    expect(mockFolders.some((f: MailFolder) => f.displayName === "Urgent")).toBe(false);
    expect(mockRules.find((x) => x.displayName === "Label: Urgent (subject)")?.actions).toEqual({ assignCategories: ["Urgent"], stopProcessingRules: false });
  });

  it("ensureFolder: the mock refuses reserved and duplicate sibling names with 409 and the helper falls back to '<name> mail'", async () => {
    // The mock mirrors Exchange: siblings of the Inbox are unique by name, mail folder or not.
    for (const displayName of ["Calendar", "contacts", "Inbox", "GSI Partners"]) {
      let err: unknown;
      try {
        raw("POST", "/me/mailFolders", { displayName });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GraphError);
      expect((err as GraphError).status).toBe(409);
      expect((err as GraphError).code).toBe("ErrorFolderExists");
    }
    expect(mockFolders.some((f) => f.displayName === "Calendar")).toBe(false);
    // A subfolder may reuse a top-level name; a duplicate under the same parent is refused.
    const child = raw("POST", "/me/mailFolders/f-partners/childFolders", { displayName: "Weekly Reports" }) as MailFolder;
    expect(child.parentFolderId).toBe("f-partners");
    expect(() => raw("POST", "/me/mailFolders/f-partners/childFolders", { displayName: "weekly reports" })).toThrow(GraphError);
    // Reserved: straight to the safe name, no POST of the reserved one.
    expect(safeFolderName("Calendar")).toBe("Calendar mail");
    expect(safeFolderName("Partners")).toBe("Partners");
    calls.length = 0;
    const cal = await ensureFolder(api, "Calendar");
    expect(cal.displayName).toBe("Calendar mail");
    expect(calls).toEqual(["POST /me/mailFolders"]);
    expect(await ensureFolder(api, "Calendar")).toEqual(cal);
    // A user label named like the folder the preset uses is shared, never duplicated.
    expect((await ensureFolder(api, "calendar invites")).id).toBe(folderNamed("Calendar invites")!.id);
    // A clash the GET cannot see (the mock lists only mail folders, like Graph): the 409 triggers the fallback.
    const hidden: GraphApi = {
      ...api,
      get: async <T,>(path: string) => (/displayName%20eq%20'Tasks'/.test(path) || /displayName eq 'Tasks'/.test(decodeURIComponent(path)) ? ({ value: [] } as T) : api.get<T>(path)),
      post: async <T,>(path: string, body: unknown) => {
        if (path === "/me/mailFolders" && (body as { displayName: string }).displayName === "Tasks") throw new GraphError(409, "ErrorFolderExists", "exists", path);
        return api.post<T>(path, body);
      },
    };
    const tasks = await ensureFolder(hidden, "Tasks");
    expect(tasks.displayName).toBe("Tasks mail");
    // Any other failure propagates unchanged.
    const broken: GraphApi = { ...api, post: async () => { throw new GraphError(429, "ApplicationThrottled", "slow down", "/me/mailFolders"); } };
    await expect(ensureFolder(broken, "Brand new")).rejects.toMatchObject({ status: 429 });
  });

  it("ensureCategory returns the existing category (any casing) without a POST, so a retried create resumes", async () => {
    calls.length = 0;
    const first = await ensureCategory(api, "Retry me", "preset3");
    expect(calls).toEqual(["POST /me/outlook/masterCategories"]);
    calls.length = 0;
    expect(await ensureCategory(api, "retry ME", "preset5")).toEqual(first);
    expect(calls).toEqual([]);
  });

  it("installPresets isolates a failing label: its line carries the error, the others still install and a re-run resumes", async () => {
    const failing: GraphApi = {
      ...api,
      post: async <T,>(path: string, body: unknown) => {
        if (path === "/me/mailFolders/inbox/messageRules" && /^Label: GSI /.test(String((body as { displayName?: string }).displayName))) throw new GraphError(429, "ApplicationThrottled", "Too many requests", path);
        return api.post<T>(path, body);
      },
    };
    const results = await installPresets(failing, PRESET_LABELS, ME);
    expect(results.map((r) => r.name)).toEqual(PRESET_LABELS.map((p) => p.name));
    const gsi = results.find((r) => r.name === "GSI")!;
    expect(gsi).toMatchObject({ rules: 0, labelled: 0, moved: 0, failed: 1 });
    expect(gsi.error).toBe("ApplicationThrottled: Too many requests");
    for (const r of results.filter((x) => x.name !== "GSI")) expect(r.error).toBeUndefined();
    // GSI's own rules were deleted before the failing POST; the next run recreates them.
    expect(ownRules("GSI", rules())).toHaveLength(0);
    const again = await installPresets(api, PRESET_LABELS, ME);
    expect(again.every((r) => !r.error)).toBe(true);
    expect(ownRules("GSI", rules()).length).toBeGreaterThan(0);
  });
});

describe("preset addresses", () => {
  it("lists both lyzr.ai and lyzr.com for every person, and both reach the rule's fromAddresses", async () => {
    for (const p of PRESET_LABELS) {
      const addrs = p.conditions.fromAddresses ?? [];
      for (const a of addrs) {
        const [local, domain] = a.split("@");
        expect(["lyzr.ai", "lyzr.com"]).toContain(domain);
        expect(addrs).toContain(`${local}@lyzr.ai`);
        expect(addrs).toContain(`${local}@lyzr.com`);
      }
    }
    const leadership = PRESET_LABELS.find((p) => p.name === "Leadership")!;
    const results = await installPresets(mockApi(), [leadership], ME);
    expect(results[0].error).toBeUndefined();
    const senders = rules().find((r) => r.displayName === "Label: Leadership (senders)")!;
    const listed = (senders.conditions?.fromAddresses ?? []).map((r) => r.emailAddress.address);
    expect(listed).toContain("siva@lyzr.ai");
    expect(listed).toContain("siva@lyzr.com");
  });
});
