import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergePeople, rankPeople, resetPeopleSearch, searchRemotePeople, type Person } from "@/lib/people";

const P = (name: string, email: string, source: Person["source"], title?: string): Person => ({ name, email, source, title });

describe("people suggestions: merge, rank, dedupe", () => {
  it("de-duplicates by email (case-insensitive), keeps the first source and fills in a job title", () => {
    const merged = mergePeople([[P("ani", "Ani.Sharma@lyzr.ai", "recent")], [P("Ani Sharma", "ani.sharma@lyzr.ai", "people", "Solutions Engineer")], [P("Ani Sharma", "ani.sharma@lyzr.ai", "contact")]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "recent", title: "Solutions Engineer" });
  });

  it("orders sources recent > people > directory > contact", () => {
    const merged = mergePeople([[P("C", "c@x.com", "contact")], [P("D", "d@x.com", "directory")], [P("R", "r@x.com", "recent")], [P("P", "p@x.com", "people")]]);
    expect(merged.map((p) => p.source)).toEqual(["recent", "people", "directory", "contact"]);
  });

  it("ranks prefix matches before word and substring matches", () => {
    const list = [P("Deepa Menon", "deepa@lyzr.ai", "contact"), P("Shruti Manik", "shruti@lyzr.ai", "directory"), P("Anirudh Narayan", "anirudh@lyzr.ai", "people"), P("Rohan Ani", "rohan@lyzr.ai", "directory")];
    expect(rankPeople(list, "ani").map((p) => p.name)).toEqual(["Anirudh Narayan", "Rohan Ani", "Shruti Manik"]);
    expect(rankPeople(list, "").length).toBe(4);
  });
});

describe("remote people search in mock mode", () => {
  beforeEach(() => {
    localStorage.setItem("msui.mock", "1");
    resetPeopleSearch();
  });
  afterEach(() => localStorage.clear());

  it("merges /me/people and /users results with titles", async () => {
    const out = await searchRemotePeople({} as never, "ani");
    const names = out.map((p) => p.name);
    expect(names).toContain("Anirudh Narayan");
    expect(names).toContain("Ani Sharma");
    expect(out.find((p) => p.name === "Anirudh Narayan")?.title).toBe("GSI Partnerships Lead");
    expect(new Set(out.map((p) => p.email)).size).toBe(out.length);
  });
});
