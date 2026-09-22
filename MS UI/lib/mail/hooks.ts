"use client";

import { useMsal } from "@azure/msal-react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { graphBatch, graphFetch, graphFetchBlob, graphGetAll, GraphError, isConsentRequiredError, type BatchRequest, type BatchResponse, type Page } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { FOLDER_SELECT, guessWellKnownByName, wellKnownIdsFrom, wellKnownRequests, withWellKnownNames, type WellKnownMap } from "./folders";
import { createPoller, isSentCopy, listKey, pageFingerprint, pollUntil, refetchTargets, Settler, type ActionContext, type ActionKind, type Poller } from "./freshness";
import { backfillLabel, BACKFILL_MAX, BACKFILL_SELECT, CATEGORIES_PATH, errorMessage, installPresets, isReservedFolderName, moveLabelBackToInbox, safeFolderName, type BackfillResult, type BatchOutcome, type GraphApi } from "./install";
import { encodeFilter, escapeOData, folderByNamePath, inboxTabPath, labelListPath, moveFolderOf, ownRules, PROMOTIONS_COLOR, PROMOTIONS_CONDITIONS, PROMOTIONS_LABEL, RULES_PATH, rulesOfLabel, SOCIAL_COLOR, SOCIAL_CONDITIONS, SOCIAL_LABEL, SORTING_RULES, withoutCategory, type LabelConditions } from "./labels";
import { folderListPath, isVirtualFolderKey, resolveFolderId, searchListPath } from "./logic";
import { PRESET_LABELS } from "./presets";
import type { Attachment, MailFolder, Message, MessageRule, OutlookCategory } from "./types";
import { labelFromFolder, type MailTab } from "./url";

export { errorMessage, type BackfillResult, type BatchOutcome, type GraphApi, type InstallResult } from "./install";
export { POLL_INTERVAL_MS, SETTLE_DELAY_MS } from "./freshness";
export { FOLDER_SELECT, WELL_KNOWN_ALIASES } from "./folders";

export const MAIL_SCOPES = ["Mail.ReadWrite"];
export const SEND_SCOPES = ["Mail.ReadWrite", "Mail.Send"];
export const SETTINGS_SCOPES = ["MailboxSettings.ReadWrite"];
export const CONSENT_KEYS = ["mail", "send", "contacts", "settings"];

export const LIST_SELECT =
  "id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,flag,categories,importance,inferenceClassification,isDraft,webLink,parentFolderId";

// True when the failure is "the tenant has not approved this scope yet".
// getToken throws ConsentRequiredError before Graph is ever called, so the
// 401/403 check alone never fires on first real use; the name check covers a
// ConsentRequiredError from a duplicated module instance.
export function isConsentError(e: unknown): boolean {
  if (isConsentRequiredError(e)) return true;
  return e instanceof Error && e.name === "ConsentRequiredError";
}

const isBadRequest = (e: unknown) => e instanceof GraphError && e.status === 400;

// Every mail query: one retry (Graph is retried for throttling inside
// graphFetch already), none on a 4xx (consent, a rejected query, a bad id:
// retrying cannot help and the loop is what the user sees as "reloading").
export const mailRetry = (n: number, e: unknown): boolean => !isConsentError(e) && !(e instanceof GraphError && e.status >= 400 && e.status < 500) && n < 1;
export const mailRetryDelay = (n: number) => Math.min(1000 * 2 ** n, 4000);

// Shared shape for read queries: background refetches keep the data on
// screen (only the very first load has no data, hence the only skeleton);
// the poller owns focus refreshes, so TanStack's own focus refetch is off.
const calm = { retry: mailRetry, retryDelay: mailRetryDelay, refetchOnWindowFocus: false as const, placeholderData: keepPreviousData };

export const keys = {
  folders: ["mail", "folders"] as const,
  wellKnown: (accountId: string) => ["mail", "wellKnown", accountId] as const,
  children: (id: string) => ["mail", "childFolders", id] as const,
  list: (folder: string, tab?: string, query?: string) => ["mail", "list", folder, tab ?? "", query ?? ""] as const,
  thread: (conversationId: string) => ["mail", "thread", conversationId] as const,
  message: (id: string) => ["mail", "message", id] as const,
  attachments: (id: string) => ["mail", "attachments", id] as const,
  categories: ["mail", "categories"] as const,
  rules: ["mail", "rules"] as const,
};

// ---- Folders --------------------------------------------------------------

export const FOLDERS_PATH = `/me/mailFolders?$select=${FOLDER_SELECT}&$top=100`;
export const childFoldersPath = (parentId: string) => `/me/mailFolders/${parentId}/childFolders?$select=${FOLDER_SELECT}&$top=100`;

// id -> well-known name for this account: one $batch of alias GETs, kept for
// the session (the ids never change). A batch that fails outright resolves
// to an empty map and the folder list falls back to the default names.
export async function fetchWellKnownIds(batch: (reqs: BatchRequest[]) => Promise<BatchResponse[]>): Promise<WellKnownMap> {
  return wellKnownIdsFrom(await batch(wellKnownRequests()));
}

function wellKnownQuery(instance: ReturnType<typeof useMsal>["instance"], accountId: string) {
  return {
    queryKey: keys.wellKnown(accountId),
    staleTime: Infinity,
    gcTime: 24 * 3600_000,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    // A failed batch is not cached: fetchFolders falls back to the default
    // names for that round and the next folder refetch asks again.
    queryFn: () => fetchWellKnownIds((reqs) => graphBatch(instance, MAIL_SCOPES, reqs)),
  };
}

// Resolves the well-known map (cached) and stamps it onto the list. With an
// empty map (alias batch failed) the default display names are used instead.
export async function fetchFolders(get: <T>(path: string) => Promise<T>, wellKnown: () => Promise<WellKnownMap>): Promise<MailFolder[]> {
  const [map, page] = await Promise.all([wellKnown().catch(() => ({}) as WellKnownMap), get<Page<MailFolder>>(FOLDERS_PATH)]);
  const known = Object.keys(map).length ? map : guessWellKnownByName(page.value);
  return withWellKnownNames(page.value, known);
}

export function useFolders() {
  const { instance, accounts } = useMsal();
  const qc = useQueryClient();
  const accountId = accounts[0]?.homeAccountId ?? "anon";
  return useQuery({
    ...calm,
    queryKey: keys.folders,
    staleTime: 60_000,
    queryFn: () => fetchFolders((path) => graphFetch(instance, MAIL_SCOPES, path), () => qc.ensureQueryData(wellKnownQuery(instance, accountId))),
  });
}

// Child folders are never well-known; stamped null so they read as custom.
export function useChildFolders(parentId: string | null) {
  const { instance } = useMsal();
  return useQuery({
    ...calm,
    queryKey: keys.children(parentId ?? ""),
    enabled: !!parentId,
    staleTime: 60_000,
    queryFn: () => graphFetch<Page<MailFolder>>(instance, MAIL_SCOPES, childFoldersPath(parentId!)).then((p) => withWellKnownNames(p.value, {})),
  });
}

