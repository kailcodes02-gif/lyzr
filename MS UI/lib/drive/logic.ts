// Pure logic for the OneDrive UI: delta application, paths, view filtering,
// sorting, upload chunking and URL state. No React, no Graph calls.
import { fileKind, KIND_VIEWS, type FileKind } from "@/lib/files";
import type { Crumb, DriveItem, IndexStore } from "./types";

export const ROOT = "root";

// Applies a page of /delta items to the index. The root item itself is
// recorded (so children of root can be found) but never listed.
export function applyDelta(store: IndexStore, page: DriveItem[]): IndexStore {
  const items = { ...store.items };
  let rootId = store.rootId;
  for (const it of page) {
    if (!it?.id) continue;
    if (it.root) {
      rootId = it.id;
      continue;
    }
    if (it["@removed"] || it.deleted) {
      delete items[it.id];
      continue;
    }
    items[it.id] = { ...items[it.id], ...it };
  }
  return { ...store, items, rootId };
}

export function kindOf(item: DriveItem): FileKind {
  return fileKind(item.name, item.file?.mimeType, Boolean(item.folder) || Boolean(item.package));
}

export function isFolder(item: DriveItem): boolean {
  return Boolean(item.folder);
}

// Normalises "root" to the real root id, and vice versa.
export function resolveParent(store: IndexStore, id: string | null | undefined): string {
  if (!id || id === ROOT) return store.rootId ?? ROOT;
  return id;
}

export function childrenOf(store: IndexStore, folderId: string | null | undefined): DriveItem[] {
  const pid = resolveParent(store, folderId);
  const out: DriveItem[] = [];
  for (const it of Object.values(store.items)) {
    const p = it.parentReference?.id;
    if (p === pid || (pid === ROOT && !p)) out.push(it);
  }
  return out;
}

// Segments after "root:" in parentReference.path, decoded.
export function pathSegments(path?: string): string[] {
  if (!path) return [];
  const i = path.indexOf("root:");
  const rest = i >= 0 ? path.slice(i + 5) : path;
  return rest
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

// Breadcrumb from root to the item (inclusive when it is a folder). Walks the
// id map; falls back to the parentReference.path segments when a parent is
// missing from the index (search results, shared items).
export function pathOf(store: IndexStore, id: string | null | undefined): Crumb[] {
  const crumbs: Crumb[] = [];
  const rid = store.rootId ?? ROOT;
  let cur = id && id !== ROOT ? store.items[id] : undefined;
  if (id && id !== ROOT && !cur) return [{ id: ROOT, name: "My files" }];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    crumbs.unshift({ id: cur.id, name: cur.name });
    const pid = cur.parentReference?.id;
    if (!pid || pid === rid) break;
    const parent: DriveItem | undefined = store.items[pid];
    if (!parent) {
      const segs = pathSegments(cur.parentReference?.path);
      for (let i = segs.length - 1; i >= 0; i--) crumbs.unshift({ id: `path:${segs.slice(0, i + 1).join("/")}`, name: segs[i] });
      break;
    }
    cur = parent;
  }
  crumbs.unshift({ id: ROOT, name: "My files" });
  return crumbs;
}

export function ownerName(item: DriveItem): string {
  return item.createdBy?.user?.displayName ?? item.lastModifiedBy?.user?.displayName ?? "";
}

export type SortKey = "name" | "modified" | "size";
export type ModifiedFilter = "" | "today" | "7d" | "30d" | "year";

export type ViewFilter = {
  folder?: string | null;
  repo?: string | null; // docs | sheets | slides | pdfs | images | videos | folders
  q?: string | null;
  kinds?: FileKind[]; // Type chip
  owner?: string | null; // People chip
  modified?: ModifiedFilter;
};

export function modifiedSince(filter: ModifiedFilter, now = new Date()): Date | null {
  const d = new Date(now);
  switch (filter) {
    case "today":
      d.setHours(0, 0, 0, 0);
      return d;
    case "7d":
      d.setDate(d.getDate() - 7);
      return d;
    case "30d":
      d.setDate(d.getDate() - 30);
      return d;
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    default:
      return null;
  }
}

export function repoKinds(repo?: string | null): FileKind[] | null {
  if (!repo) return null;
  return KIND_VIEWS.find((v) => v.key === repo)?.kinds ?? null;
}

// The main listing: a folder's children, or a "repo" (type view) / search
// across the whole index, then the chips.
export function filterItems(store: IndexStore, f: ViewFilter, now = new Date()): DriveItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const rk = repoKinds(f.repo);
  let list: DriveItem[] = rk || q ? Object.values(store.items) : childrenOf(store, f.folder);
  if (rk) list = list.filter((it) => rk.includes(kindOf(it)));
  return applyChips(list, f, now);
}

// The Type / People / Modified chips, applied to any list (folder listing,
// starred, shared, recent).
export function applyChips(list: DriveItem[], f: Pick<ViewFilter, "kinds" | "owner" | "modified" | "q">, now = new Date()): DriveItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  if (q) list = list.filter((it) => it.name.toLowerCase().includes(q));
  if (f.kinds && f.kinds.length) list = list.filter((it) => f.kinds!.includes(kindOf(it)));
  if (f.owner) list = list.filter((it) => ownerName(it) === f.owner);
  const since = modifiedSince(f.modified ?? "", now);
  if (since) list = list.filter((it) => it.lastModifiedDateTime && new Date(it.lastModifiedDateTime) >= since);
  return list;
}

