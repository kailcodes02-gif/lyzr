"use client";

// Upload manager: a tiny external store (useSyncExternalStore) that the
// bottom-right progress tray renders. Small files go through a single PUT,
// large ones through an upload session with resumable 10 MiB chunks.
import type { IPublicClientApplication } from "@azure/msal-browser";
import { useSyncExternalStore } from "react";
import { GRAPH } from "@/lib/config";
import { graphFetch } from "@/lib/graph";
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
};

let tasks: UploadTask[] = [];
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

async function uploadSmall(instance: IPublicClientApplication, task: UploadTask, file: File): Promise<DriveItem> {
  const path = `${itemPath(task.parentId)}:/${encodeURIComponent(file.name)}:/content?@microsoft.graph.conflictBehavior=rename`;
  const item = await graphFetch<DriveItem>(instance, DRIVE_SCOPES, path, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
  update(task.id, { sent: file.size });
  return item;
}

async function uploadLarge(instance: IPublicClientApplication, task: UploadTask, file: File): Promise<DriveItem> {
  const session = await graphFetch<UploadSession>(instance, DRIVE_SCOPES, `${itemPath(task.parentId)}:/${encodeURIComponent(file.name)}:/createUploadSession`, {
    method: "POST",
    body: { item: { "@microsoft.graph.conflictBehavior": "rename", name: file.name } },
  });
  update(task.id, { uploadUrl: session.uploadUrl });
  if (isMockMode()) return uploadSmall(instance, task, file);
  let from = parseNextExpected(session.nextExpectedRanges);
  let attempts = 0;
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
        continue;
      }
      // 404: the session no longer exists (expired or cancelled); the docs say
      // to start the whole upload over rather than retry.
      if (res.status === 404) throw new Error(SESSION_GONE);
      throw new Error(`Upload chunk failed (${res.status})`);
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

// Uploads files into `parentId`. Folder uploads pass a `relativePath`
// resolver: the caller creates the folders first, then hands the id here.
export async function enqueueUploads(
  instance: IPublicClientApplication,
  files: { file: File; parentId: string }[],
  onDone?: (items: DriveItem[]) => void
): Promise<DriveItem[]> {
  const created: DriveItem[] = [];
  const newTasks: UploadTask[] = files.map(({ file, parentId }) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
    sent: 0,
    status: "queued",
    parentId,
  }));
  tasks = [...tasks, ...newTasks];
  emit();
  // Three at a time keeps Graph happy and the tray readable.
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const idx = i++;
      const task = newTasks[idx];
      const { file } = files[idx];
      if (tasks.find((t) => t.id === task.id)?.cancelled) continue;
      update(task.id, { status: "uploading" });
      try {
        const item = file.size < SIMPLE_UPLOAD_LIMIT ? await uploadSmall(instance, task, file) : await uploadLarge(instance, task, file);
        created.push(item);
        update(task.id, { status: "done", result: item, sent: file.size });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        update(task.id, msg === "cancelled" ? { status: "cancelled" } : { status: "error", error: msg });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  onDone?.(created);
  return created;
}

export const GRAPH_BASE = GRAPH;
