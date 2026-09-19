import { describe, expect, it } from "vitest";
import { applyDelta, chunkRanges, contentRange, filterItems, folderTree, isWithin, moveIndex, nextSelection, parseNextExpected, parseUrlState, pathOf, pathSegments, recentItems, serializeUrlState, sortItems, ROOT } from "../logic";
import type { DriveItem, IndexStore } from "../types";

const root: DriveItem = { id: "R", name: "root", root: {} };
const f = (id: string, name: string, parent: string, extra: Partial<DriveItem> = {}): DriveItem => ({ id, name, parentReference: { id: parent, path: "/drive/root:" }, folder: { childCount: 0 }, ...extra });
const file = (id: string, name: string, parent: string, extra: Partial<DriveItem> = {}): DriveItem => ({ id, name, parentReference: { id: parent }, file: { mimeType: "application/octet-stream" }, size: 100, ...extra });

const base: IndexStore = applyDelta({ items: {} }, [
  root,
  f("A", "GSI Program", "R"),
  f("B", "Accenture", "A"),
  file("c", "Deck.pptx", "B", { size: 5000, lastModifiedDateTime: "2026-09-19T10:00:00Z", createdBy: { user: { displayName: "Kailash G M" } } }),
  file("d", "Plan.docx", "A", { size: 200, lastModifiedDateTime: "2026-09-01T10:00:00Z", createdBy: { user: { displayName: "Priya Raman" } } }),
  file("e", "Numbers.xlsx", "R", { size: 900, lastModifiedDateTime: "2026-08-01T10:00:00Z", createdBy: { user: { displayName: "Kailash G M" } } }),
]);

describe("applyDelta", () => {
  it("adds items, records the root id and skips the root from the listing", () => {
    expect(base.rootId).toBe("R");
    expect(Object.keys(base.items).sort()).toEqual(["A", "B", "c", "d", "e"]);
  });
  it("updates existing items and removes @removed / deleted ones", () => {
    const next = applyDelta(base, [
      { id: "d", name: "Plan v2.docx" } as DriveItem,
      { id: "e", name: "", "@removed": { reason: "deleted" } },
      { id: "c", name: "Deck.pptx", deleted: { state: "deleted" } },
    ]);
    expect(next.items.d.name).toBe("Plan v2.docx");
    expect(next.items.d.parentReference?.id).toBe("A"); // merged, not replaced
    expect(next.items.e).toBeUndefined();
    expect(next.items.c).toBeUndefined();
    expect(base.items.e).toBeDefined(); // immutable input
  });
});

describe("pathOf / breadcrumb", () => {
  it("walks the id map from root", () => {
    expect(pathOf(base, "B").map((c) => c.name)).toEqual(["My files", "GSI Program", "Accenture"]);
    expect(pathOf(base, "c").map((c) => c.id)).toEqual([ROOT, "A", "B", "c"]);
    expect(pathOf(base, ROOT)).toEqual([{ id: ROOT, name: "My files" }]);
  });
  it("falls back to decoded parentReference.path segments when a parent is missing", () => {
    const s = applyDelta(base, [file("z", "Orphan.pdf", "missing", { parentReference: { id: "missing", path: "/drive/root:/Weekly%20Reports/2026" } })]);
    expect(pathOf(s, "z").map((c) => c.name)).toEqual(["My files", "Weekly Reports", "2026", "Orphan.pdf"]);
    expect(pathSegments("/drive/root:/A%20B/C")).toEqual(["A B", "C"]);
  });
});

