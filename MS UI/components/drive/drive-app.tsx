"use client";

import { useMsal } from "@azure/msal-react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ExternalLink, FolderInput, FolderOpen, Info, Pencil, Search, Share2, Star, StarOff, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { ConsentStatus } from "@/components/consent-status";
import { Button } from "@/components/ui/button";
import { copyItem, createFolder, deleteItem, downloadItem, followItem, moveItem, renameItem, useDriveSearch, useQuota, useSharedWithMe, useStarred } from "@/lib/drive/api";
import { isConsentError, useDriveIndex } from "@/lib/drive/index";
import { applyChips, filterItems, folderTree, isFolder, isWithin, moveIndex, nextSelection, parseUrlState, recentItems, ROOT, serializeUrlState, sortItems, ownersIn, type DriveUrlState, type SortKey } from "@/lib/drive/logic";
import type { DriveItem } from "@/lib/drive/types";
import { enqueueUploads } from "@/lib/drive/upload";
import { isMockMode } from "@/lib/mock";
import { Breadcrumb } from "./breadcrumb";
import { ContextMenu, type MenuAction } from "./context-menu";
import { DetailsPanel } from "./details-panel";
import { ConfirmDeleteDialog, MoveDialog, NameDialog } from "./dialogs";
import { FileListing, ListingSkeleton } from "./file-listing";
import { LeftPanel, type NavKey } from "./left-panel";
import { PreviewModal } from "./preview-modal";
import { ShareDialog } from "./share-dialog";
import { TopBar, type Filters } from "./top-bar";
import { UploadTray } from "./upload-tray";