export function useFolderMutations() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  // Optimistic folder rows: shown at once, replaced by the server's list.
  const patchFolders = (fn: (list: MailFolder[]) => MailFolder[]) => {
    qc.setQueryData<MailFolder[]>(keys.folders, (old) => (old ? fn(old) : old));
    qc.setQueriesData<MailFolder[]>({ queryKey: ["mail", "childFolders"] }, (old) => (old ? fn(old) : old));
  };
  const create = useMutation({
    mutationFn: ({ displayName, parentId }: { displayName: string; parentId?: string }) =>
      graphFetch<MailFolder>(instance, MAIL_SCOPES, parentId ? `/me/mailFolders/${parentId}/childFolders` : "/me/mailFolders", { method: "POST", body: { displayName } }),
    onSuccess: (created, v) => {
      toast.success("Folder created");
      if (!v.parentId) patchFolders((list) => (list.some((f) => f.id === created.id) ? list : [...list, created]));
      void settleAction(qc, "folder", { sourceFolders: v.parentId ? [v.parentId] : [] });
    },
    onError: (e) => {
      toast.error(`Could not create folder. ${errorMessage(e)}`);
      void settleAction(qc, "folder");
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) => graphFetch<MailFolder>(instance, MAIL_SCOPES, `/me/mailFolders/${id}`, { method: "PATCH", body: { displayName } }),
    onMutate: ({ id, displayName }) => patchFolders((list) => list.map((f) => (f.id === id ? { ...f, displayName } : f))),
    onSettled: (_d, e) => {
      if (e) toast.error(`Could not rename folder. ${errorMessage(e)}`);
      void settleAction(qc, "folder");
    },
  });
  const remove = useMutation({
    mutationFn: ({ id }: { id: string }) => graphFetch<void>(instance, MAIL_SCOPES, `/me/mailFolders/${id}`, { method: "DELETE" }),
    onMutate: ({ id }) => patchFolders((list) => list.filter((f) => f.id !== id)),
    onSuccess: (_d, v) => {
      toast.success("Folder moved to Trash");
      void settleAction(qc, "folder", { sourceFolders: [v.id], ...viewContext(qc) });
    },
    onError: (e) => {
      toast.error(`Could not delete folder. ${errorMessage(e)}`);
      void settleAction(qc, "folder");
    },
  });
  return { create, rename, remove };
}

// ---- Message list ---------------------------------------------------------

export type ListPage = Page<Message>;

// Query strategies that Graph may reject (400) on mail: the category
// any-lambda for label views and not(any) for the Primary tab. The first 400
// flips the strategy for the rest of the session so later pages are consistent.
export type ListStrategy = { label: "filter" | "search" | "client"; primary: "server" | "client" };
const STRATEGY_KEY = "msui.mail.listStrategy";
// A rejected query is remembered across reloads (per browser): the Primary
// tab must never open on a query Graph already refused once.
export function loadListStrategy(): ListStrategy {
  const base: ListStrategy = { label: "filter", primary: "server" };
  try {
    const saved = JSON.parse(localStorage.getItem(STRATEGY_KEY) ?? "{}") as Partial<ListStrategy>;
    if (saved.label === "search" || saved.label === "client") base.label = saved.label;
    if (saved.primary === "client") base.primary = saved.primary;
  } catch {
    // storage blocked or no window
  }
  return base;
}
export function saveListStrategy(s: ListStrategy) {
  try {
    localStorage.setItem(STRATEGY_KEY, JSON.stringify(s));
  } catch {
    // storage blocked
  }
}
export const listStrategy: ListStrategy = typeof window === "undefined" ? { label: "filter", primary: "server" } : loadListStrategy();
export function setListStrategy(patch: Partial<ListStrategy>) {
  Object.assign(listStrategy, patch);
  saveListStrategy(listStrategy);
}
// A 400 on a first page is about the query (the path is ours, never a user
// id): the view falls back right away instead of going blank. The code
// check is kept for logging and tests, but any 400 flips the strategy.
export const isFilterRejected = (e: unknown) => isBadRequest(e);

export type ListView = { folder: string; tab?: MailTab; query?: string; focused?: boolean };

// First-page path for a view under the current strategy. Client fallbacks use
// the plain list and let the caller filter (see clientFilterFor).
export function listPathFor(v: ListView): string {
  if (v.query) return searchListPath(v.query);
  const label = labelFromFolder(v.folder);
  if (label) return listStrategy.label === "client" ? "" : labelListPath(label, listStrategy.label);
  if (v.folder === "inbox") return inboxTabPath(v.tab ?? "primary", v.focused, listStrategy.primary);
  return folderListPath(v.folder, v.focused ? "focused" : undefined);
}

// The first page is the sentinel "" and its URL is built from the CURRENT
// strategy inside queryFn: TanStack refetches page 0 with the stored
// pageParam, so encoding the URL there would replay a rejected query after
// the fallback flipped the strategy.
export const listQueryKey = (v: ListView) => keys.list(v.folder, `${v.tab ?? ""}${v.focused ? "|focused" : ""}`, v.query);

// The folder a skip-inbox label's rules move into: from the cached rules,
// else the top-level folder named after the label (or its safe name, see
// ensureFolder). Undefined for a label that stays in the inbox.
export async function labelFolderId(get: <T>(path: string) => Promise<T>, label: string, cachedRules?: MessageRule[]): Promise<string | undefined> {
  const fromRules = cachedRules ? moveFolderOf(label, cachedRules) : undefined;
  if (fromRules) return fromRules;
  const names = isReservedFolderName(label) ? [safeFolderName(label)] : [label, `${label} mail`];
  for (const n of names) {
    const page = await get<Page<MailFolder>>(folderByNamePath(n)).catch(() => undefined);
    const hit = page?.value.find((f) => f.displayName.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
  }
  return undefined;
}

// Client-side label view, when Graph rejects both the categories/any filter
// and the category: search: the union of the Inbox, the Archive and the
// label's own folder (where its skip-inbox rules put the mail), filtered by
// category and newest first.
export async function labelMessagesClientSide(getAll: (path: string) => Promise<Message[]>, label: string, folderId: string | undefined, select = LIST_SELECT): Promise<Message[]> {
  const path = (folder: string) => `/me/mailFolders/${folder}/messages?$select=${select}&$orderby=receivedDateTime desc&$top=100`;
  const own = folderId && !/^(inbox|archive)$/i.test(folderId) ? getAll(path(folderId)).catch(() => [] as Message[]) : Promise.resolve([] as Message[]);
  const [inbox, archive, moved] = await Promise.all([getAll(path("inbox")), getAll(path("archive")).catch(() => [] as Message[]), own]);
  const want = label.toLowerCase();
  const seen = new Set<string>();
  return [...inbox, ...archive, ...moved]
    .filter((m) => (m.categories ?? []).some((c) => c.toLowerCase() === want))
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => (b.receivedDateTime ?? "").localeCompare(a.receivedDateTime ?? ""));
}

export function useMessageList(folder: string, tab?: MailTab, query?: string, focused?: boolean) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const view: ListView = { folder, tab, query, focused };
  const label = labelFromFolder(folder);
  return useInfiniteQuery({
    ...calm,
    queryKey: listQueryKey(view),
    initialPageParam: "",
    staleTime: 30_000,
    queryFn: async ({ pageParam }): Promise<ListPage> => {
      const isFirst = pageParam === "";
      // Client-side label view: inbox + archive + the label's folder, filtered here (single page).
      const clientLabel = async (name: string): Promise<ListPage> => {
        const folderId = await labelFolderId((path) => graphFetch(instance, MAIL_SCOPES, path), name, qc.getQueryData<MessageRule[]>(keys.rules));
        return { value: await labelMessagesClientSide((path) => graphGetAll<Message>(instance, MAIL_SCOPES, path, 500), name, folderId) };
      };
      if (label && listStrategy.label === "client") return clientLabel(label);
      const url = isFirst ? listPathFor(view) : pageParam;
      try {
        return await graphFetch<ListPage>(instance, MAIL_SCOPES, url);
      } catch (e) {
        if (!isFirst || !isFilterRejected(e)) throw e;
        if (label) {
          if (listStrategy.label === "filter") {
            setListStrategy({ label: "search" });
            try {
              return await graphFetch<ListPage>(instance, MAIL_SCOPES, labelListPath(label, "search"));
            } catch (e2) {
              if (!isFilterRejected(e2)) throw e2;
            }
          }
          setListStrategy({ label: "client" });
          return clientLabel(label);
        }
        // The plain inbox page cannot be a bad query: a 400 on it is the
        // not(any) filter, so Primary falls back to the plain list plus
        // client-side exclusion (clientFilterFor) and remembers that.
        if (folder === "inbox" && listStrategy.primary === "server") {
          setListStrategy({ primary: "client" });
          return graphFetch<ListPage>(instance, MAIL_SCOPES, inboxTabPath(tab ?? "primary", focused, "client"));
        }
        throw e;
      }
    },
    getNextPageParam: (last) => last["@odata.nextLink"],
  });
}

