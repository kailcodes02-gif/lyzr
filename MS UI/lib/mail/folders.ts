// Well-known folders on Graph v1.0. The mailFolder resource has no
// wellKnownName property there (beta only): $select=wellKnownName is a 400,
// "Could not find a property named 'wellKnownName' on type
// 'microsoft.graph.mailFolder'". The names are still valid path segments
// (GET /me/mailFolders/inbox), so the ids are resolved through one $batch of
// alias GETs and the name is synthesized onto the folder objects client-side.
// Pure functions only; the query lives in ./hooks.ts.
import type { BatchRequest, BatchResponse } from "@/lib/graph";
import type { MailFolder } from "./types";

// Every mailFolder property v1.0 knows that the tree renders.
export const FOLDER_SELECT = "id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount";

// The folders the tree orders or hides (see logic.ts). msgfolderroot and the
// like are never listed, so they are not asked for.
export const WELL_KNOWN_ALIASES = [
  "inbox", "sentitems", "drafts", "deleteditems", "junkemail", "archive",
  "outbox", "conversationhistory", "syncissues", "clutter", "scheduled", "recoverableitemsdeletions", "searchfolders", "serverfailures", "localfailures", "conflicts",
] as const;
export type WellKnownAlias = (typeof WELL_KNOWN_ALIASES)[number];

// id -> well-known name.
export type WellKnownMap = Record<string, WellKnownAlias>;

export function wellKnownRequests(): BatchRequest[] {
  return WELL_KNOWN_ALIASES.map((name) => ({ id: name, method: "GET", url: `/me/mailFolders/${name}?$select=id` }));
}

// A folder the mailbox lacks (no Archive yet, no Clutter) answers 404 and is
// simply absent from the map; the mock answers 200 with an error body.
export function wellKnownIdsFrom(responses: BatchResponse[]): WellKnownMap {
  const out: WellKnownMap = {};
  for (const r of responses) {
    if (r.status >= 400) continue;
    const body = r.body as { id?: string; error?: unknown } | undefined;
    if (!body?.id || body.error) continue;
    if ((WELL_KNOWN_ALIASES as readonly string[]).includes(r.id)) out[body.id] = r.id as WellKnownAlias;
  }
  return out;
}

// Last resort when the alias batch itself fails (offline, throttled): the
// default English display names, top level only, so the tree still has an
// Inbox and Starred in the right place.
const DEFAULT_NAMES: Record<string, WellKnownAlias> = {
  inbox: "inbox",
  "sent items": "sentitems",
  drafts: "drafts",
  "deleted items": "deleteditems",
  "junk email": "junkemail",
  archive: "archive",
  outbox: "outbox",
  "conversation history": "conversationhistory",
  "sync issues": "syncissues",
  clutter: "clutter",
  scheduled: "scheduled",
};

export function guessWellKnownByName(folders: MailFolder[]): WellKnownMap {
  const out: WellKnownMap = {};
  for (const f of folders) {
    const wk = DEFAULT_NAMES[f.displayName.trim().toLowerCase()];
    if (wk) out[f.id] = wk;
  }
  return out;
}

// Stamps wellKnownName (null for custom folders) so orderFolders,
// visibleFolders, resolveFolderId and the folder key mapping work unchanged.
export function withWellKnownNames(folders: MailFolder[], map: WellKnownMap): MailFolder[] {
  return folders.map((f) => ({ ...f, wellKnownName: map[f.id] ?? null }));
}
