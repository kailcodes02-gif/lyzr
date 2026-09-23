import { afterEach, describe, expect, it } from "vitest";
import { absorbOperators, addChip, buildSearchKql, chipLabel, matchOperators, parseSearchKql, peopleQuery, personPrefix, recentSearches, rememberSearch, forgetSearch, type SearchChip } from "@/lib/mail/search";
import { suggestionItems } from "@/components/mail/search-suggestions";
import type { Person } from "@/lib/people";

const ani: SearchChip = { kind: "from", name: "Ani Sharma", email: "ani.sharma@lyzr.ai" };

describe("search KQL: chips + text round-trip", () => {
  it("builds from:\"email\" for a person chip and appends the typed words", () => {
    expect(buildSearchKql({ chips: [ani], text: "  quarterly   report " })).toBe('from:"ani.sharma@lyzr.ai" quarterly report');
  });

  it("builds every chip kind", () => {
    const chips: SearchChip[] = [ani, { kind: "to", name: "S", email: "siva@lyzr.ai" }, { kind: "cc", name: "", email: "x@y.z" }, { kind: "subject", value: "invoice" }, { kind: "has", value: "attachment" }, { kind: "is", value: "unread" }, { kind: "after", value: "2026-01-01" }, { kind: "before", value: "2026-02-01" }];
    expect(buildSearchKql({ chips, text: "" })).toBe('from:"ani.sharma@lyzr.ai" to:"siva@lyzr.ai" cc:"x@y.z" subject:invoice hasAttachments:true isRead:false received>=2026-01-01 received<=2026-02-01');
  });

  it("strips quotes the Graph grammar cannot escape", () => {
    expect(buildSearchKql({ chips: [], text: 'say "hi"' })).toBe("say hi");
  });

  it("parses KQL back into chips and names people from a lookup", () => {
    const s = parseSearchKql('from:"ani.sharma@lyzr.ai" to:siva@lyzr.ai hasAttachments:true isRead:false received>=2026-01-01 subject:invoice quarterly report', { "ani.sharma@lyzr.ai": "Ani Sharma" });
    expect(s.text).toBe("quarterly report");
    expect(s.chips).toEqual([
      { kind: "from", name: "Ani Sharma", email: "ani.sharma@lyzr.ai" },
      { kind: "to", name: "siva@lyzr.ai", email: "siva@lyzr.ai" },
      { kind: "has", value: "attachment" },
      { kind: "is", value: "unread" },
      { kind: "after", value: "2026-01-01" },
      { kind: "subject", value: "invoice" },
    ]);
    expect(buildSearchKql(s)).toBe('from:"ani.sharma@lyzr.ai" to:"siva@lyzr.ai" hasAttachments:true isRead:false received>=2026-01-01 subject:invoice quarterly report');
  });

  it("de-duplicates chips and keeps one after:/before:", () => {
    let chips = addChip([], ani);
    chips = addChip(chips, { ...ani, email: "ANI.SHARMA@lyzr.ai" });
    chips = addChip(chips, { kind: "after", value: "2026-01-01" });
    chips = addChip(chips, { kind: "after", value: "2026-03-01" });
    expect(chips).toEqual([ani, { kind: "after", value: "2026-03-01" }]);
    expect(chipLabel(ani)).toBe("From: Ani Sharma");
  });
});

describe("typed operators", () => {
  it("detects a trailing to:/cc:/from: prefix", () => {
    expect(personPrefix("budget to:ani")).toEqual({ kind: "to", query: "ani", before: "budget" });
    expect(personPrefix("cc:")).toEqual({ kind: "cc", query: "", before: "" });
    expect(personPrefix("hello ani")).toBeUndefined();
    expect(peopleQuery("hello ani")).toEqual({ kind: "from", query: "hello ani" });
  });

  it("absorbs finished operator tokens into chips before a search runs", () => {
    const s = absorbOperators({ chips: [], text: "has:attachment is:unread after:2026-01-01 after:bad subject:foo from:a@b.c report" });
    expect(s.text).toBe("after:bad report");
    expect(s.chips.map((c) => c.kind)).toEqual(["has", "is", "after", "subject", "from"]);
  });

  it("offers operators matching the last word, hiding chips already set", () => {
    expect(matchOperators("").map((o) => o.id)).toEqual(["from", "to", "cc", "subject", "has", "is", "after", "before"]);
    expect(matchOperators("report ha").map((o) => o.label)).toEqual(["has:attachment"]);
    expect(matchOperators("ha", [{ kind: "has", value: "attachment" }])).toEqual([]);
    expect(matchOperators("after:2026-05-01")[0]).toMatchObject({ chip: { kind: "after", value: "2026-05-01" } });
  });
});

describe("suggestion rows", () => {
  const people: Person[] = [
    { name: "Ani Sharma", email: "ani.sharma@lyzr.ai", source: "people", title: "Solutions Engineer" },
    { name: "Anirudh Narayan", email: "anirudh@lyzr.ai", source: "directory" },
  ];
  it("empty box: recent searches then quick operators", () => {
    const items = suggestionItems({ text: "", chips: [], people, recent: ["from:a@b.c", "report"] });
    expect(items.slice(0, 2)).toMatchObject([{ type: "recent", kql: "from:a@b.c" }, { type: "recent", kql: "report" }]);
    expect(items.filter((i) => i.type === "operator")).toHaveLength(8);
  });
  it("typed text: people, then Search for, then matching operators; to: prefix tags people To", () => {
    const items = suggestionItems({ text: "ani", chips: [], people, recent: ["x"] });
    expect(items.map((i) => i.type)).toEqual(["person", "person", "text"]);
    expect(items[0]).toMatchObject({ kind: "from" });
    const to = suggestionItems({ text: "budget to:ani", chips: [ani], people, recent: [] });
    expect(to.filter((i) => i.type === "person").map((i) => (i.type === "person" ? i.kind : ""))).toEqual(["to", "to"]);
    const from = suggestionItems({ text: "ani", chips: [ani], people, recent: [] });
    expect(from.filter((i) => i.type === "person")).toHaveLength(1);
  });
});

describe("recent searches", () => {
  afterEach(() => localStorage.clear());
  it("keeps the last 8, newest first, without duplicates", () => {
    for (let i = 0; i < 10; i++) rememberSearch(`q${i}`);
    rememberSearch("q5");
    expect(recentSearches()).toEqual(["q5", "q9", "q8", "q7", "q6", "q4", "q3", "q2"]);
    forgetSearch("q9");
    expect(recentSearches()[1]).toBe("q8");
    expect(rememberSearch("   ")).toHaveLength(7);
  });
});