// When the Primary tab runs on the client strategy, Social/Promotions rows
// must be excluded here. Social/Promotions tabs on the client strategy fall
// back to the category filter, which Graph accepts when the any-lambda works.
// Label views list /me/messages, which includes Deleted Items and Junk; those
// are dropped here by parentFolderId (`hiddenFolderIds`: the Trash and Junk
// ids from useFolders) so every label strategy shows the same mail.
export function clientFilterFor(v: ListView, hiddenFolderIds?: Set<string>): ((m: Message) => boolean) | undefined {
  if (v.query) return undefined;
  if (v.folder === "inbox" && (v.tab ?? "primary") === "primary" && listStrategy.primary === "client") {
    return (m) => !(m.categories ?? []).some((c) => c === SOCIAL_LABEL || c === PROMOTIONS_LABEL);
  }
  if (labelFromFolder(v.folder) && hiddenFolderIds?.size) return (m) => !hiddenFolderIds.has(m.parentFolderId ?? "");
  return undefined;
}

export function flattenPages(data?: InfiniteData<ListPage>): Message[] {
  return data?.pages.flatMap((p) => p.value) ?? [];
}

// ---- Thread / single message / attachments --------------------------------

export function useThread(conversationId?: string) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.thread(conversationId ?? ""),
    enabled: !!conversationId,
    staleTime: 30_000,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    refetchOnWindowFocus: false,
    queryFn: () =>
      graphFetch<Page<Message>>(instance, MAIL_SCOPES, `/me/messages?$select=${LIST_SELECT}&$filter=${encodeFilter(`conversationId eq '${escapeOData(conversationId!)}'`)}&$top=100`).then((p) => p.value),
  });
}

