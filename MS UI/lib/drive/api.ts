"use client";

// Graph calls for OneDrive beyond the index: quota, starred, shared, search,
// item mutations, sharing and previews. All v1.0, Files.ReadWrite only.
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GRAPH } from "@/lib/config";
import { getToken, graphFetch, graphFetchBlob, GraphError } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { DRIVE_SCOPES } from "./index";
import type { Drive, DriveItem, Permission } from "./types";

type Msal = IPublicClientApplication;
const S = DRIVE_SCOPES;
const enc = encodeURIComponent;
export const itemPath = (id: string) => (id === "root" ? "/me/drive/root" : `/me/drive/items/${id}`);

export function useQuota() {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "quota", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Drive>(instance, S, "/me/drive?$select=id,quota,driveType,owner"),
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

export function useSharedWithMe(enabled: boolean) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "sharedWithMe", accounts[0]?.homeAccountId],
    enabled: enabled && accounts.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await graphFetch<{ value: DriveItem[] }>(instance, S, "/me/drive/sharedWithMe")).value,
  });
}

export function useDriveSearch(q: string) {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["drive", "search", q],
    enabled: accounts.length > 0 && q.trim().length > 1,
    staleTime: 30_000,
    queryFn: async () => (await graphFetch<{ value: DriveItem[] }>(instance, S, `/me/drive/root/search(q='${enc(q.replace(/'/g, "''"))}')?$top=50`)).value,
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

export async function createFolder(instance: Msal, parentId: string, name: string) {
  return graphFetch<DriveItem>(instance, S, `${itemPath(parentId)}/children`, {
    method: "POST",
    body: { name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" },
  });
}
export async function renameItem(instance: Msal, id: string, name: string) {
  return graphFetch<DriveItem>(instance, S, itemPath(id), { method: "PATCH", body: { name } });
}
export async function moveItem(instance: Msal, id: string, parentId: string) {
  const parentReference = parentId === "root" ? { path: "/drive/root:" } : { id: parentId };
  return graphFetch<DriveItem>(instance, S, itemPath(id), { method: "PATCH", body: { parentReference } });
}
export async function deleteItem(instance: Msal, id: string) {
  return graphFetch<void>(instance, S, itemPath(id), { method: "DELETE" });
}
export async function followItem(instance: Msal, id: string, star: boolean) {
  return graphFetch<DriveItem | void>(instance, S, `${itemPath(id)}/${star ? "follow" : "unfollow"}`, { method: "POST" });
}

// Copy is async: 202 + Location monitor URL, polled (no auth header) until
// status is completed or failed.
export async function copyItem(instance: Msal, id: string, parentId: string, driveId?: string, name?: string): Promise<void> {
  const body = { parentReference: { id: parentId === "root" ? undefined : parentId, driveId, path: parentId === "root" ? "/drive/root:" : undefined }, name };
  if (isMockMode()) {
    await graphFetch(instance, S, `${itemPath(id)}/copy`, { method: "POST", body });
    return;
  }
  const token = await getToken(instance, S);
  const res = await fetch(`${GRAPH}${itemPath(id)}/copy`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new GraphError(res.status, b.error?.code ?? String(res.status), b.error?.message ?? res.statusText, `${itemPath(id)}/copy`);
  }
  const monitor = res.headers.get("Location");
  if (!monitor) return;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000 + i * 250));
    const m = await fetch(monitor);
    const j = (await m.json().catch(() => ({}))) as { status?: string; percentageComplete?: number; error?: { message?: string } };
    if (j.status === "completed") return;
    if (j.status === "failed") throw new Error(j.error?.message ?? "Copy failed");
  }
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
  return graphFetch<void>(instance, S, `${itemPath(id)}/permissions/${permissionId}`, { method: "DELETE" });
}

export async function fetchThumbnail(instance: Msal, id: string): Promise<string | null> {
  if (isMockMode()) return null;
  try {
    const blob = await graphFetchBlob(instance, S, `${itemPath(id)}/thumbnails/0/medium/content`);
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
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

// After a mutation: bump every drive query.
export function useInvalidateDrive() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["drive"] });
}

export function useDriveMutation<TArgs>(fn: (instance: Msal, args: TArgs) => Promise<unknown>, opts?: { onSettled?: () => void }) {
  const { instance } = useMsal();
  const invalidate = useInvalidateDrive();
  return useMutation({
    mutationFn: (args: TArgs) => fn(instance, args),
    onSettled: () => {
      void invalidate();
      opts?.onSettled?.();
    },
  });
}