describe("filtering and sorting", () => {
  it("lists folder children, or a type repo across the whole index", () => {
    expect(filterItems(base, { folder: ROOT }).map((i) => i.id).sort()).toEqual(["A", "e"]);
    expect(filterItems(base, { folder: "A" }).map((i) => i.id).sort()).toEqual(["B", "d"]);
    expect(filterItems(base, { repo: "sheets" }).map((i) => i.id)).toEqual(["e"]);
    expect(filterItems(base, { repo: "docs" }).map((i) => i.id)).toEqual(["d"]);
    expect(filterItems(base, { repo: "folders" }).map((i) => i.id).sort()).toEqual(["A", "B"]);
  });
  it("applies search, owner and modified chips", () => {
    expect(filterItems(base, { q: "deck" }).map((i) => i.id)).toEqual(["c"]);
    expect(filterItems(base, { q: "", owner: "Priya Raman", folder: "A" }).map((i) => i.id)).toEqual(["d"]);
    expect(filterItems(base, { repo: "slides", owner: "Kailash G M", modified: "7d" }, new Date("2026-09-20T12:00:00Z")).map((i) => i.id)).toEqual(["c"]);
    expect(filterItems(base, { repo: "slides", modified: "today" }, new Date("2026-09-20T12:00:00Z"))).toEqual([]);
  });
  it("sorts folders first, then by name / modified / size", () => {
    const all = Object.values(base.items);
    expect(sortItems(all, "name").map((i) => i.id)).toEqual(["B", "A", "c", "e", "d"]);
    expect(sortItems(all, "modified").map((i) => i.id).slice(2)).toEqual(["c", "d", "e"]);
    expect(sortItems(all, "size").map((i) => i.id).slice(2)).toEqual(["c", "e", "d"]);
    expect(recentItems(base, 2).map((i) => i.id)).toEqual(["c", "d"]);
  });
  it("builds the folder tree and detects descendants for move safety", () => {
    const t = folderTree(base);
    expect(t.children.map((c) => c.name)).toEqual(["GSI Program"]);
    expect(t.children[0].children.map((c) => c.name)).toEqual(["Accenture"]);
    expect(isWithin(base, "B", "A")).toBe(true);
    expect(isWithin(base, "A", "B")).toBe(false);
    expect(isWithin(base, "A", ROOT)).toBe(false);
  });
});

describe("upload chunking", () => {
  it("splits into 10 MiB chunks that are multiples of 320 KiB, with Content-Range", () => {
    const size = 25 * 1024 * 1024;
    const r = chunkRanges(size);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ start: 0, end: 10485759, length: 10485760 });
    expect(r[0].length % (320 * 1024)).toBe(0);
    expect(r[2]).toEqual({ start: 20971520, end: size - 1, length: size - 20971520 });
    expect(contentRange(r[1], size)).toBe(`bytes 10485760-20971519/${size}`);
    expect(chunkRanges(0)).toEqual([]);
  });
  it("resumes from nextExpectedRanges", () => {
    expect(parseNextExpected(["10485760-"])).toBe(10485760);
    expect(parseNextExpected(["12-99", "200-"])).toBe(12);
    expect(parseNextExpected(undefined)).toBe(0);
    expect(chunkRanges(30, 20, 10)).toEqual([{ start: 20, end: 29, length: 10 }]);
  });
});

describe("URL state", () => {
  it("round-trips folder, repo, view, q, item and layout", () => {
    const s = parseUrlState("?folder=A&repo=docs&view=starred&q=deck&item=c&layout=list");
    expect(s).toEqual({ folder: "A", repo: "docs", view: "starred", q: "deck", item: "c", layout: "list" });
    expect(serializeUrlState(s)).toBe("?folder=A&repo=docs&view=starred&q=deck&item=c&layout=list");
    expect(parseUrlState("")).toEqual({ folder: ROOT, repo: null, view: null, q: "", item: null, layout: null });
    expect(serializeUrlState({ folder: ROOT })).toBe("");
    expect(parseUrlState("?view=bogus&layout=huge").view).toBeNull();
  });
});

describe("selection and keyboard", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  it("single / toggle / range selection", () => {
    expect([...nextSelection(new Set(), ids, "b", null, "single")]).toEqual(["b"]);
    expect([...nextSelection(new Set(["b"]), ids, "d", "b", "toggle")].sort()).toEqual(["b", "d"]);
    expect([...nextSelection(new Set(["b", "d"]), ids, "d", "b", "toggle")]).toEqual(["b"]);
    expect([...nextSelection(new Set(["e"]), ids, "b", "e", "range")]).toEqual(["b", "c", "d", "e"]);
  });
  it("moves focus in a grid", () => {
    expect(moveIndex(-1, 6, "ArrowDown", 3)).toBe(0);
    expect(moveIndex(1, 6, "ArrowDown", 3)).toBe(4);
    expect(moveIndex(4, 6, "ArrowUp", 3)).toBe(1);
    expect(moveIndex(5, 6, "ArrowRight", 3)).toBe(5);
    expect(moveIndex(3, 6, "End", 3)).toBe(5);
    expect(moveIndex(0, 0, "ArrowDown", 3)).toBe(-1);
  });
});
