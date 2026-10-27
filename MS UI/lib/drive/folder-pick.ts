"use client";

// Reading a whole folder from the browser, empty subfolders included.
// - Folder upload button: the File System Access directory picker where the
//   browser has it (Chrome, Edge), else <input webkitdirectory>, which lists
//   files only, so empty folders cannot be seen there.
// - Drag and drop: the dropped entries are walked with webkitGetAsEntry, so
//   folders keep their structure (react-dropzone's default reader flattens
//   them into a file list and drops empty directories).
import { relPathOf } from "./logic";

export type PickedEntry = { file: File; path: string };
// `failed`: files or folders the browser could not read (locked, removed,
// online-only); the rest still uploads and these are listed as failed.
export type PickedFolder = { entries: PickedEntry[]; dirs: string[]; failed: { path: string; error: string }[] };
const why = (e: unknown) => (e instanceof Error ? e.message : String((e as { name?: string })?.name ?? e)) || "Could not be read";

type DirHandle = { kind: "directory"; name: string; values(): AsyncIterable<DirHandle | FileHandle> };
type FileHandle = { kind: "file"; name: string; getFile(): Promise<File> };
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite" }) => Promise<DirHandle> };

export const hasDirectoryPicker = () => typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";

// null when the person cancelled; throws only when the picker itself is
// unavailable or refused (the caller offers the input instead).
export async function pickDirectory(): Promise<PickedFolder | null> {
  let root: DirHandle;
  try {
    root = await (window as PickerWindow).showDirectoryPicker!({ id: "msui-folder-upload", mode: "read" });
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return null;
    throw e;
  }
  return walkDirectoryHandle(root);
}

export async function walkDirectoryHandle(root: DirHandle): Promise<PickedFolder> {
  const entries: PickedEntry[] = [];
  const dirs: string[] = [];
  const failed: PickedFolder["failed"] = [];
  const walk = async (dir: DirHandle, path: string) => {
    dirs.push(path);
    try {
      for await (const h of dir.values()) {
        const p = `${path}/${h.name}`;
        if (h.kind === "directory") await walk(h, p);
        else {
          try {
            entries.push({ file: await h.getFile(), path: p });
          } catch (e) {
            failed.push({ path: p, error: why(e) });
          }
        }
      }
    } catch (e) {
      failed.push({ path, error: `Folder could not be read: ${why(e)}` });
    }
  };
  await walk(root, root.name);
  return { entries, dirs, failed };
}

// ---------- drag and drop ----------

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string };
type FileEntry = Entry & { file(ok: (f: File) => void, err: (e: unknown) => void): void };
type DirEntry = Entry & { createReader(): { readEntries(ok: (es: Entry[]) => void, err: (e: unknown) => void): void } };

// readEntries hands back at most 100 entries per call (Chrome); keep asking
// until it answers with an empty batch.
async function readAll(dir: DirEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const out: Entry[] = [];
  for (;;) {
    const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err));
    if (!batch.length) return out;
    out.push(...batch);
  }
}

export async function walkEntries(roots: Entry[]): Promise<PickedFolder> {
  const entries: PickedEntry[] = [];
  const dirs: string[] = [];
  const failed: PickedFolder["failed"] = [];
  const walk = async (e: Entry, path: string) => {
    if (e.isDirectory) {
      dirs.push(path);
      let children: Entry[];
      try {
        children = await readAll(e as DirEntry);
      } catch (err) {
        failed.push({ path, error: `Folder could not be read: ${why(err)}` });
        return;
      }
      for (const child of children) await walk(child, `${path}/${child.name}`);
    } else if (e.isFile) {
      try {
        entries.push({ file: await new Promise<File>((ok, err) => (e as FileEntry).file(ok, err)), path });
      } catch (err) {
        failed.push({ path, error: why(err) });
      }
    }
  };
  for (const r of roots) await walk(r, r.name);
  return { entries, dirs, failed };
}

// Folders seen (and entries that could not be read) in the last drop, read
// by onDrop: react-dropzone only passes files through. Set and consumed
// within one drop.
let lastDrop: Pick<PickedFolder, "dirs" | "failed"> = { dirs: [], failed: [] };
export const takeDropExtras = () => {
  const d = lastDrop;
  lastDrop = { dirs: [], failed: [] };
  return d;
};

// react-dropzone getFilesFromEvent. On drop, folders are walked and every
// file gets `relativePath` "Folder/sub/file" (what relPathOf reads); during
// dragenter/over only the item list is available, as with the default.
export async function filesFromDropEvent(evt: unknown): Promise<(File | DataTransferItem)[]> {
  lastDrop = { dirs: [], failed: [] };
  // File System Access handles (react-dropzone's useFsAccessApi; off here).
  if (Array.isArray(evt)) return Promise.all((evt as FileHandle[]).map((h) => h.getFile()));
  const e = evt as DragEvent & ClipboardEvent & { target?: HTMLInputElement | null };
  // Paste (Ctrl/Cmd+V of a screenshot or copied files) and input changes.
  if (e.clipboardData) return Array.from(e.clipboardData.files ?? []);
  const dt = e.dataTransfer;
  if (!dt) return Array.from(e.target?.files ?? []);
  if (e.type !== "drop") return Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  // Entries must be taken synchronously, before the first await: the
  // DataTransfer is emptied once the event handler returns.
  const roots = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  const plainFiles = Array.from(dt.files ?? []);
  if (!roots.length || roots.some((r) => !r) || !roots.some((r) => r!.isDirectory)) return plainFiles;
  const { entries, dirs, failed } = await walkEntries(roots as Entry[]);
  lastDrop = { dirs, failed };
  return entries.map(({ file, path }) => {
    Object.defineProperty(file, "relativePath", { value: path, configurable: true });
    return file;
  });
}

export const isNested = (f: File) => relPathOf(f).includes("/");
