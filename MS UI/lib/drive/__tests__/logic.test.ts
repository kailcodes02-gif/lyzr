import { describe, expect, it } from "vitest";
import { applyChips, applyDelta, canMutate, chunkRanges, contentRange, filterItems, folderTree, isWithin, kindOf, moveIndex, nextSelection, normalizeRemoteItem, ownerName, parseNextExpected, parseUrlState, pathOf, pathSegments, recentItems, recycleBinUrl, safeId, serializeUrlState, sortItems, ROOT } from "../logic";
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

describe("delta without the root facet ($select) and tombstones", () => {
  it("keeps a pre-seeded rootId, hides the root item and lists real top-level children", () => {
    const seeded: IndexStore = { items: {}, rootId: "R" };
    const s = applyDelta(seeded, [{ id: "R", name: "root", folder: { childCount: 2 } }, f("A", "GSI Program", "R"), file("e", "Numbers.xlsx", "R")]);
    expect(s.rootId).toBe("R");
    expect(s.items.R).toBeUndefined();
    expect(filterItems(s, { folder: ROOT }).map((i) => i.id).sort()).toEqual(["A", "e"]);
    expect(pathOf(s, "A").map((c) => c.id)).toEqual([ROOT, "A"]);
  });
  it("treats a nameless deleted tombstone as authoritative (no merge)", () => {
    const s = applyDelta(base, [{ id: "d", deleted: { state: "deleted" } } as DriveItem]);
    expect(s.items.d).toBeUndefined();
  });
});

describe("shared items and name-less items", () => {
  const raw: DriveItem = { id: "1312abc", remoteItem: { id: "1991210caf!192", name: "March Proposal.docx", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, size: 19121, parentReference: { driveId: "1991210caf", id: "1991210caf!104" }, shared: { sharedBy: { user: { displayName: "Priya Raman" } } } } } as DriveItem;
  it("normalises remoteItem into the DriveItem shape and keeps the shortcut id", () => {
    const n = normalizeRemoteItem(raw);
    expect(n.id).toBe("1312abc");
    expect(n.name).toBe("March Proposal.docx");
    expect(n.size).toBe(19121);
    expect(n.parentReference?.driveId).toBe("1991210caf");
    expect(kindOf(n)).toBe("doc");
    expect(ownerName(n)).toBe("Priya Raman");
    expect(n.remoteItem).toBe(raw.remoteItem);
  });
  it("never throws when name is missing (sorting, chips, kind)", () => {
    const bare = { id: "x" } as DriveItem;
    expect(() => sortItems([bare, raw, ...Object.values(base.items)], "name")).not.toThrow();
    expect(() => sortItems([bare, raw], "size")).not.toThrow();
    expect(applyChips([bare, normalizeRemoteItem(raw)], { q: "march" }).map((i) => i.id)).toEqual(["1312abc"]);
    expect(kindOf(bare)).toBe("other");
  });
  it("blocks mutations on remote and foreign-drive items", () => {
    expect(canMutate(normalizeRemoteItem(raw), "b!mine")).toBe(false);
    expect(canMutate(file("z", "Z.txt", "R", { parentReference: { id: "R", driveId: "b!other" } }), "b!mine")).toBe(false);
    expect(canMutate(file("z", "Z.txt", "R", { parentReference: { id: "R", driveId: "b!mine" } }), "b!mine")).toBe(true);
    expect(canMutate(file("z", "Z.txt", "R"), undefined)).toBe(true);
  });
});

describe("URL ids and recycle bin link", () => {
  it("rejects ids that would change the Graph path", () => {
    expect(parseUrlState("?folder=root/children%3F$top=1%23").folder).toBe(ROOT);
    expect(parseUrlState("?item=x/move").item).toBeNull();
    expect(parseUrlState("?folder=01ABC!123&item=01ABC!124")).toMatchObject({ folder: "01ABC!123", item: "01ABC!124" });
    expect(safeId("a/b")).toBeNull();
    expect(safeId("a#b")).toBeNull();
  });
  it("builds the work-account recycle bin from the drive webUrl, with fallbacks", () => {
    expect(recycleBinUrl({ driveType: "business", webUrl: "https://lyzr-my.sharepoint.com/personal/kailash_lyzr_com/Documents" })).toBe("https://lyzr-my.sharepoint.com/personal/kailash_lyzr_com/_layouts/15/onedrive.aspx?view=5");
    expect(recycleBinUrl({ driveType: "business", webUrl: "https://lyzr-my.sharepoint.com/personal/kailash_lyzr_com/Documents/" })).toContain("/_layouts/15/onedrive.aspx?view=5");
    expect(recycleBinUrl({ driveType: "business", webUrl: "https://lyzr.sharepoint.com/sites/Marketing/Shared%20Documents" })).toBe("https://lyzr.sharepoint.com/sites/Marketing/_layouts/15/onedrive.aspx?view=5");
    expect(recycleBinUrl({ driveType: "business", webUrl: "https://example.invalid/odd" })).toBe("https://example.invalid/odd");
    expect(recycleBinUrl({ driveType: "personal", webUrl: "https://onedrive.live.com/?cid=1" })).toBe("https://onedrive.live.com/?view=recyclebin");
    expect(recycleBinUrl(undefined)).toBe("https://onedrive.live.com/?view=recyclebin");
  });
});