const LAYOUT_KEY = "msui.drive.layout";
const layoutListeners = new Set<() => void>();
function subscribeLayout(cb: () => void) {
  layoutListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    layoutListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readLayout(): "grid" | "list" {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
const VIEW_TITLE: Record<string, string> = { starred: "Starred", recent: "Recent", shared: "Shared with me", docs: "Docs", sheets: "Sheets", slides: "Slides", pdfs: "PDFs", images: "Images", videos: "Videos", folders: "Folders" };

function isTyping(e: KeyboardEvent) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[role=dialog]") !== null;
}

export function DriveApp() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const url = useMemo(() => parseUrlState(params.toString()), [params]);
  const setUrl = useCallback(
    (patch: Partial<DriveUrlState>, push = false) => {
      const next = serializeUrlState({ ...url, ...patch });
      const href = `${pathname}${next}`;
      if (push) router.push(href);
      else router.replace(href);
    },
    [url, pathname, router]
  );

  const index = useDriveIndex();
  const quota = useQuota();
  const starredQ = useStarred();
  const sharedQ = useSharedWithMe(url.view === "shared");
  const starred = useMemo(() => new Set((starredQ.data ?? []).map((i) => i.id)), [starredQ.data]);

  const layout = useSyncExternalStore(subscribeLayout, readLayout, () => "grid" as const);
  const effectiveLayout = url.layout ?? layout;
  const setLayout = (l: "grid" | "list") => {
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      // storage blocked
    }
    layoutListeners.forEach((f) => f());
    if (url.layout) setUrl({ layout: l });
  };

  const [filters, setFilters] = useState<Filters>({ kinds: [], owner: null, modified: "" });
  const [sort, setSort] = useState<SortKey>("name");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [cols, setCols] = useState(4);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: DriveItem } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DriveItem | null>(null);
  const [moveState, setMoveState] = useState<{ mode: "move" | "copy"; ids: string[] } | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [shareTarget, setShareTarget] = useState<DriveItem | null>(null);
  const [serverSearchFor, setServerSearchFor] = useState<string | null>(null);
  const serverSearch = serverSearchFor === url.q;
  const setServerSearch = (on: boolean) => setServerSearchFor(on ? url.q : null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const remote = useDriveSearch(serverSearch ? url.q : "");

  // What the main pane shows.
  const listing = useMemo(() => {
    let base: DriveItem[];
    const chips = { kinds: filters.kinds, owner: filters.owner, modified: filters.modified };
    if (url.view === "starred") base = applyChips(starredQ.data ?? [], { ...chips, q: url.q });
    else if (url.view === "shared") base = applyChips(sharedQ.data ?? [], { ...chips, q: url.q });
    else if (url.view === "recent") base = applyChips(recentItems(index.store), { ...chips, q: url.q });
    else base = filterItems(index.store, { folder: url.folder, repo: url.repo, q: url.q, ...chips });
    if (url.view === "recent" && sort === "name") return sortItems(base, "modified");
    return sortItems(base, sort);
  }, [index.store, url, filters, sort, starredQ.data, sharedQ.data]);
  const orderedIds = useMemo(() => listing.map((i) => i.id), [listing]);
  const byId = index.byId;
  const currentApiFolder = url.folder === ROOT ? "root" : url.folder;
  const currentParentId = url.folder === ROOT ? index.rootId : url.folder;

  // Clear selection when the listing changes context.
  const ctxKey = `${url.folder}|${url.repo}|${url.view}`;
  const [prevCtxKey, setPrevCtxKey] = useState(ctxKey);
  if (ctxKey !== prevCtxKey) {
    setPrevCtxKey(ctxKey);
    setSelected(new Set());
    setAnchor(null);
    setFocusedId(null);
  }

  const previewItem = url.item ? (byId[url.item] ?? listing.find((i) => i.id === url.item) ?? (starredQ.data ?? []).find((i) => i.id === url.item) ?? (sharedQ.data ?? []).find((i) => i.id === url.item) ?? null) : null;
  const previewList = listing.filter((i) => !isFolder(i));
  const previewIdx = previewItem ? previewList.findIndex((i) => i.id === previewItem.id) : -1;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["drive"] });
  const afterMutation = async () => {
    await index.refresh();
    void invalidate();
  };

  const openItem = useCallback(
    (item: DriveItem) => {
      if (isFolder(item)) setUrl({ folder: item.id, repo: null, view: null, q: "", item: null }, true);
      else if (item.remoteItem && item.webUrl) window.open(item.webUrl, "_blank", "noopener");
      else setUrl({ item: item.id });
    },
    [setUrl]
  );

  const select = useCallback(
    (id: string, mode: "single" | "toggle" | "range") => {
      setSelected((cur) => nextSelection(cur, orderedIds, id, anchor, mode));
      if (mode !== "range") setAnchor(id);
      setFocusedId(id);
    },
    [orderedIds, anchor]
  );

  const nav = (k: NavKey) => {
    if (k === "myfiles") setUrl({ folder: ROOT, repo: null, view: null, q: "", item: null }, true);
    else if (k.startsWith("repo:")) setUrl({ folder: ROOT, repo: k.slice(5), view: null, item: null }, true);
    else setUrl({ folder: ROOT, repo: null, view: k as "starred" | "recent" | "shared", item: null }, true);
  };
  const activeNav: NavKey = url.view ? url.view : url.repo ? `repo:${url.repo}` : "myfiles";

  // Mutations, optimistic with rollback.
  const doRename = async (item: DriveItem, name: string) => {
    setRenameTarget(null);
    if (name === item.name) return;
    index.patchLocal(item.id, { name });
    try {
      await renameItem(instance, item.id, name);
      void afterMutation();
    } catch (e) {
      index.patchLocal(item.id, { name: item.name });
      toast.error("Could not rename", { description: (e as Error).message });
    }
  };

  const doMove = async (ids: string[], target: string) => {
    const targetId = target === ROOT ? index.rootId : target;
    const valid = ids.filter((id) => byId[id] && !isWithin(index.store, target, id) && byId[id].parentReference?.id !== targetId);
    if (!valid.length) return;
    const prev = valid.map((id) => byId[id]);
    for (const it of prev) index.patchLocal(it.id, { parentReference: { ...it.parentReference, id: targetId } });
    setSelected(new Set());
    try {
      await Promise.all(valid.map((id) => moveItem(instance, id, target === ROOT ? "root" : target)));
      toast.success(valid.length === 1 ? `Moved "${prev[0].name}"` : `Moved ${valid.length} items`, {
        action: { label: "Undo", onClick: () => void Promise.all(prev.map((it) => moveItem(instance, it.id, it.parentReference?.id === index.rootId ? "root" : (it.parentReference?.id ?? "root")))).then(afterMutation) },
      });
      void afterMutation();
    } catch (e) {
      for (const it of prev) index.patchLocal(it.id, { parentReference: it.parentReference });
      toast.error("Could not move", { description: (e as Error).message });
    }
  };

  const doCopy = async (ids: string[], target: string) => {
    const t = toast.loading(ids.length === 1 ? "Copying..." : `Copying ${ids.length} items...`);
    try {
      await Promise.all(ids.map((id) => copyItem(instance, id, target === ROOT ? "root" : target, byId[id]?.parentReference?.driveId)));
      toast.success("Copied", { id: t });
      void afterMutation();
    } catch (e) {
      toast.error("Could not copy", { id: t, description: (e as Error).message });
    }
  };

  const doDelete = async (ids: string[]) => {
    setDeleteIds(null);
    const prev = ids.map((id) => byId[id]).filter(Boolean);
    for (const it of prev) index.patchLocal(it.id, null);
    setSelected(new Set());
    if (url.item && ids.includes(url.item)) setUrl({ item: null });
    try {
      await Promise.all(ids.map((id) => deleteItem(instance, id)));
      toast.success(prev.length === 1 ? `"${prev[0].name}" moved to the recycle bin` : `${ids.length} items moved to the recycle bin`);
      void afterMutation();
    } catch (e) {
      for (const it of prev) index.patchLocal(it.id, it);
      toast.error("Could not delete", { description: (e as Error).message });
    }
  };

  const doStar = async (item: DriveItem) => {
    const key = ["drive", "following"];
    const was = starred.has(item.id);
    qc.setQueriesData<DriveItem[]>({ queryKey: key }, (old) => (was ? (old ?? []).filter((i) => i.id !== item.id) : [...(old ?? []), item]));
    try {
      await followItem(instance, item.id, !was);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      qc.setQueriesData<DriveItem[]>({ queryKey: key }, (old) => (was ? [...(old ?? []), item] : (old ?? []).filter((i) => i.id !== item.id)));
      toast.error(was ? "Could not remove star" : "Could not star", { description: (e as Error).message });
    }
  };

  const doNewFolder = async (name: string) => {
    setNewFolderOpen(false);
    try {
      const created = await createFolder(instance, currentApiFolder, name);
      index.patchLocal(created.id, { ...created, parentReference: { ...created.parentReference, id: created.parentReference?.id ?? currentParentId } });
      toast.success(`Folder "${created.name}" created`);
      void afterMutation();
    } catch (e) {
      toast.error("Could not create folder", { description: (e as Error).message });
    }
  };

  const uploadFiles = async (files: File[], parentId = currentApiFolder) => {
    if (!files.length) return;
    const created = await enqueueUploads(instance, files.map((file) => ({ file, parentId })));
    for (const it of created) index.patchLocal(it.id, it);
    void afterMutation();
  };

  const uploadFolder = async (files: File[]) => {
    // Create the folder skeleton first (cached by path), then upload files.
    const cache = new Map<string, string>([["", currentApiFolder]]);
    const t = toast.loading("Creating folders...");
    try {
      const ensure = async (dir: string): Promise<string> => {
        if (cache.has(dir)) return cache.get(dir)!;
        const parts = dir.split("/");
        const parent = await ensure(parts.slice(0, -1).join("/"));
        const made = await createFolder(instance, parent, parts[parts.length - 1]);
        index.patchLocal(made.id, made);
        cache.set(dir, made.id);
        return made.id;
      };
      const jobs: { file: File; parentId: string }[] = [];
      for (const f of files) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const dir = rel.split("/").slice(0, -1).join("/");
        jobs.push({ file: f, parentId: await ensure(dir) });
      }
      toast.dismiss(t);
      const created = await enqueueUploads(instance, jobs);
      for (const it of created) index.patchLocal(it.id, it);
      void afterMutation();
    } catch (e) {
      toast.error("Folder upload failed", { id: t, description: (e as Error).message });
    }
  };

  const dropzone = useDropzone({ noClick: true, noKeyboard: true, onDrop: (accepted) => void uploadFiles(accepted) });

  // Keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTyping(e) || previewItem || ctx) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const sel = Array.from(selected);
      const focus = focusedId ? byId[focusedId] ?? listing.find((i) => i.id === focusedId) : undefined;
      if (e.key === "Enter" && focus) openItem(focus);
      else if (e.key === "Backspace" && !url.view && !url.repo && url.folder !== ROOT) {
        const crumbs = index.pathOf(url.folder);
        const up = crumbs[crumbs.length - 2];
        if (up) setUrl({ folder: up.id, item: null }, true);
      } else if (e.key === "Delete" && sel.length) setDeleteIds(sel);
      else if (e.key === "n" && !e.metaKey && !e.ctrlKey) setNewFolderOpen(true);
      else if (e.key === "s" && focus && !e.metaKey && !e.ctrlKey) void doStar(focus);
      else if (e.key === "g" && !e.metaKey && !e.ctrlKey) setLayout(effectiveLayout === "grid" ? "list" : "grid");
      else if (e.key === "Escape") {
        setSelected(new Set());
        setFocusedId(null);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelected(new Set(orderedIds));
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const idx = focusedId ? orderedIds.indexOf(focusedId) : -1;
        const n = moveIndex(idx, orderedIds.length, e.key, effectiveLayout === "grid" ? cols : 1);
        const id = orderedIds[n];
        if (id) {
          select(id, e.shiftKey ? "range" : "single");
          document.getElementById(`drive-item-${id}`)?.scrollIntoView({ block: "nearest" });
        }
      } else return;
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const menuFor = (item: DriveItem): MenuAction[] => {
    const ids = selected.has(item.id) ? Array.from(selected) : [item.id];
    const many = ids.length > 1;
    const shared = Boolean(item.remoteItem);
    return [
      { label: isFolder(item) ? "Open" : "Preview", icon: FolderOpen, onSelect: () => openItem(item), shortcut: "Enter" },
      { label: "Open in OneDrive", icon: ExternalLink, onSelect: () => item.webUrl && window.open(item.webUrl, "_blank", "noopener"), disabled: !item.webUrl },
      { label: "Download", icon: Download, onSelect: () => downloadItem(instance, item.id, item.name).catch((e) => toast.error("Download failed", { description: (e as Error).message })), disabled: isFolder(item) || shared },
      { label: "Rename", icon: Pencil, onSelect: () => setRenameTarget(item), separator: true, disabled: many || shared },
      { label: many ? `Move ${ids.length} items to` : "Move to", icon: FolderInput, onSelect: () => setMoveState({ mode: "move", ids }), disabled: shared },
      { label: many ? `Copy ${ids.length} items to` : "Make a copy in", icon: Copy, onSelect: () => setMoveState({ mode: "copy", ids }), disabled: shared },
      { label: starred.has(item.id) ? "Remove from starred" : "Add to starred", icon: starred.has(item.id) ? StarOff : Star, onSelect: () => void doStar(item), separator: true, shortcut: "s", disabled: shared },
      { label: "Share", icon: Share2, onSelect: () => setShareTarget(item), disabled: shared },
      { label: "Details", icon: Info, onSelect: () => { select(item.id, "single"); setDetailsOpen(true); } },
      { label: many ? `Delete ${ids.length} items` : "Delete", icon: Trash2, onSelect: () => setDeleteIds(ids), danger: true, separator: true, shortcut: "Del", disabled: shared },
    ];
  };

  // Consent gate: 401/403 from the index means Files.ReadWrite is not approved.
  if (index.status.error && isConsentError(index.status.error) && index.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-normal">OneDrive</h1>
        <p className="text-sm text-muted-foreground">
          Microsoft returned an authorization error for your files. The <b>Files.ReadWrite</b> permission has to be approved by a Lyzr admin before this page can list your OneDrive.
          {!isMockMode() && <> Until then, add <code className="mx-1">?mock=1</code> to the URL to try the demo with sample data.</>}
        </p>
        <ConsentStatus only={["drive"]} />
      </div>
    );
  }

  const crumbs = index.pathOf(url.folder);
  const title = url.view ? VIEW_TITLE[url.view] : url.repo ? VIEW_TITLE[url.repo] : undefined;
  const loading = !index.status.loaded && index.items.length === 0 && !index.status.error;
  const selectedItem = selected.size === 1 ? (byId[Array.from(selected)[0]] ?? listing.find((i) => i.id === Array.from(selected)[0]) ?? null) : null;
  const tree = folderTree(index.store);
  const moveDisabled = new Set<string>();
  if (moveState) for (const id of moveState.ids) for (const f of Object.values(index.store.items)) if (isWithin(index.store, f.id, id)) moveDisabled.add(f.id);

  return (
    <div className="flex h-screen min-w-0 bg-background">
      <LeftPanel active={activeNav} onNav={nav} onNewFolder={() => setNewFolderOpen(true)} onUploadFiles={() => fileInput.current?.click()} onUploadFolder={() => folderInput.current?.click()} quota={quota.data?.quota} indexing={index.status.indexing} count={index.status.count} lastSync={index.status.lastSync} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} aria-label="Upload files" />
      <input ref={folderInput} type="file" hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => { void uploadFolder(Array.from(e.target.files ?? [])); e.target.value = ""; }} aria-label="Upload folder" />

      <div {...dropzone.getRootProps({ className: "relative flex min-w-0 flex-1 flex-col" })}>
        <input {...dropzone.getInputProps()} />
        {dropzone.isDragActive && (
          <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#1a73e8] bg-[#1a73e8]/10 text-lg text-[#1a73e8]">
            Drop files to upload to {url.folder === ROOT ? "My files" : crumbs[crumbs.length - 1]?.name}
          </div>
        )}
        <TopBar ref={searchRef} q={url.q} onQ={(q) => setUrl({ q })} filters={filters} onFilters={setFilters} owners={ownersIn(index.store)} sort={sort} onSort={setSort} layout={effectiveLayout} onLayout={setLayout} />
        <div className="flex items-center gap-2 pr-3">
          <div className="min-w-0 flex-1">
            <Breadcrumb crumbs={url.q ? [{ id: ROOT, name: `Results for "${url.q}"` }] : crumbs} title={url.q ? undefined : title} onOpen={(id) => setUrl({ folder: id, item: null }, true)} onDropIds={(ids, folder) => void doMove(ids, folder)} />
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-1 rounded-full bg-[#c2e7ff] py-1 pr-1 pl-3 text-xs text-[#001d35] dark:bg-primary/25 dark:text-foreground">
              {selected.size} selected
              <Button variant="ghost" size="icon-xs" aria-label="Clear selection" className="rounded-full" onClick={() => setSelected(new Set())}><X /></Button>
            </div>
          )}
          <Button variant="ghost" size="icon" aria-label="Details" aria-pressed={detailsOpen} onClick={() => setDetailsOpen((d) => !d)}><Info /></Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto pb-24" onClick={() => setSelected(new Set())}>
            {index.status.indexing && index.items.length === 0 && (
              <p className="px-4 pb-2 text-xs text-muted-foreground" aria-live="polite">Indexing your OneDrive for the first time: {index.status.count.toLocaleString()} items so far. Type views, search and people filters work from this index.</p>
            )}
            {Boolean(index.status.error) && !isConsentError(index.status.error) && (
              <div className="mx-4 mb-3 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
                <span className="flex-1">Could not refresh the index: {(index.status.error as Error).message}</span>
                <Button size="sm" variant="outline" onClick={() => void index.refresh()}>Retry</Button>
              </div>
            )}
            {url.view === "shared" && (sharedQ.isError || (sharedQ.data && sharedQ.data.length === 0)) && (
              <p className="mx-4 mb-3 rounded-xl bg-accent/60 px-4 py-2 text-xs text-muted-foreground">
                Nothing to show here. Microsoft is retiring the &quot;Shared with me&quot; API in November 2026, so this list may be empty; files shared with you still open from the OneDrive web app.
              </p>
            )}
            {loading || (url.view === "starred" && starredQ.isPending) || (url.view === "shared" && sharedQ.isPending) ? (
              <ListingSkeleton layout={effectiveLayout} />
            ) : listing.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <FolderOpen className="h-14 w-14 text-muted-foreground/40" />
                <p className="text-base">{url.q ? "No matching files" : url.view === "starred" ? "No starred files" : url.view === "recent" ? "No recent files" : url.view === "shared" ? "Nothing shared with you" : url.repo ? `No ${(VIEW_TITLE[url.repo] ?? "files").toLowerCase()} yet` : "This folder is empty"}</p>
                <p className="text-sm text-muted-foreground">{url.q ? "Try another name, or search all of OneDrive below." : url.view || url.repo ? "Files you add will show up here." : "Drop files here or use the New button."}</p>
              </div>
            ) : (
              <FileListing items={listing} layout={effectiveLayout} selected={selected} focusedId={focusedId} starred={starred} onSelect={select} onOpen={openItem} onContextMenu={(item, x, y) => setCtx({ item, x, y })} onDropIds={(ids, folder) => void doMove(ids, folder)} onStar={(i) => void doStar(i)} onColumns={setCols} />
            )}
            {url.q.trim().length > 1 && (
              <div className="px-4 pt-4" onClick={(e) => e.stopPropagation()}>
                {!serverSearch ? (
                  <button type="button" onClick={() => setServerSearch(true)} className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] hover:bg-muted">
                    <Search className="h-4 w-4" />Search all of OneDrive for &quot;{url.q}&quot; (content, not just names)
                  </button>
                ) : (
                  <section>
                    <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">More from OneDrive search</h2>
                    {remote.isPending && <p className="text-xs text-muted-foreground">Searching...</p>}
                    {remote.isError && <p className="text-xs text-destructive">Search failed: {(remote.error as Error).message}</p>}
                    {remote.data && remote.data.filter((r) => !listing.some((l) => l.id === r.id)).length === 0 && <p className="text-xs text-muted-foreground">No additional results.</p>}
                    {remote.data && (
                      <FileListing items={sortItems(remote.data.filter((r) => !listing.some((l) => l.id === r.id)), sort)} layout="list" selected={selected} focusedId={focusedId} starred={starred} onSelect={select} onOpen={openItem} onContextMenu={(item, x, y) => setCtx({ item, x, y })} onDropIds={(ids, folder) => void doMove(ids, folder)} onStar={(i) => void doStar(i)} />
                    )}
                  </section>
                )}
              </div>
            )}
          </main>
          {detailsOpen && <DetailsPanel item={selectedItem} crumbs={selectedItem ? index.pathOf(selectedItem.id) : []} onClose={() => setDetailsOpen(false)} onShare={setShareTarget} />}
        </div>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} actions={menuFor(ctx.item)} onClose={() => setCtx(null)} />}
      <NameDialog open={newFolderOpen} title="New folder" initial="Untitled folder" submitLabel="Create" onClose={() => setNewFolderOpen(false)} onSubmit={(n) => void doNewFolder(n)} />
      <NameDialog open={Boolean(renameTarget)} title="Rename" initial={renameTarget?.name ?? ""} submitLabel="OK" onClose={() => setRenameTarget(null)} onSubmit={(n) => renameTarget && void doRename(renameTarget, n)} />
      <MoveDialog open={Boolean(moveState)} mode={moveState?.mode ?? "move"} tree={tree} disabled={moveDisabled} count={moveState?.ids.length ?? 0} onClose={() => setMoveState(null)} onSubmit={(target) => { const s = moveState; setMoveState(null); if (s) void (s.mode === "move" ? doMove(s.ids, target) : doCopy(s.ids, target)); }} />
      <ConfirmDeleteDialog open={Boolean(deleteIds)} names={(deleteIds ?? []).map((id) => byId[id]?.name ?? "")} onClose={() => setDeleteIds(null)} onConfirm={() => deleteIds && void doDelete(deleteIds)} />
      <ShareDialog item={shareTarget} onClose={() => setShareTarget(null)} />
      {previewItem && (
        <PreviewModal item={previewItem} hasPrev={previewIdx > 0} hasNext={previewIdx >= 0 && previewIdx < previewList.length - 1} onPrev={() => setUrl({ item: previewList[previewIdx - 1]?.id ?? null })} onNext={() => setUrl({ item: previewList[previewIdx + 1]?.id ?? null })} onClose={() => setUrl({ item: null })} onShare={setShareTarget} />
      )}
      <UploadTray />
    </div>
  );
}
