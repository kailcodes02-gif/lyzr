"use client";

// Graph calls for OneDrive beyond the index: quota, starred, shared, search,
// item mutations, sharing and previews. All v1.0, Files.ReadWrite only.
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { GRAPH } from "@/lib/config";
import { getToken, graphFetch, GraphError } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { SETTLE_REFRESH_MS } from "./freshness";
import { DRIVE_SCOPES, ROOT_ID_URL } from "./index";
import { normalizeRemoteItem, ROOT } from "./logic";
import type { Drive, DriveItem, Permission } from "./types";

type Msal = IPublicClientApplication;
const S = DRIVE_SCOPES;
const enc = encodeURIComponent;
// Every id is URL-encoded: ids come from the URL bar as well as from Graph.
export const itemPath = (id: string) => (id === ROOT ? "/me/drive/root" : `/me/drive/items/${enc(id)}`);

export function useQuota(enabled = true) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "quota", accounts[0]?.homeAccountId],
    enabled: enabled && accounts.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Drive>(instance, S, "/me/drive?$select=id,quota,driveType,owner,webUrl"),
  });
}

export function useStarred(enabled = true) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "following", accounts[0]?.homeAccountId],
    enabled: enabled && accounts.length > 0,
    staleTime: 60_000,
    queryFn: async () => (await graphFetch<{ value: DriveItem[] }>(instance, S, "/me/drive/following")).value,
  });
}

// Shared items arrive as { id, remoteItem: {...} }; the display fields are
// lifted out of remoteItem here so the listing helpers never see undefined.
// allowexternal: partner-tenant shares (the GSI program) are the point.
export function useSharedWithMe(enabled: boolean) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "sharedWithMe", accounts[0]?.homeAccountId],
    enabled: enabled && accounts.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await graphFetch<{ value: DriveItem[] }>(instance, S, "/me/drive/sharedWithMe?allowexternal=true")).value.map(normalizeRemoteItem),
  });
}

export function useDriveSearch(q: string) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "search", q],
    enabled: accounts.length > 0 && q.trim().length > 1,
    staleTime: 30_000,
    queryFn: async () => (await graphFetch<{ value: DriveItem[] }>(instance, S, `/me/drive/root/search(q='${enc(q.replace(/'/g, "''"))}')?$top=50`)).value.map(normalizeRemoteItem),
  });
}

export function useItem(id: string | null) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["drive", "item", id],
    enabled: Boolean(id),
    staleTime: 50 * 60_000, // downloadUrl lives ~1 h
    queryFn: () => graphFetch<DriveItem>(instance, S, `${itemPath(id!)}?$select=id,name,size,file,folder,webUrl,parentReference,createdBy,lastModifiedBy,createdDateTime,lastModifiedDateTime,@microsoft.graph.downloadUrl`),
  });
}

export function usePermissions(id: string | null) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["drive", "permissions", id],
    enabled: Boolean(id),
    queryFn: async () => (await graphFetch<{ value: Permission[] }>(instance, S, `${itemPath(id!)}/permissions`)).value,
  });
}

export function usePreviewUrl(id: string | null, enabled: boolean) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["drive", "preview", id],
    enabled: enabled && Boolean(id),
    retry: false,
    queryFn: () => graphFetch<{ getUrl?: string; postUrl?: string }>(instance, S, `${itemPath(id!)}/preview`, { method: "POST", body: {} }),
  });
}

// Copy and move-to-root need the real root id and the drive id (Graph rejects
// "root" / path forms there). Usually both are already known from the index
// and the quota query; this fills any gap with one small request each.
export type DriveTarget = { driveId: string; id: string };
export async function resolveTarget(instance: Msal, target: string, known: { rootId?: string; driveId?: string }): Promise<DriveTarget> {
  let id = target === ROOT ? known.rootId : target;
  if (!id || id === ROOT) id = (await graphFetch<{ id: string }>(instance, S, ROOT_ID_URL)).id;
  let driveId = known.driveId;
  if (!driveId) driveId = (await graphFetch<{ id: string }>(instance, S, "/me/drive?$select=id")).id;
  return { driveId, id };
}

export async function createFolder(instance: Msal, parentId: string, name: string) {
  return graphFetch<DriveItem>(instance, S, `${itemPath(parentId)}/children`, {
    method: "POST",
    body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" },
  });
}
// A blank Office file: PUT of the generated OOXML bytes by path, renamed on
// conflict like uploads. Graph answers with the new driveItem (webUrl included).
export async function createOfficeFile(instance: Msal, parentId: string, name: string, bytes: Uint8Array, mimeType: string) {
  const body = new Blob([bytes as BlobPart], { type: mimeType });
  return graphFetch<DriveItem>(instance, S, `${itemPath(parentId)}:/${enc(name)}:/content?@microsoft.graph.conflictBehavior=rename`, { method: "PUT", body, headers: { "Content-Type": mimeType } });
}
export async function renameItem(instance: Msal, id: string, name: string) {
  return graphFetch<DriveItem>(instance, S, itemPath(id), { method: "PATCH", body: { name } });
}
// parentId must be a real item id (the resolved root id for "My files").
export async function moveItem(instance: Msal, id: string, parentId: string) {
  return graphFetch<DriveItem>(instance, S, itemPath(id), { method: "PATCH", body: { parentReference: { id: parentId } } });
}
export async function deleteItem(instance: Msal, id: string) {
  return graphFetch<void>(instance, S, itemPath(id), { method: "DELETE" });
}
export async function followItem(instance: Msal, id: string, star: boolean) {
  return graphFetch<DriveItem | void>(instance, S, `${itemPath(id)}/${star ? "follow" : "unfollow"}`, { method: "POST" });
}