export function sortItems(items: DriveItem[], key: SortKey, dir: "asc" | "desc" = key === "name" ? "asc" : "desc"): DriveItem[] {
  const m = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const fa = isFolder(a) ? 0 : 1;
    const fb = isFolder(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    let c = 0;
    if (key === "name") c = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    else if (key === "modified") c = (a.lastModifiedDateTime ?? "").localeCompare(b.lastModifiedDateTime ?? "");
    else c = (a.size ?? 0) - (b.size ?? 0);
    if (c === 0) c = a.name.localeCompare(b.name, undefined, { numeric: true });
    return c * m;
  });
}

export function recentItems(store: IndexStore, limit = 60): DriveItem[] {
  return Object.values(store.items)
    .filter((it) => !isFolder(it))
    .sort((a, b) => (b.lastModifiedDateTime ?? "").localeCompare(a.lastModifiedDateTime ?? ""))
    .slice(0, limit);
}

export function ownersIn(store: IndexStore): string[] {
  const s = new Set<string>();
  for (const it of Object.values(store.items)) {
    const n = ownerName(it);
    if (n) s.add(n);
  }
  return Array.from(s).sort();
}

// All folders of the index as a tree, for the Move dialog.
export type FolderNode = { id: string; name: string; children: FolderNode[] };
export function folderTree(store: IndexStore): FolderNode {
  const rid = store.rootId ?? ROOT;
  const nodes = new Map<string, FolderNode>();
  nodes.set(ROOT, { id: ROOT, name: "My files", children: [] });
  const folders = Object.values(store.items).filter(isFolder);
  for (const f of folders) nodes.set(f.id, { id: f.id, name: f.name, children: [] });
  for (const f of folders) {
    const pid = f.parentReference?.id;
    const parent = nodes.get(!pid || pid === rid ? ROOT : pid);
    (parent ?? nodes.get(ROOT)!).children.push(nodes.get(f.id)!);
  }
  const sortRec = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.children.forEach(sortRec);
  };
  sortRec(nodes.get(ROOT)!);
  return nodes.get(ROOT)!;
}

// True when `candidate` is `folderId` itself or one of its descendants.
export function isWithin(store: IndexStore, candidate: string, folderId: string): boolean {
  if (folderId === ROOT || folderId === store.rootId) return false;
  let cur: DriveItem | undefined = store.items[candidate];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === folderId) return true;
    seen.add(cur.id);
    cur = cur.parentReference?.id ? store.items[cur.parentReference.id] : undefined;
  }
  return false;
}

// Upload chunking: 10 MiB chunks, a multiple of 320 KiB as Graph requires.
export const CHUNK_SIZE = 32 * 320 * 1024; // 10485760
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

export type Range = { start: number; end: number; length: number };
export function chunkRanges(size: number, from = 0, chunk = CHUNK_SIZE): Range[] {
  const out: Range[] = [];
  if (size === 0) return out;
  for (let start = from; start < size; start += chunk) {
    const end = Math.min(start + chunk, size) - 1;
    out.push({ start, end, length: end - start + 1 });
  }
  return out;
}

export function contentRange(r: Range, size: number): string {
  return `bytes ${r.start}-${r.end}/${size}`;
}

// "12345-" or "12345-67890" from nextExpectedRanges.
export function parseNextExpected(ranges?: string[]): number {
  const first = ranges?.[0];
  if (!first) return 0;
  const n = parseInt(first.split("-")[0], 10);
  return Number.isFinite(n) ? n : 0;
}

// URL state: /onedrive/?folder=&repo=&view=&q=&item=&layout=
export type DriveUrlState = {
  folder: string; // "root" when unset
  repo: string | null;
  view: "starred" | "recent" | "shared" | null;
  q: string;
  item: string | null;
  layout: "grid" | "list" | null;
};

export function parseUrlState(params: URLSearchParams | string): DriveUrlState {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const view = p.get("view");
  const layout = p.get("layout");
  return {
    folder: p.get("folder") || ROOT,
    repo: p.get("repo") || null,
    view: view === "starred" || view === "recent" || view === "shared" ? view : null,
    q: p.get("q") ?? "",
    item: p.get("item") || null,
    layout: layout === "grid" || layout === "list" ? layout : null,
  };
}

export function serializeUrlState(s: Partial<DriveUrlState>): string {
  const p = new URLSearchParams();
  if (s.folder && s.folder !== ROOT) p.set("folder", s.folder);
  if (s.repo) p.set("repo", s.repo);
  if (s.view) p.set("view", s.view);
  if (s.q) p.set("q", s.q);
  if (s.item) p.set("item", s.item);
  if (s.layout) p.set("layout", s.layout);
  const str = p.toString();
  return str ? `?${str}` : "";
}

// Selection helpers for click / shift-click / ctrl-click.
export function nextSelection(current: Set<string>, ordered: string[], id: string, anchor: string | null, mode: "single" | "toggle" | "range"): Set<string> {
  if (mode === "toggle") {
    const s = new Set(current);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    return s;
  }
  if (mode === "range" && anchor) {
    const a = ordered.indexOf(anchor);
    const b = ordered.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return new Set(ordered.slice(lo, hi + 1));
    }
  }
  return new Set([id]);
}

// Arrow-key navigation in a grid of `cols` columns.
export function moveIndex(index: number, count: number, key: string, cols: number): number {
  if (count === 0) return -1;
  if (index < 0) return 0;
  let n = index;
  if (key === "ArrowRight") n = index + 1;
  else if (key === "ArrowLeft") n = index - 1;
  else if (key === "ArrowDown") n = index + cols;
  else if (key === "ArrowUp") n = index - cols;
  else if (key === "Home") n = 0;
  else if (key === "End") n = count - 1;
  return Math.max(0, Math.min(count - 1, n));
}

export function itemUrl(id: string, s: Partial<DriveUrlState>): string {
  return serializeUrlState({ ...s, item: id });
}