export function useMessage(id?: string) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.message(id ?? ""),
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    refetchOnWindowFocus: false,
    queryFn: () => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}?$select=${LIST_SELECT},body,uniqueBody,bccRecipients,replyTo,sentDateTime`),
  });
}

// contentId only exists on fileAttachment, and $select on the collection is
// evaluated against the base attachment type, so it is fetched through the
// type cast. Base metadata first (always valid, no contentBytes), then the
// cast for inline ones; if the cast is refused each inline attachment is read
// on its own, which is what the cid: image loader needs anyway.
export const ATTACHMENT_SELECT = "id,name,contentType,size,isInline";
export const ATTACHMENT_CAST_PATH = (messageId: string) => `/me/messages/${messageId}/attachments/microsoft.graph.fileAttachment?$select=id,contentId`;

export async function fetchAttachments(fetchJson: <T>(path: string) => Promise<T>, messageId: string): Promise<Attachment[]> {
  const base = await fetchJson<Page<Attachment>>(`/me/messages/${messageId}/attachments?$select=${ATTACHMENT_SELECT}`).then((p) => p.value);
  const inline = base.filter((a) => a.isInline);
  if (!inline.length) return base;
  let ids = new Map<string, string | null>();
  try {
    const cast = await fetchJson<Page<Attachment>>(ATTACHMENT_CAST_PATH(messageId));
    ids = new Map(cast.value.map((a) => [a.id, a.contentId ?? null]));
  } catch {
    await Promise.all(
      inline.map(async (a) => {
        const full = await fetchJson<Attachment>(`/me/messages/${messageId}/attachments/${a.id}`).catch(() => null);
        if (full) ids.set(a.id, full.contentId ?? null);
      })
    );
  }
  return base.map((a) => (ids.has(a.id) ? { ...a, contentId: ids.get(a.id) } : a));
}

export function useAttachments(id?: string, enabled = true) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.attachments(id ?? ""),
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    retry: mailRetry,
    retryDelay: mailRetryDelay,
    refetchOnWindowFocus: false,
    queryFn: () => fetchAttachments((path) => graphFetch(instance, MAIL_SCOPES, path), id!),
  });
}

export function useDownloadAttachment() {
  const { instance } = useMsal();
  return async (messageId: string, att: Attachment): Promise<string> => {
    // Mock mode has no binary endpoint: fall back to contentBytes.
    try {
      const blob = await graphFetchBlob(instance, MAIL_SCOPES, `/me/messages/${messageId}/attachments/${att.id}/$value`);
      return URL.createObjectURL(blob);
    } catch (e) {
      const full = await graphFetch<Attachment>(instance, MAIL_SCOPES, `/me/messages/${messageId}/attachments/${att.id}`);
      if (!full.contentBytes) throw e;
      return `data:${att.contentType ?? "application/octet-stream"};base64,${full.contentBytes}`;
    }
  };
}

// ---- Cache helpers ---------------------------------------------------------

// Previous copy of every message touched, keyed by id, so a failure can put
// back exactly the ids that failed and leave the rest alone.
type Prev = Map<string, Message>;

function patchListCaches(qc: QueryClient, ids: Set<string>, patch: (m: Message) => Message | null): Prev {
  const prev: Prev = new Map();
  const apply = (m: Message) => {
    if (!ids.has(m.id)) return m;
    if (!prev.has(m.id)) prev.set(m.id, m);
    return patch(m);
  };
  qc.setQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] }, (old) => {
    if (!old) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, value: p.value.map(apply).filter((m): m is Message => m !== null) })) };
  });
  qc.setQueriesData<Message[]>({ queryKey: ["mail", "thread"] }, (old) => old?.map(apply).filter((m): m is Message => m !== null));
  for (const id of ids) {
    qc.setQueryData<Message>(keys.message(id), (old) => (old ? (apply(old) ?? old) : old));
  }
  return prev;
}

// Puts the previous copy of `ids` back where it is still present. Rows that
// an optimistic move/delete removed are not re-inserted; the invalidation
// that always follows an error brings them back from the server.
function restoreIds(qc: QueryClient, prev: Prev, ids: Iterable<string>) {
  const want = new Set(ids);
  const back = (m: Message) => (want.has(m.id) && prev.has(m.id) ? prev.get(m.id)! : m);
  qc.setQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] }, (old) => (old ? { ...old, pages: old.pages.map((p) => ({ ...p, value: p.value.map(back) })) } : old));
  qc.setQueriesData<Message[]>({ queryKey: ["mail", "thread"] }, (old) => old?.map(back));
  for (const id of want) if (prev.has(id)) qc.setQueryData<Message>(keys.message(id), (old) => (old ? prev.get(id)! : old));
}

// Every cached copy of a message, for scope checks before destructive calls.
function cachedMessage(qc: QueryClient, id: string): Message | undefined {
  const direct = qc.getQueryData<Message>(keys.message(id));
  if (direct) return direct;
  for (const [, data] of qc.getQueriesData<Message[]>({ queryKey: ["mail", "thread"] })) {
    const m = data?.find((x) => x.id === id);
    if (m) return m;
  }
  for (const [, data] of qc.getQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] })) {
    const m = data?.pages.flatMap((p) => p.value).find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}

// ---- Freshness: settle after every action ---------------------------------

// One Settler per QueryClient (every mail hook shares its timers); disposed
// when the Outlook screen unmounts and recreated on the next mount.
const settlers = new WeakMap<QueryClient, Settler>();
export function settlerFor(qc: QueryClient): Settler {
  let s = settlers.get(qc);
  if (!s || s.disposed) {
    s = new Settler((key: QueryKey) => qc.invalidateQueries({ queryKey: key }));
    settlers.set(qc, s);
  }
  return s;
}

export function useSettlerLifecycle() {
  const qc = useQueryClient();
  useEffect(() => () => settlerFor(qc).dispose(), [qc]);
}

// Folder key (URL state) for a Graph folder id: the well-known name when it
// has one, else the id itself (custom folders use their id as the key).
export function folderKeyOf(qc: QueryClient, parentFolderId?: string | null): string | undefined {
  if (!parentFolderId) return undefined;
  const f = qc.getQueryData<MailFolder[]>(keys.folders)?.find((x) => x.id === parentFolderId);
  return f?.wellKnownName ? f.wellKnownName.toLowerCase() : parentFolderId;
}

// Folder keys of every cached list and of the mounted one(s).
export function viewContext(qc: QueryClient): Pick<ActionContext, "cachedFolders" | "activeFolders"> {
  const cache = qc.getQueryCache();
  const folderOf = (k: QueryKey) => String(k[2] ?? "");
  const cached = new Set(cache.findAll({ queryKey: ["mail", "list"] }).map((q) => folderOf(q.queryKey)).filter(Boolean));
  const active = new Set(cache.findAll({ queryKey: ["mail", "list"], type: "active" }).map((q) => folderOf(q.queryKey)).filter(Boolean));
  return { cachedFolders: [...cached], activeFolders: [...active] };
}

// Where the messages live now, from their cached copies (before the
// optimistic change removes them), plus the conversations they belong to.
export function actionContext(qc: QueryClient, ids: string[], extra: Partial<ActionContext> = {}): ActionContext {
  const sources = new Set<string>();
  const convs = new Set<string>();
  for (const id of ids) {
    const m = cachedMessage(qc, id);
    if (!m) continue;
    const k = folderKeyOf(qc, m.parentFolderId);
    if (k) sources.add(k);
    if (m.conversationId) convs.add(m.conversationId);
  }
  return { sourceFolders: [...sources], conversationIds: [...convs], messageIds: ids, ...viewContext(qc), ...extra };
}

export function settleAction(qc: QueryClient, kind: ActionKind, ctx: ActionContext = {}, verify?: (round: "settled" | "late") => void): Promise<void> {
  return settlerFor(qc).settle(refetchTargets(kind, ctx), verify);
}

// The server wins: after a refetch the cache holds Outlook's state. These
// count the messages whose server copy disagrees with what was asked for,
// looking only at copies a refetch could have replaced.
const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));
export function countUnapplied(qc: QueryClient, updates: Update[]): number {
  let n = 0;
  for (const u of updates) {
    const m = cachedMessage(qc, u.id);
    if (!m) continue;
    const b = u.body;
    if (b.isRead !== undefined && (m.isRead ?? false) !== b.isRead) n++;
    else if (b.flag && (m.flag?.flagStatus ?? "notFlagged") !== (b.flag.flagStatus ?? "notFlagged")) n++;
    else if (b.categories && !sameSet(m.categories ?? [], b.categories)) n++;
  }
  return n;
}
// Copies still listed under a real source folder, or still filed there in
// the thread, did not move. Virtual views (starred, labels, search) list
// every folder, so they say nothing about a move.
export function countUnmoved(qc: QueryClient, ids: string[], sourceFolders: string[]): number {
  const folders = qc.getQueryData<MailFolder[]>(keys.folders) ?? [];
  const real = sourceFolders.filter((f) => !isVirtualFolderKey(f));
  const sourceIds = new Set(real.map((f) => resolveFolderId(f, folders) ?? f));
  const want = new Set(ids);
  const stuck = new Set<string>();
  for (const [key, data] of qc.getQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] })) {
    if (!real.includes(String(key[2] ?? ""))) continue;
    for (const m of data?.pages.flatMap((p) => p.value) ?? []) if (want.has(m.id)) stuck.add(m.id);
  }
  for (const [, data] of qc.getQueriesData<Message[]>({ queryKey: ["mail", "thread"] })) {
    for (const m of data ?? []) if (want.has(m.id) && sourceIds.has(m.parentFolderId ?? "")) stuck.add(m.id);
  }
  return stuck.size;
}
export function countUndeleted(qc: QueryClient, ids: string[]): number {
  const want = new Set(ids);
  const seen = new Set<string>();
  for (const [, data] of qc.getQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] })) for (const m of data?.pages.flatMap((p) => p.value) ?? []) if (want.has(m.id)) seen.add(m.id);
  for (const [, data] of qc.getQueriesData<Message[]>({ queryKey: ["mail", "thread"] })) for (const m of data ?? []) if (want.has(m.id)) seen.add(m.id);
  return seen.size;
}

// One toast per action, however many refetch rounds disagree.
export function serverWinsOnce(verb: string, total: number, count: () => number): (round: "settled" | "late") => void {
  let told = false;
  return () => {
    if (told) return;
    const n = count();
    if (!n) return;
    told = true;
    toast.error(`Outlook did not ${verb} ${n === total && total === 1 ? "the message" : `${n} of ${total} messages`}; showing what Outlook has.`);
  };
}

// ---- Batch results ---------------------------------------------------------

export class PartialBatchError extends Error {
  constructor(public failedIds: string[], public total: number, public detail = "") {
    super(`${failedIds.length} of ${total} failed${detail ? `. ${detail}` : ""}`);
    this.name = "PartialBatchError";
  }
}


const retryAfterOf = (r: BatchResponse) => Number(r.headers?.["Retry-After"] ?? r.headers?.["retry-after"] ?? "0");
const detailOf = (r: BatchResponse) => {
  const b = r.body as { error?: { code?: string; message?: string } } | undefined;
  return b?.error ? `${b.error.code ?? r.status}: ${b.error.message ?? ""}`.trim() : String(r.status);
};

// Correlates by response id (never by index), and retries throttled
// sub-requests (429/503) on their own after Retry-After, twice at most.
export function partitionBatch(requests: BatchRequest[], responses: BatchResponse[]): BatchOutcome {
  const byId = new Map(responses.map((r) => [r.id, r]));
  const out: BatchOutcome = { ok: [], failed: [] };
  for (const req of requests) {
    const r = byId.get(req.id);
    if (!r) out.failed.push({ id: req.id, status: 0, detail: "no response" });
    else if (r.status >= 400) out.failed.push({ id: req.id, status: r.status, detail: detailOf(r) });
    else out.ok.push(req.id);
  }
  return out;
}

export async function runBatch(send: (reqs: BatchRequest[]) => Promise<BatchResponse[]>, requests: BatchRequest[], sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<BatchOutcome> {
  let pending = requests;
  const ok: string[] = [];
  let failed: BatchOutcome["failed"] = [];
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    let responses: BatchResponse[];
    try {
      responses = await send(pending);
    } catch (e) {
      // The whole call failed (offline, consent): everything still pending failed.
      return { ok, failed: [...failed, ...pending.map((r) => ({ id: r.id, status: 0, detail: errorMessage(e) }))] };
    }
    const part = partitionBatch(pending, responses);
    ok.push(...part.ok);
    const throttled = new Set(part.failed.filter((f) => f.status === 429 || f.status === 503).map((f) => f.id));
    failed = [...failed, ...part.failed.filter((f) => !throttled.has(f.id))];
    if (!throttled.size || attempt === 2) {
      failed = [...failed, ...part.failed.filter((f) => throttled.has(f.id))];
      break;
    }
    const wait = Math.max(1, ...responses.filter((r) => throttled.has(r.id)).map(retryAfterOf));
    await sleep(wait * 1000);
    pending = pending.filter((r) => throttled.has(r.id));
  }
  return { ok, failed };
}

// ---- Message actions -------------------------------------------------------

export type Update = { id: string; body: Partial<Message> };

export function useMessageActions() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const batch = (reqs: BatchRequest[]) => graphBatch(instance, MAIL_SCOPES, reqs);

  // Runs the requests (request id == message id) and throws PartialBatchError
  // naming exactly the ids that did not go through.
  const run = async (requests: BatchRequest[]) => {
    if (requests.length === 1) {
      const r = requests[0];
      await graphFetch(instance, MAIL_SCOPES, r.url, { method: r.method, body: r.body });
      return;
    }
    const res = await runBatch(batch, requests);
    if (res.failed.length) throw new PartialBatchError(res.failed.map((f) => f.id), requests.length, res.failed[0]?.detail);
  };

  type Ctx = { prev: Prev; ctx: ActionContext };
  const onError = (verb: string, kind: ActionKind) => (e: unknown, ids: string[], c?: Ctx) => {
    if (e instanceof PartialBatchError) {
      if (c) restoreIds(qc, c.prev, e.failedIds);
      toast.error(`${verb} failed for ${e.failedIds.length} of ${e.total} messages; the rest went through. ${e.detail}`.trim());
    } else {
      if (c) restoreIds(qc, c.prev, ids);
      toast.error(`${verb} failed. ${errorMessage(e)}`);
    }
    void settleAction(qc, kind, c?.ctx ?? actionContext(qc, ids));
  };
  const begin = async (ids: string[], extra: Partial<ActionContext>, patch: (m: Message) => Message | null): Promise<Ctx> => {
    await qc.cancelQueries({ queryKey: ["mail", "list"] });
    await qc.cancelQueries({ queryKey: ["mail", "thread"] });
    const ctx = actionContext(qc, ids, extra);
    return { prev: patchListCaches(qc, new Set(ids), patch), ctx };
  };

  // Which views a PATCH touches: flag -> Starred, categories -> the label
  // views of every label added or removed, else read state.
  const kindOfUpdates = (updates: Update[]): ActionKind => (updates.some((u) => u.body.flag) ? "star" : updates.some((u) => u.body.categories) ? "label" : "read");
  const labelsOf = (updates: Update[]) => {
    const out = new Set<string>();
    for (const u of updates) {
      for (const c of u.body.categories ?? []) out.add(c);
      for (const c of cachedMessage(qc, u.id)?.categories ?? []) out.add(c);
    }
    return [...out];
  };

  const patch = useMutation({
    mutationFn: ({ updates }: { updates: Update[] }) => run(updates.map((u) => ({ id: u.id, method: "PATCH", url: `/me/messages/${u.id}`, body: u.body }))),
    onMutate: ({ updates }) => {
      const bodies = new Map(updates.map((u) => [u.id, u.body]));
      return begin([...bodies.keys()], { labels: labelsOf(updates) }, (m) => ({ ...m, ...bodies.get(m.id) }));
    },
    onError: (e, v, c) => onError("Update", kindOfUpdates(v.updates))(e, v.updates.map((u) => u.id), c),
    onSuccess: (_d, v, c) => {
      const kind = kindOfUpdates(v.updates);
      const verb = kind === "star" ? "change the star on" : kind === "label" ? "relabel" : "update";
      void settleAction(qc, kind, c.ctx, serverWinsOnce(verb, v.updates.length, () => countUnapplied(qc, v.updates)));
    },
  });

  const move = useMutation({
    mutationFn: ({ ids, destinationId }: { ids: string[]; destinationId: string; label?: string; kind: ActionKind }) => run(ids.map((id) => ({ id, method: "POST", url: `/me/messages/${id}/move`, body: { destinationId } }))),
    onMutate: ({ ids, destinationId }) => begin(ids, { destination: folderKeyOf(qc, destinationId) ?? destinationId.toLowerCase() }, () => null),
    onSuccess: (_d, v, c) => {
      toast.success(v.label ?? "Moved");
      void settleAction(qc, v.kind, c.ctx, serverWinsOnce("move", v.ids.length, () => countUnmoved(qc, v.ids, c.ctx.sourceFolders ?? [])));
    },
    onError: (e, v, c) => onError("Move", v.kind)(e, v.ids, c),
  });

  const remove = useMutation({
    // allowedFolderId: defence in depth for a hard delete; any id whose cached
    // copy lives in another folder is dropped before the batch is built.
    mutationFn: ({ ids, allowedFolderId }: { ids: string[]; allowedFolderId?: string }) => {
      const safe = allowedFolderId ? ids.filter((id) => (cachedMessage(qc, id)?.parentFolderId ?? allowedFolderId) === allowedFolderId) : ids;
      if (!safe.length) return Promise.resolve();
      return run(safe.map((id) => ({ id, method: "DELETE", url: `/me/messages/${id}` })));
    },
    onMutate: ({ ids }) => begin(ids, {}, () => null),
    onSuccess: (_d, v, c) => {
      toast.success("Deleted forever");
      void settleAction(qc, "deleteForever", c.ctx, serverWinsOnce("delete", v.ids.length, () => countUndeleted(qc, v.ids)));
    },
    onError: (e, v, c) => onError("Delete", "deleteForever")(e, v.ids, c),
  });

  const convLabel = (n: number, one: string, many: string) => (n > 1 ? `${n} ${many}` : one);
  return {
    setRead: (ids: string[], isRead: boolean) => patch.mutate({ updates: ids.map((id) => ({ id, body: { isRead } })) }),
    setStar: (ids: string[], starred: boolean) => patch.mutate({ updates: ids.map((id) => ({ id, body: { flag: { flagStatus: starred ? "flagged" : "notFlagged" } } })) }),
    setCategories: (ids: string[], categories: string[]) => patch.mutate({ updates: ids.map((id) => ({ id, body: { categories } })) }),
    // One batch, one optimistic update, per-message category lists.
    setCategoriesMany: (updates: { id: string; categories: string[] }[]) => updates.length && patch.mutate({ updates: updates.map((u) => ({ id: u.id, body: { categories: u.categories } })) }),
    // `conversations` drives the toast; ids may hold several messages of one conversation.
    archive: (ids: string[], conversations = 1) => move.mutate({ ids, destinationId: "archive", label: convLabel(conversations, "Conversation archived", "conversations archived"), kind: "archive" }),
    trash: (ids: string[], conversations = 1) => move.mutate({ ids, destinationId: "deleteditems", label: convLabel(conversations, "Conversation moved to Trash", "conversations moved to Trash"), kind: "trash" }),
    spam: (ids: string[]) => move.mutate({ ids, destinationId: "junkemail", label: "Reported as spam", kind: "spam" }),
    inbox: (ids: string[]) => move.mutate({ ids, destinationId: "inbox", label: "Moved to Inbox", kind: "inbox" }),
    moveTo: (ids: string[], destinationId: string, name: string) => move.mutate({ ids, destinationId, label: `Moved to ${name}`, kind: "move" }),
    deleteForever: (ids: string[], allowedFolderId?: string) => remove.mutate({ ids, allowedFolderId }),
    pending: patch.isPending || move.isPending || remove.isPending,
  };
}

// ---- Categories & rules ----------------------------------------------------

export function useCategories() {
  const { instance } = useMsal();
  return useQuery({
    ...calm,
    queryKey: keys.categories,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Page<OutlookCategory>>(instance, SETTINGS_SCOPES, "/me/outlook/masterCategories").then((p) => p.value),
  });
}

export function useCategoryMutations() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const patchCategories = (fn: (list: OutlookCategory[]) => OutlookCategory[]) => qc.setQueryData<OutlookCategory[]>(keys.categories, (old) => (old ? fn(old) : old));
  const create = useMutation({
    mutationFn: ({ displayName, color }: { displayName: string; color: string }) => graphFetch<OutlookCategory>(instance, SETTINGS_SCOPES, "/me/outlook/masterCategories", { method: "POST", body: { displayName, color } }),
    onSuccess: (created) => {
      toast.success("Label created");
      patchCategories((list) => (list.some((c) => c.id === created.id) ? list : [...list, created]));
      void settleAction(qc, "category", { labels: [created.displayName] });
    },
    onError: (e) => {
      toast.error(`Could not create label. ${errorMessage(e)}`);
      void settleAction(qc, "category");
    },
  });
  // Graph only allows PATCHing color; displayName is immutable once created.
  const update = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) => graphFetch<OutlookCategory>(instance, SETTINGS_SCOPES, `/me/outlook/masterCategories/${id}`, { method: "PATCH", body: { color } }),
    onMutate: ({ id, color }) => patchCategories((list) => list.map((c) => (c.id === id ? { ...c, color } : c))),
    onSettled: (_d, e) => {
      if (e) toast.error(`Could not update label colour. ${errorMessage(e)}`);
      void settleAction(qc, "category");
    },
  });
  // Deletes the category and the inbox rules this app created for it. Rules
  // built in Outlook that also assign the category are left alone.
  const remove = useMutation({
    mutationFn: async ({ id, displayName }: { id: string; displayName?: string }) => {
      if (displayName) {
        const rules = await graphFetch<Page<MessageRule>>(instance, SETTINGS_SCOPES, RULES_PATH).then((p) => p.value).catch(() => [] as MessageRule[]);
        for (const r of ownRules(displayName, rules)) await graphFetch<void>(instance, SETTINGS_SCOPES, `${RULES_PATH}/${r.id}`, { method: "DELETE" });
      }
      await graphFetch<void>(instance, SETTINGS_SCOPES, `/me/outlook/masterCategories/${id}`, { method: "DELETE" });
    },
    onMutate: ({ id }) => patchCategories((list) => list.filter((c) => c.id !== id)),
    onSuccess: (_d, v) => {
      toast.success("Label deleted");
      void settleAction(qc, "category", { labels: v.displayName ? [v.displayName] : [], ...viewContext(qc) });
    },
    onError: (e) => {
      toast.error(`Could not delete label. ${errorMessage(e)}`);
      void settleAction(qc, "category");
    },
  });
  return { create, update, remove };
}

export function useRules(enabled = true) {
  const { instance } = useMsal();
  return useQuery({
    ...calm,
    queryKey: keys.rules,
    enabled,
    staleTime: 60_000,
    queryFn: () => graphFetch<Page<MessageRule>>(instance, SETTINGS_SCOPES, RULES_PATH).then((p) => p.value),
  });
}

export function useRuleMutations() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  // Rules run on arrival, but the demo (and some tenants) apply them at once:
  // the inbox and counts are refetched alongside the rule list.
  const settle = () => void settleAction(qc, "rules", viewContext(qc));
  const patchRules = (fn: (list: MessageRule[]) => MessageRule[]) => qc.setQueryData<MessageRule[]>(keys.rules, (old) => (old ? fn(old) : old));
  const create = useMutation({
    mutationFn: (rule: Omit<MessageRule, "id">) => graphFetch<MessageRule>(instance, SETTINGS_SCOPES, RULES_PATH, { method: "POST", body: rule }),
    onSuccess: (created) => patchRules((list) => (list.some((r) => r.id === created.id) ? list : [...list, created])),
    onError: (e) => toast.error(`Could not create filter. ${errorMessage(e)}`),
    onSettled: settle,
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<MessageRule> & { id: string }) => graphFetch<MessageRule>(instance, SETTINGS_SCOPES, `${RULES_PATH}/${id}`, { method: "PATCH", body: patch }),
    onMutate: ({ id, ...patch }) => patchRules((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    onError: (e) => toast.error(`Could not update filter. ${errorMessage(e)}`),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: ({ id }: { id: string }) => graphFetch<void>(instance, SETTINGS_SCOPES, `${RULES_PATH}/${id}`, { method: "DELETE" }),
    onMutate: ({ id }) => patchRules((list) => list.filter((r) => r.id !== id)),
    onSuccess: () => toast.success("Filter deleted"),
    onError: (e) => toast.error(`Could not delete filter. ${errorMessage(e)}`),
    onSettled: settle,
  });
  return { create, update, remove };
}

// ---- Graph API for lib/mail/install.ts ------------------------------------

const scopesFor = (path: string) => (path.startsWith(CATEGORIES_PATH) || path.includes("/messageRules") ? SETTINGS_SCOPES : MAIL_SCOPES);

// Same call surface as the mock-backed test API, so set-up code is shared.
export function useGraphApi(): GraphApi {
  const { instance } = useMsal();
  return {
    get: (path) => graphFetch(instance, scopesFor(path), path),
    getAll: (path, max) => graphGetAll(instance, scopesFor(path), path, max),
    post: (path, body) => graphFetch(instance, scopesFor(path), path, { method: "POST", body }),
    patch: (path, body) => graphFetch(instance, scopesFor(path), path, { method: "PATCH", body }),
    del: (path) => graphFetch<void>(instance, scopesFor(path), path, { method: "DELETE" }),
    batch: (reqs) => runBatch((r) => graphBatch(instance, MAIL_SCOPES, r), reqs),
  };
}

// Names of folders the top-level list does not know (rules that move into a
// subfolder), one small GET each.
export function useFolderNames(ids: string[]) {
  const { instance } = useMsal();
  const key = [...new Set(ids)].sort().join("|");
  return useQuery({
    ...calm,
    queryKey: ["mail", "folderNames", key],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        key.split("|").filter(Boolean).map(async (id) => {
          const f = await graphFetch<MailFolder>(instance, MAIL_SCOPES, `/me/mailFolders/${id}?$select=id,displayName`).catch(() => null);
          if (f) out[id] = f.displayName;
        })
      );
      return out;
    },
  });
}

// ---- Backfill --------------------------------------------------------------

// Pages the inbox (last 500), matches client-side and PATCHes categories in
// batches of 20, preserving the categories each message already has; with a
// folder id it also moves every match there (skip the inbox).
export function useBackfill() {
  const api = useGraphApi();
  const qc = useQueryClient();
  return async (label: string, conditions: LabelConditions, meAddress?: string, moveToFolder?: string): Promise<BackfillResult> => {
    const res = await backfillLabel(api, label, conditions, meAddress, moveToFolder);
    if (res.failed) toast.error(`${res.failed} messages could not be ${moveToFolder ? "labelled or moved" : "labelled"}`);
    if (res.labelled || res.moved || res.failed) {
      const ctx: ActionContext = { labels: [label], sourceFolders: ["inbox", "archive"], ...viewContext(qc) };
      void settleAction(qc, moveToFolder ? "move" : "label", moveToFolder ? { ...ctx, destination: folderKeyOf(qc, moveToFolder) ?? moveToFolder } : ctx);
    }
    return res;
  };
}

// Moves a skip-inbox label's mail (the category's messages in its folder) back to the Inbox.
export function useMoveLabelBack() {
  const api = useGraphApi();
  const qc = useQueryClient();
  return async (label: string, folderId: string): Promise<number> => {
    const n = await moveLabelBackToInbox(api, label, folderId);
    if (n) void settleAction(qc, "inbox", { labels: [label], sourceFolders: [folderKeyOf(qc, folderId) ?? folderId], ...viewContext(qc) });
    return n;
  };
}

// Removes a label from every message that carries it (label view pages, 500
// max). When Graph rejects the category query the fallback scans the Inbox,
// the Archive and the label's own folder, so skip-inbox mail is not missed.
export function useRemoveLabelFromAll() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  return async (label: string): Promise<number> => {
    const list = await graphGetAll<Message>(instance, MAIL_SCOPES, labelListPath(label, listStrategy.label === "search" ? "search" : "filter"), BACKFILL_MAX).catch(async () => {
      const folderId = await labelFolderId((path) => graphFetch(instance, MAIL_SCOPES, path), label, qc.getQueryData<MessageRule[]>(keys.rules));
      return labelMessagesClientSide((path) => graphGetAll<Message>(instance, MAIL_SCOPES, path, BACKFILL_MAX), label, folderId, BACKFILL_SELECT);
    });
    if (!list.length) return 0;
    const res = await runBatch((reqs) => graphBatch(instance, MAIL_SCOPES, reqs), list.map((m) => ({ id: m.id, method: "PATCH", url: `/me/messages/${m.id}`, body: { categories: withoutCategory(m.categories, label) } })));
    void settleAction(qc, "label", { labels: [label], messageIds: list.map((m) => m.id), ...viewContext(qc) });
    return list.length - res.failed.length;
  };
}

// ---- Preset labels ----------------------------------------------------------

// Installs PRESET_LABELS (category, folder, rules, backfill + move) and
// reports per label. Idempotent: rules are replaced, never duplicated.
export function useInstallPresets() {
  const api = useGraphApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meAddress }: { meAddress?: string }) => installPresets(api, PRESET_LABELS, meAddress),
    onSuccess: (results) => {
      const moved = results.reduce((n, r) => n + r.moved, 0);
      const failed = results.filter((r) => r.error);
      const movedText = `${moved} ${moved === 1 ? "message" : "messages"} moved out of the inbox.`;
      if (failed.length) toast.error(`${failed.length} of ${results.length} labels could not be set up (${failed.map((r) => r.name).join(", ")}); see the details below. ${movedText}`);
      else toast.success(`${results.length} labels set up. ${movedText}`);
    },
    onError: (e) => toast.error(`Could not set up labels. ${errorMessage(e)}`),
    // Part of the work may have landed before an error: refetch either way.
    onSettled: () => void settleAction(qc, "presets"),
  });
}

// ---- Inbox sorting (Social / Promotions) ----------------------------------

// True once a rule assigns each sorting category; undefined while unknown.
export function useSortingEnabled() {
  const rules = useRules();
  return rules.data ? [SOCIAL_LABEL, PROMOTIONS_LABEL].every((l) => rulesOfLabel(l, rules.data).length > 0) : undefined;
}

// Creates the Social and Promotions categories and rules if missing (after
// every existing rule, so "Label:" rules run first), then backfills the last
// 500 inbox messages for both. Pure of React so it can run against the mock.
export type SortingProgress = "labels" | "rules" | "social" | "promotions";
export const SORTING_PROGRESS_LABEL: Record<SortingProgress, string> = {
  labels: "Creating the Social and Promotions labels",
  rules: "Creating the two inbox rules",
  social: "Sorting social updates from the last 500 inbox messages",
  promotions: "Sorting newsletters from the last 500 inbox messages",
};
export async function enableSorting(api: GraphApi, backfill: (label: string, c: LabelConditions) => Promise<BackfillResult>, onProgress: (p: SortingProgress) => void = () => {}): Promise<{ social: number; promos: number; failed: number }> {
  onProgress("labels");
  const cats = await api.get<Page<OutlookCategory>>(CATEGORIES_PATH).then((p) => p.value);
  const have = new Set(cats.map((c) => c.displayName.toLowerCase()));
  for (const [name, color] of [[SOCIAL_LABEL, SOCIAL_COLOR], [PROMOTIONS_LABEL, PROMOTIONS_COLOR]] as const) {
    if (!have.has(name.toLowerCase())) await api.post(CATEGORIES_PATH, { displayName: name, color });
  }
  onProgress("rules");
  const rules = await api.get<Page<MessageRule>>(RULES_PATH).then((p) => p.value);
  let seq = rules.reduce((m, r) => Math.max(m, r.sequence ?? 0), 0);
  const names = new Set(rules.map((r) => r.displayName));
  for (const r of SORTING_RULES) {
    if (names.has(r.displayName)) continue;
    seq += 1;
    await api.post(RULES_PATH, { ...r, sequence: seq });
  }
  onProgress("social");
  const social = await backfill(SOCIAL_LABEL, SOCIAL_CONDITIONS);
  onProgress("promotions");
  const promos = await backfill(PROMOTIONS_LABEL, PROMOTIONS_CONDITIONS);
  return { social: social.labelled, promos: promos.labelled, failed: social.failed + promos.failed };
}

export function useEnableSorting() {
  const api = useGraphApi();
  const qc = useQueryClient();
  const backfill = useBackfill();
  const [progress, setProgress] = useState<SortingProgress | null>(null);
  const mutation = useMutation({
    mutationFn: () => enableSorting(api, (label, c) => backfill(label, c), setProgress),
    onSuccess: ({ social, promos, failed }) => toast.success(`Inbox sorting on. ${social} social and ${promos} promotional ${social + promos === 1 ? "message" : "messages"} sorted${failed ? `, ${failed} could not be labelled` : ""}.`),
    onError: (e) => toast.error(`Could not turn on inbox sorting. ${errorMessage(e)}`),
    onSettled: () => {
      setProgress(null);
      void settleAction(qc, "presets");
    },
  });
  return Object.assign(mutation, { progress: mutation.isPending ? progress : null, progressLabel: mutation.isPending && progress ? SORTING_PROGRESS_LABEL[progress] : null });
}

export function useCreateRule() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<MessageRule, "id">) => graphFetch<MessageRule>(instance, SETTINGS_SCOPES, RULES_PATH, { method: "POST", body: rule }),
    onSuccess: () => toast.success("Filter created"),
    onError: (e) => toast.error(`Could not create filter. ${errorMessage(e)}`),
    onSettled: () => void settleAction(qc, "rules", viewContext(qc)),
  });
}

// ---- Drafts ----------------------------------------------------------------

// Newest Sent Items rows, enough to find a message sent moments ago.
export const SENT_POLL_PATH = "/me/mailFolders/sentitems/messages?$select=id,conversationId,subject,internetMessageId,isDraft&$orderby=receivedDateTime desc&$top=10";
export const DRAFT_META_SELECT = "id,conversationId,subject,internetMessageId";

export function useDraftApi() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const settleDraft = (conversationId?: string) => void settleAction(qc, "draft", { conversationIds: conversationId ? [conversationId] : [], ...viewContext(qc) });
  // Outlook files the sent copy into Sent Items on its own time: poll every
  // 2 s for up to 20 s until it shows, then refetch Sent and the thread.
  const pollSent = async (draftId: string, hint: { subject?: string; internetMessageId?: string; conversationId?: string }) => {
    const settler = settlerFor(qc);
    await pollUntil(
      async () => {
        const page = await graphFetch<Page<Message>>(instance, MAIL_SCOPES, SENT_POLL_PATH);
        const hit = page.value.some((m) => isSentCopy(m, draftId, hint));
        if (hit) void settleAction(qc, "send", { conversationIds: hint.conversationId ? [hint.conversationId] : [], ...viewContext(qc) });
        return hit;
      },
      { delay: (ms) => settler.delay(ms) }
    );
  };
  return {
    create: (body: Partial<Message>) => graphFetch<Message>(instance, MAIL_SCOPES, "/me/messages", { method: "POST", body }).then((m) => (settleDraft(m.conversationId), m)),
    // Autosave every typing pause: only the Drafts list needs the new
    // subject/preview; counts change on create, discard and send.
    update: (id: string, body: Partial<Message>) => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}`, { method: "PATCH", body }).then((m) => (void qc.invalidateQueries({ queryKey: listKey("drafts") }), m)),
    send: async (id: string, hint: { subject?: string } = {}) => {
      // The sent copy is matched by id, internetMessageId or subject; the
      // draft's metadata is read first because the id may change on send.
      const meta = await graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}?$select=${DRAFT_META_SELECT}`).catch(() => undefined);
      await graphFetch<void>(instance, SEND_SCOPES, `/me/messages/${id}/send`, { method: "POST" });
      const ctx: ActionContext = { conversationIds: meta?.conversationId ? [meta.conversationId] : [], ...viewContext(qc) };
      void settleAction(qc, "send", ctx);
      void pollSent(id, { subject: meta?.subject ?? hint.subject, internetMessageId: meta?.internetMessageId, conversationId: meta?.conversationId });
    },
    discard: (id: string) => {
      const conv = cachedMessage(qc, id)?.conversationId;
      return graphFetch<void>(instance, MAIL_SCOPES, `/me/messages/${id}`, { method: "DELETE" }).then(() => {
        patchListCaches(qc, new Set([id]), () => null);
        settleDraft(conv);
      });
    },
    // Undo within the send window keeps the draft: Drafts and its count are refetched.
    undoSend: (id: string) => settleDraft(cachedMessage(qc, id)?.conversationId),
    reply: (id: string, kind: "createReply" | "createReplyAll" | "createForward") =>
      graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}/${kind}`, { method: "POST", body: {} }).then((m) => (settleDraft(m.conversationId), m)),
    get: (id: string) => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}?$select=${LIST_SELECT},body,bccRecipients`),
    addSmallAttachment: (id: string, file: { name: string; contentType: string; contentBytes: string }) =>
      graphFetch<Attachment>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments`, { method: "POST", body: { "@odata.type": "#microsoft.graph.fileAttachment", ...file } }),
    createUploadSession: (id: string, item: { name: string; contentType: string; size: number }) =>
      graphFetch<{ uploadUrl: string }>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments/createUploadSession`, { method: "POST", body: { AttachmentItem: { attachmentType: "file", ...item } } }),
    removeAttachment: (id: string, attId: string) => graphFetch<void>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments/${attId}`, { method: "DELETE" }),
    listAttachments: (id: string) => graphFetch<Page<Attachment>>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments?$select=${ATTACHMENT_SELECT}`).then((p) => p.value),
  };
}

// ---- Freshness: polling the open view ----------------------------------------

// The seed only has to yield a token: a one-hour window keeps the initial
// walk to a page or two (receivedDateTime ge is the one $filter delta accepts).
export const deltaSeedPath = (now = Date.now()) => `/me/mailFolders/inbox/messages/delta?$select=id,isRead,receivedDateTime&$filter=receivedDateTime ge ${new Date(now - 3600_000).toISOString()}`;
const deltaKey = (accountId: string, folder = "inbox") => `msui.mail.delta.${folder}.${accountId}`;

// Delta links are per account and per folder and survive a reload in
// localStorage, so a visit costs one small call instead of a full walk.
// Never persisted in mock mode (the mock token must not leak into a real session).
export function loadDeltaLink(accountId: string, folder = "inbox"): string | null {
  try {
    return localStorage.getItem(deltaKey(accountId, folder));
  } catch {
    return null;
  }
}
export function saveDeltaLink(accountId: string, link: string | null, folder = "inbox") {
  if (isMockMode()) return;
  try {
    if (link) localStorage.setItem(deltaKey(accountId, folder), link);
    else localStorage.removeItem(deltaKey(accountId, folder));
  } catch {
    // storage blocked
  }
}

// An expired or invalid token (410, SyncStateNotFound, ResyncRequired) means
// the next round must start from a fresh seed instead of retrying forever.
export function isDeadDeltaLink(e: unknown): boolean {
  return e instanceof GraphError && (e.status === 410 || /SyncState|ResyncRequired|InvalidDeltaToken|ErrorInvalidSyncStateData/i.test(e.code));
}

// Polls the open view every 15 s (+ jitter) while the tab is visible: the
// Inbox through its delta feed (the link is reused across rounds and, in
// real mode, reloads), every other folder, Starred and label view through a
// plain first-page fetch compared with the cached first page. A change
// refetches the list; the folder counts are refetched every round. Paused
// while hidden; runs at once on visibilitychange -> visible and window focus.
// Returns when the last round finished (for "Updated <n>s ago") and a
// refresh() that refetches everything on screen right away.
export function useMailPolling(view: ListView, enabled: boolean): { lastPolledAt: number; refresh: () => void } {
  const { instance, accounts } = useMsal();
  const qc = useQueryClient();
  const accountId = accounts[0]?.homeAccountId ?? "anon";
  const [lastPolledAt, setLastPolledAt] = useState(0);
  const link = useRef<string | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    if (!enabled) return;
    link.current = isMockMode() ? null : loadDeltaLink(accountId);
    let stopped = false;

    const inboxTick = async () => {
      try {
        const seeded = !!link.current;
        const headers = { Prefer: "odata.maxpagesize=100" };
        let page = await graphFetch<Page<Message>>(instance, MAIL_SCOPES, link.current ?? deltaSeedPath(), { headers });
        let changed = seeded && page.value.length > 0;
        while (page["@odata.nextLink"] && !stopped) {
          page = await graphFetch<Page<Message>>(instance, MAIL_SCOPES, page["@odata.nextLink"], { headers });
          changed = changed || (seeded && page.value.length > 0);
        }
        if (page["@odata.deltaLink"]) {
          link.current = page["@odata.deltaLink"];
          saveDeltaLink(accountId, link.current);
        }
        if (changed) await qc.invalidateQueries({ queryKey: listKey("inbox") });
      } catch (e) {
        if (isDeadDeltaLink(e)) {
          link.current = null;
          saveDeltaLink(accountId, null);
        }
        throw e;
      }
    };
    const pageTick = async (v: ListView) => {
      const key = listQueryKey(v);
      // The client-side label fallback has no cheap first page: plain refetch.
      if (labelFromFolder(v.folder) && listStrategy.label === "client") {
        await qc.invalidateQueries({ queryKey: key });
        return;
      }
      const path = listPathFor(v);
      if (!path) return;
      const page = await graphFetch<ListPage>(instance, MAIL_SCOPES, path);
      const cached = qc.getQueryData<InfiniteData<ListPage>>(key);
      // An action in flight owns the cache: its own settle refetches.
      if (!cached || qc.isMutating() > 0) return;
      if (pageFingerprint(page.value) === pageFingerprint(cached.pages[0]?.value ?? [])) return;
      if (cached.pages.length === 1) qc.setQueryData<InfiniteData<ListPage>>(key, { pages: [page], pageParams: [""] });
      else await qc.invalidateQueries({ queryKey: key });
    };
    // One round: the open view, then the folder counts. A query in error is
    // left alone (its error stays on screen with a retry button) so a
    // rejected request is not replayed every 15 s.
    const tick = async () => {
      const v = viewRef.current;
      const listErrored = qc.getQueryState(listQueryKey(v))?.status === "error";
      try {
        if (listErrored) return;
        if (v.folder === "inbox" && !v.query) await inboxTick();
        else await pageTick(v);
      } finally {
        if (qc.getQueryState(keys.folders)?.status !== "error") void qc.invalidateQueries({ queryKey: keys.folders });
        if (!stopped) setLastPolledAt(Date.now());
      }
    };
    const poller = createPoller({ tick, isVisible: () => document.visibilityState === "visible" });
    pollerRef.current = poller;
    poller.start();
    const onVis = () => {
      if (document.visibilityState === "visible") poller.wake();
    };
    const onFocus = () => poller.wake();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, instance, qc, accountId]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["mail"] });
    pollerRef.current?.wake(true);
  }, [qc]);
  return { lastPolledAt, refresh };
}
