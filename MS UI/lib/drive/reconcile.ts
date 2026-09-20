"use client";

// After the late refetch, every optimistic row is checked against OneDrive
// itself (one $batch of small GETs): the server wins. A row the server no
// longer reports is dropped, a move or delete the server did not apply is
// put back, and a rename the server changed (conflict -> "name 1") takes the
// server's name. The pure check is separate from the Graph call.
import type { IPublicClientApplication } from "@azure/msal-browser";
import { graphBatch } from "@/lib/graph";
import { itemPath } from "./api";
import { DRIVE_SCOPES, SELECT } from "./index";
import type { DriveItem } from "./types";

export type Expectation =
  | { kind: "rename"; id: string; name: string; label: string }
  | { kind: "move"; id: string; parentId: string; label: string }
  | { kind: "delete"; id: string; label: string }
  | { kind: "exists"; id: string; action: string; label: string };

export type Outcome = {
  id: string;
  // undefined: leave the row alone; null: remove it; object: merge server truth.
  patch?: Partial<DriveItem> | null;
  // The action OneDrive did not apply ("move", "delete", "upload"...).
  failed?: string;
  // Applied, with a difference worth mentioning (server renamed on conflict).
  info?: string;
};

export function checkExpectation(e: Expectation, found: DriveItem | null | undefined): Outcome {
  // undefined: the check itself failed (throttled, offline): decide nothing.
  if (found === undefined) return { id: e.id };
  const server = found && !found.deleted ? found : null;
  switch (e.kind) {
    case "rename":
      if (!server) return { id: e.id, patch: null, failed: "rename" };
      if (server.name !== e.name) return { id: e.id, patch: server, info: `OneDrive named it "${server.name}"` };
      return { id: e.id, patch: server };
    case "move":
      if (!server) return { id: e.id, patch: null, failed: "move" };
      if (server.parentReference?.id !== e.parentId) return { id: e.id, patch: server, failed: "move" };
      return { id: e.id, patch: server };
    case "delete":
      if (server) return { id: e.id, patch: server, failed: "delete" };
      return { id: e.id };
    case "exists":
      if (!server) return { id: e.id, patch: null, failed: e.action };
      return { id: e.id, patch: server };
  }
}

const VERIFY_SELECT = SELECT.split(",").filter((f) => f !== "root" && f !== "remoteItem").join(",");

// Current server state of each id: the item, null when OneDrive no longer
// has it (404), undefined when the answer was not usable.
export async function verifyItems(instance: IPublicClientApplication, ids: string[]): Promise<Map<string, DriveItem | null | undefined>> {
  const out = new Map<string, DriveItem | null | undefined>();
  const unique = Array.from(new Set(ids));
  if (!unique.length) return out;
  let responses: Awaited<ReturnType<typeof graphBatch>>;
  try {
    responses = await graphBatch(
      instance,
      DRIVE_SCOPES,
      unique.map((id, i) => ({ id: String(i), method: "GET", url: `${itemPath(id)}?$select=${VERIFY_SELECT}` }))
    );
  } catch {
    return out;
  }
  responses.forEach((r) => {
    const id = unique[Number(r.id)];
    if (!id) return;
    if (r.status === 404) out.set(id, null);
    else if (r.status >= 200 && r.status < 300 && r.body && typeof r.body === "object") out.set(id, r.body as DriveItem);
    else out.set(id, undefined);
  });
  return out;
}

export async function reconcile(instance: IPublicClientApplication, expectations: Expectation[]): Promise<Outcome[]> {
  if (!expectations.length) return [];
  const server = await verifyItems(instance, expectations.map((e) => e.id));
  return expectations.map((e) => checkExpectation(e, server.get(e.id)));
}
