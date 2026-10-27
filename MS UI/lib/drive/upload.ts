"use client";

// Upload manager: a tiny external store (useSyncExternalStore) that the
// bottom-right progress tray renders. Small files go through a single PUT,
// large ones through an upload session with resumable 10 MiB chunks.
import type { IPublicClientApplication } from "@azure/msal-browser";
import { useSyncExternalStore } from "react";
import { GRAPH } from "@/lib/config";
import { backoffMs, graphFetch, GraphError, retryAfterMs } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { DRIVE_SCOPES } from "./index";
import { itemPath } from "./api";
import { chunkRanges, contentRange, parseNextExpected, SIMPLE_UPLOAD_LIMIT } from "./logic";
import type { DriveItem } from "./types";

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "cancelled";
export type UploadTask = {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: UploadStatus;
  error?: string;
  parentId: string;
  uploadUrl?: string;
  cancelled?: boolean;
  result?: DriveItem;
  folder?: string; // the folder upload this file belongs to, for the tray
};
// `resolveParent` stands in for `parentId` when the folder still has to be
// made (its first create failed): Retry creates it, then uploads.
export type UploadJob = { file: File; parentId: string; name?: string; folder?: string; resolveParent?: () => Promise<string> };

let tasks: UploadTask[] = [];
// The File behind each task, kept so a failed upload can be retried from the tray.
const jobs = new Map<string, UploadJob>();
let seq = 0;
const newId = () => `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const update = (id: string, patch: Partial<UploadTask>) => {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
};

export function useUploads(): UploadTask[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tasks,
    () => tasks
  );
}
export function clearFinishedUploads() {
  tasks = tasks.filter((t) => t.status === "uploading" || t.status === "queued");
  for (const id of Array.from(jobs.keys())) if (!tasks.some((t) => t.id === id)) jobs.delete(id);
  emit();
}
export function cancelUpload(id: string) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  update(id, { cancelled: true, status: "cancelled" });
  if (t.uploadUrl && !isMockMode()) void fetch(t.uploadUrl, { method: "DELETE" }).catch(() => undefined);
}

type UploadSession = { uploadUrl: string; expirationDateTime?: string; nextExpectedRanges?: string[] };
export const SESSION_GONE = "The upload session expired. Upload the file again.";

// A dropped connection or 5xx may come after OneDrive already saved the file.
const isAmbiguous = (e: unknown) => e instanceof TypeError || (e instanceof GraphError && [500, 502, 504].includes(e.status));

// One PUT by path. conflictBehavior=rename keeps an existing file of the same
// name, so a blind repeat would leave "name 1" copies: a repeat after an
// ambiguous failure uses conflictBehavior=fail, and a 409 there is our own
// earlier attempt when the stored file has this file's size.
async function uploadSmall(instance: IPublicClientApplication, task: UploadTask, file: File): Promise<DriveItem> {
  const base = `${itemPath(task.parentId)}:/${encodeURIComponent(task.name)}`;
  const put = (behavior: "rename" | "fail") =>
    graphFetch<DriveItem>(instance, DRIVE_SCOPES, `${base}:/content?@microsoft.graph.conflictBehavior=${behavior}`, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
  let item: DriveItem | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 6 && !item; attempt++) {
    if (tasks.find((t) => t.id === task.id)?.cancelled) throw new Error("cancelled");
    try {
      if (attempt === 0) item = await put("rename");
      else {
        try {
          item = await put("fail");
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 409)) throw e;
          const existing = await graphFetch<DriveItem>(instance, DRIVE_SCOPES, base);
          item = existing && !existing.folder && existing.size === file.size ? existing : await put("rename");
        }
      }
    } catch (e) {
      if (!isAmbiguous(e)) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
  if (!item) throw lastError;
  update(task.id, { sent: file.size });
  return item;
}

async function uploadLarge(instance: IPublicClientApplication, task: UploadTask, file: File): Promise<DriveItem> {
  const session = await graphFetch<UploadSession>(instance, DRIVE_SCOPES, `${itemPath(task.parentId)}:/${encodeURIComponent(task.name)}:/createUploadSession`, {
    method: "POST",
    body: { item: { "@microsoft.graph.conflictBehavior": "rename", name: task.name } },
    retryTransient: true,
  });
  update(task.id, { uploadUrl: session.uploadUrl });
  if (isMockMode()) return uploadSmall(instance, task, file);
  let from = parseNextExpected(session.nextExpectedRanges);
  let attempts = 0;
  let throttled = 0;
  while (from < file.size) {
    const [range] = chunkRanges(file.size, from);
    const current = tasks.find((t) => t.id === task.id);
    if (!current || current.cancelled) throw new Error("cancelled");
    try {
      // Plain fetch: the upload URL is pre-authenticated, no bearer token
      // (Graph answers 401 if one is sent). Content-Length is a forbidden
      // header in browsers; fetch sets it from the body.
      const res = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": contentRange(range, file.size) },
        body: file.slice(range.start, range.end + 1),
      });
      if (res.status === 200 || res.status === 201) {
        update(task.id, { sent: file.size });
        return (await res.json()) as DriveItem;
      }
      if (res.status === 202) {
        const j = (await res.json()) as UploadSession;
        from = parseNextExpected(j.nextExpectedRanges) || range.end + 1;
        update(task.id, { sent: from });
        attempts = 0;
        throttled = 0;
        continue;
      }
      // Throttled or briefly unavailable: wait as told, without spending a
      // retry (the chunk was not taken).
      if ((res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504) && ++throttled <= 10) {
        await new Promise((r) => setTimeout(r, retryAfterMs(res.headers.get("Retry-After")) ?? backoffMs(Math.min(throttled, 5))));
        continue;
      }
      // 404: the session no longer exists (expired or cancelled); the docs say
      // to start the whole upload over rather than retry.
      if (res.status === 404) throw new Error(SESSION_GONE);
      let code = String(res.status);
      try {
        code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
      } catch {
        // non-JSON body
      }
      throw new GraphError(res.status, code, `Upload chunk failed (${res.status})`, "upload session");
    } catch (e) {
      if ((e as Error).message === "cancelled" || (e as Error).message === SESSION_GONE) throw e;
      if (++attempts > 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempts));
      // Ask the session where to resume.
      const q = await fetch(session.uploadUrl).then((r) => (r.ok ? (r.json() as Promise<UploadSession>) : null)).catch(() => null);
      if (q) from = parseNextExpected(q.nextExpectedRanges);
    }
  }
  throw new Error("Upload ended without a final response");
}

// Uploads files into `parentId` (folder uploads create the folders first
// and pass each file's folder id; `name` overrides a name OneDrive would
// refuse). Resolves with the items created; failures stay in the tray with
// their reason and a Retry.
export async function enqueueUploads(
  instance: IPublicClientApplication,
  files: UploadJob[],
  onDone?: (items: DriveItem[]) => void
): Promise<DriveItem[]> {
  const newTasks: UploadTask[] = files.map((job) => {
    const id = newId();
    jobs.set(id, job);
    return { id, name: job.name ?? job.file.name, size: job.file.size, sent: 0, status: "queued", parentId: job.parentId, folder: job.folder };
  });
  tasks = [...tasks, ...newTasks];
  emit();
  const created = await runTasks(instance, newTasks.map((t) => t.id));
  onDone?.(created);
  return created;
}

// Files that could not be queued: their folder could not be created (Retry
// makes it through `resolveParent`, then uploads) or the file could not be
// read from disk (no `file`: nothing to retry). Shown as failed, with why.
export function addFailedUploads(entries: { file?: File; name: string; error: string; folder?: string; resolveParent?: () => Promise<string> }[]) {
  if (!entries.length) return;
  const added = entries.map((e) => {
    const id = newId();
    if (e.file && e.resolveParent) jobs.set(id, { file: e.file, parentId: "", name: e.name, folder: e.folder, resolveParent: e.resolveParent });
    return { id, name: e.name, size: e.file?.size ?? 0, sent: 0, status: "error" as const, error: e.error, parentId: "", folder: e.folder };
  });
  tasks = [...tasks, ...added];
  emit();
}

export const failedUploadCount = (list: UploadTask[] = tasks) => list.filter((t) => t.status === "error").length;
export const canRetry = (t: UploadTask) => t.status === "error" && jobs.has(t.id);

// Retries every failed upload that still has its file (or just `ids`).
export async function retryUploads(instance: IPublicClientApplication, ids?: string[]): Promise<DriveItem[]> {
  const pick = tasks.filter((t) => canRetry(t) && (!ids || ids.includes(t.id))).map((t) => t.id);
  for (const id of pick) update(id, { status: "queued", error: undefined, sent: 0, cancelled: false, uploadUrl: undefined });
  return runTasks(instance, pick);
}

async function runTasks(instance: IPublicClientApplication, ids: string[]): Promise<DriveItem[]> {
  const created: DriveItem[] = [];
  // Three at a time keeps Graph happy and the tray readable.
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const job = jobs.get(id);
      let task = tasks.find((t) => t.id === id);
      if (!job || !task || task.cancelled) continue;
      update(id, { status: "uploading" });
      try {
        if (!job.parentId && job.resolveParent) {
          job.parentId = await job.resolveParent();
          update(id, { parentId: job.parentId });
          task = { ...task, parentId: job.parentId };
        }
        const item = job.file.size < SIMPLE_UPLOAD_LIMIT ? await uploadSmall(instance, task, job.file) : await uploadLarge(instance, task, job.file);
        created.push(item);
        update(id, { status: "done", result: item, sent: job.file.size });
        jobs.delete(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        update(id, msg === "cancelled" ? { status: "cancelled" } : { status: "error", error: uploadErrorText(e) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return created;
}

// Graph's messages are terse; say what the user can do about the common ones.
export function uploadErrorText(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.status === 507 || /quotaLimitReached|insufficientStorage/i.test(e.code)) return "OneDrive is full";
    if ([429, 503, 504].includes(e.status)) return "OneDrive is busy. Retry in a minute.";
    return e.message;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Network error. Retry when you are back online.";
  return msg;
}

export const GRAPH_BASE = GRAPH;