export type CopyResult = "completed" | "unknown";
const COPY_POLLS = 20;

// Copy is async: 202 + Location monitor URL, polled with a plain fetch (the
// monitor is pre-authenticated, on a SharePoint origin). The browser only
// exposes Location when Graph's CORS response lists it, and the monitor may
// not answer cross-origin: both cases resolve "unknown" (accepted, completion
// not observed) so the caller refreshes the index later instead of failing.
export async function copyItem(instance: Msal, id: string, target: DriveTarget, name?: string, onProgress?: (pct: number) => void): Promise<CopyResult> {
  const path = `${itemPath(id)}/copy?@microsoft.graph.conflictBehavior=rename`;
  const body = { parentReference: { driveId: target.driveId, id: target.id }, name };
  if (isMockMode()) {
    await graphFetch(instance, S, path, { method: "POST", body });
    return "completed";
  }
  const token = await getToken(instance, S);
  const res = await fetch(`${GRAPH}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new GraphError(res.status, b.error?.code ?? String(res.status), b.error?.message ?? res.statusText, path);
  }
  let monitor: string | null = null;
  try {
    monitor = res.headers.get("Location");
  } catch {
    monitor = null;
  }
  if (!monitor) return "unknown";
  for (let i = 0; i < COPY_POLLS; i++) {
    await new Promise((r) => setTimeout(r, Math.min(3000, 1000 + i * 250)));
    let j: { status?: string; percentageComplete?: number; error?: { message?: string; details?: { message?: string }[] } };
    try {
      const m = await fetch(monitor);
      j = (await m.json()) as typeof j;
    } catch {
      // CORS failure or non-JSON hiccup on the monitor: not a failed copy.
      return "unknown";
    }
    if (typeof j.percentageComplete === "number") onProgress?.(j.percentageComplete);
    if (j.status === "completed") return "completed";
    if (j.status === "failed") throw new Error(j.error?.details?.[0]?.message ?? j.error?.message ?? "Copy failed");
  }
  return "unknown";
}

export async function createLink(instance: Msal, id: string, type: "view" | "edit", scope: "organization" | "anonymous" | "users") {
  return graphFetch<Permission>(instance, S, `${itemPath(id)}/createLink`, { method: "POST", body: { type, scope } });
}
export async function invite(instance: Msal, id: string, emails: string[], role: "read" | "write", message: string) {
  return graphFetch<{ value: Permission[] }>(instance, S, `${itemPath(id)}/invite`, {
    method: "POST",
    body: { recipients: emails.map((email) => ({ email })), roles: [role], requireSignIn: true, sendInvitation: true, message: message || undefined },
  });
}
export async function removePermission(instance: Msal, id: string, permissionId: string) {
  return graphFetch<void>(instance, S, `${itemPath(id)}/permissions/${enc(permissionId)}`, { method: "DELETE" });
}

// Thumbnail metadata (JSON with a pre-authenticated url) rather than
// /content, which answers with a 302 that a bearer-authenticated CORS request
// cannot follow. The url goes straight into <img src>; no object URL to revoke.
export async function fetchThumbnail(instance: Msal, id: string): Promise<string | null> {
  if (isMockMode()) return null;
  try {
    const t = await graphFetch<{ url?: string }>(instance, S, `${itemPath(id)}/thumbnails/0/medium`);
    return t?.url ?? null;
  } catch {
    return null;
  }
}

// File bytes for in-place previews (PDF, text). Always the pre-authenticated
// @microsoft.graph.downloadUrl, fetched without an Authorization header: the
// docs prohibit /content from JavaScript because its 302 cannot follow a
// CORS-preflighted request.
export async function fetchContent(downloadUrl: string): Promise<Blob> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

export async function downloadItem(instance: Msal, id: string, name: string) {
  const it = await graphFetch<DriveItem>(instance, S, `${itemPath(id)}?$select=id,name,@microsoft.graph.downloadUrl`);
  const url = it["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error("No download URL for this item");
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// After a mutation: refetch the affected queries now and once more after
// SETTLE_REFRESH_MS (OneDrive applies sharing, indexes and thumbnails
// asynchronously). Pending late passes are dropped on unmount.
export function useSettleInvalidate() {
  const qc = useQueryClient();
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((id) => clearTimeout(id));
      t.clear();
    };
  }, []);
  return useCallback(
    (queryKey: readonly unknown[] = ["drive"]) => {
      void qc.invalidateQueries({ queryKey });
      const id = setTimeout(() => {
        timers.current.delete(id);
        void qc.invalidateQueries({ queryKey });
      }, SETTLE_REFRESH_MS);
      timers.current.add(id);
    },
    [qc]
  );
}

// After a mutation: bump every drive query (now and again shortly after).
export function useInvalidateDrive() {
  const settle = useSettleInvalidate();
  return () => settle(["drive"]);
}

export function useDriveMutation<TArgs>(fn: (instance: Msal, args: TArgs) => Promise<unknown>, opts?: { onSettled?: () => void }) {
  const { instance } = useMsal();
  const invalidate = useInvalidateDrive();
  return useMutation({
    mutationFn: (args: TArgs) => fn(instance, args),
    onSettled: () => {
      invalidate();
      opts?.onSettled?.();
    },
  });
}
