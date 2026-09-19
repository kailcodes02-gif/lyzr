"use client";

import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { graphBatch, graphFetch, graphFetchBlob, GraphError, type Page } from "@/lib/graph";
import { folderListPath, searchListPath } from "./logic";
import type { Attachment, MailFolder, Message, MessageRule, OutlookCategory } from "./types";

export const MAIL_SCOPES = ["Mail.ReadWrite"];
export const SEND_SCOPES = ["Mail.ReadWrite", "Mail.Send"];
export const SETTINGS_SCOPES = ["MailboxSettings.ReadWrite"];
export const CONSENT_KEYS = ["mail", "send", "contacts", "settings"];

export const LIST_SELECT =
  "id,conversationId,conversationIndex,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,flag,categories,importance,inferenceClassification,isDraft,webLink,parentFolderId";

// True when the failure is "the tenant has not approved this scope yet".
export function isConsentError(e: unknown): boolean {
  if (e instanceof InteractionRequiredAuthError) return true;
  if (e instanceof GraphError) return e.status === 401 || e.status === 403;
  if (e && typeof e === "object" && "errorCode" in e) return true;
  return false;
}

export function errorMessage(e: unknown): string {
  if (e instanceof GraphError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const keys = {
  folders: ["mail", "folders"] as const,
  children: (id: string) => ["mail", "childFolders", id] as const,
  list: (folder: string, tab?: string, query?: string) => ["mail", "list", folder, tab ?? "", query ?? ""] as const,
  thread: (conversationId: string) => ["mail", "thread", conversationId] as const,
  message: (id: string) => ["mail", "message", id] as const,
  attachments: (id: string) => ["mail", "attachments", id] as const,
  categories: ["mail", "categories"] as const,
  rules: ["mail", "rules"] as const,
};

// ---- Folders --------------------------------------------------------------

export function useFolders() {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.folders,
    staleTime: 60_000,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: () =>
      graphFetch<Page<MailFolder>>(instance, MAIL_SCOPES, "/me/mailFolders?$select=id,displayName,wellKnownName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount&$top=100").then((p) => p.value),
  });
}

export function useChildFolders(parentId: string | null) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.children(parentId ?? ""),
    enabled: !!parentId,
    staleTime: 60_000,
    queryFn: () =>
      graphFetch<Page<MailFolder>>(instance, MAIL_SCOPES, `/me/mailFolders/${parentId}/childFolders?$select=id,displayName,wellKnownName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount&$top=100`).then((p) => p.value),
  });
}

export function useFolderMutations() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.folders }).then(() => qc.invalidateQueries({ queryKey: ["mail", "childFolders"] }));
  const create = useMutation({
    mutationFn: ({ displayName, parentId }: { displayName: string; parentId?: string }) =>
      graphFetch<MailFolder>(instance, MAIL_SCOPES, parentId ? `/me/mailFolders/${parentId}/childFolders` : "/me/mailFolders", { method: "POST", body: { displayName } }),
    onSuccess: () => {
      toast.success("Folder created");
      void invalidate();
    },
    onError: (e) => toast.error(`Could not create folder. ${errorMessage(e)}`),
  });
  const rename = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) => graphFetch<MailFolder>(instance, MAIL_SCOPES, `/me/mailFolders/${id}`, { method: "PATCH", body: { displayName } }),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(`Could not rename folder. ${errorMessage(e)}`),
  });
  const remove = useMutation({
    mutationFn: ({ id }: { id: string }) => graphFetch<void>(instance, MAIL_SCOPES, `/me/mailFolders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Folder moved to Trash");
      void invalidate();
    },
    onError: (e) => toast.error(`Could not delete folder. ${errorMessage(e)}`),
  });
  return { create, rename, remove };
}

// ---- Message list ---------------------------------------------------------

export type ListPage = Page<Message>;

export function useMessageList(folder: string, tab?: string, query?: string) {
  const { instance } = useMsal();
  const first = query ? searchListPath(query) : folderListPath(folder, tab);
  return useInfiniteQuery({
    queryKey: keys.list(folder, tab, query),
    initialPageParam: first,
    staleTime: 30_000,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: ({ pageParam }) => graphFetch<ListPage>(instance, MAIL_SCOPES, pageParam),
    getNextPageParam: (last) => last["@odata.nextLink"],
  });
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
    queryFn: () =>
      graphFetch<Page<Message>>(instance, MAIL_SCOPES, `/me/messages?$select=${LIST_SELECT}&$filter=conversationId eq '${conversationId!.replace(/'/g, "''")}'&$top=100`).then((p) => p.value),
  });
}

export function useMessage(id?: string) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.message(id ?? ""),
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}?$select=${LIST_SELECT},body,uniqueBody,bccRecipients,replyTo,sentDateTime`),
  });
}

export function useAttachments(id?: string, enabled = true) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.attachments(id ?? ""),
    enabled: !!id && enabled,
    staleTime: 5 * 60_000,
    queryFn: () => graphFetch<Page<Attachment>>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments?$select=id,name,contentType,size,isInline,contentId`).then((p) => p.value),
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

function patchListCaches(qc: QueryClient, ids: Set<string>, patch: (m: Message) => Message | null) {
  qc.setQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({ ...p, value: p.value.map((m) => (ids.has(m.id) ? patch(m) : m)).filter((m): m is Message => m !== null) })),
    };
  });
  qc.setQueriesData<Message[]>({ queryKey: ["mail", "thread"] }, (old) => old?.map((m) => (ids.has(m.id) ? patch(m) : m)).filter((m): m is Message => m !== null));
  for (const id of ids) {
    qc.setQueryData<Message>(keys.message(id), (old) => (old ? (patch(old) ?? old) : old));
  }
}

function snapshot(qc: QueryClient) {
  return { lists: qc.getQueriesData<InfiniteData<ListPage>>({ queryKey: ["mail", "list"] }), threads: qc.getQueriesData<Message[]>({ queryKey: ["mail", "thread"] }) };
}
function restore(qc: QueryClient, snap: ReturnType<typeof snapshot>) {
  for (const [k, v] of snap.lists) qc.setQueryData(k, v);
  for (const [k, v] of snap.threads) qc.setQueryData(k, v);
}

// ---- Message actions -------------------------------------------------------

export function useMessageActions() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mail", "list"] });
    void qc.invalidateQueries({ queryKey: keys.folders });
  };

  const patch = useMutation({
    mutationFn: async ({ ids, body }: { ids: string[]; body: Partial<Message> }) => {
      if (ids.length === 1) return graphFetch(instance, MAIL_SCOPES, `/me/messages/${ids[0]}`, { method: "PATCH", body });
      const res = await graphBatch(instance, MAIL_SCOPES, ids.map((id, i) => ({ id: String(i), method: "PATCH", url: `/me/messages/${id}`, body })));
      const failed = res.filter((r) => r.status >= 400);
      if (failed.length) throw new Error(`${failed.length} of ${ids.length} failed`);
    },
    onMutate: ({ ids, body }) => {
      const snap = snapshot(qc);
      patchListCaches(qc, new Set(ids), (m) => ({ ...m, ...body }));
      return snap;
    },
    onError: (e, _v, snap) => {
      if (snap) restore(qc, snap);
      toast.error(`Update failed. ${errorMessage(e)}`);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.folders }),
  });

  const move = useMutation({
    mutationFn: async ({ ids, destinationId }: { ids: string[]; destinationId: string; label?: string }) => {
      if (ids.length === 1) return graphFetch(instance, MAIL_SCOPES, `/me/messages/${ids[0]}/move`, { method: "POST", body: { destinationId } });
      const res = await graphBatch(instance, MAIL_SCOPES, ids.map((id, i) => ({ id: String(i), method: "POST", url: `/me/messages/${id}/move`, body: { destinationId } })));
      const failed = res.filter((r) => r.status >= 400);
      if (failed.length) throw new Error(`${failed.length} of ${ids.length} failed`);
    },
    onMutate: ({ ids }) => {
      const snap = snapshot(qc);
      patchListCaches(qc, new Set(ids), () => null);
      return snap;
    },
    onSuccess: (_d, v) => {
      toast.success(v.label ?? "Moved");
      refresh();
      void qc.invalidateQueries({ queryKey: ["mail", "thread"] });
    },
    onError: (e, _v, snap) => {
      if (snap) restore(qc, snap);
      toast.error(`Move failed. ${errorMessage(e)}`);
    },
  });

  const remove = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      const res = await graphBatch(instance, MAIL_SCOPES, ids.map((id, i) => ({ id: String(i), method: "DELETE", url: `/me/messages/${id}` })));
      const failed = res.filter((r) => r.status >= 400);
      if (failed.length) throw new Error(`${failed.length} of ${ids.length} failed`);
    },
    onMutate: ({ ids }) => {
      const snap = snapshot(qc);
      patchListCaches(qc, new Set(ids), () => null);
      return snap;
    },
    onSuccess: () => {
      toast.success("Deleted forever");
      refresh();
    },
    onError: (e, _v, snap) => {
      if (snap) restore(qc, snap);
      toast.error(`Delete failed. ${errorMessage(e)}`);
    },
  });

  return {
    setRead: (ids: string[], isRead: boolean) => patch.mutate({ ids, body: { isRead } }),
    setStar: (ids: string[], starred: boolean) => patch.mutate({ ids, body: { flag: { flagStatus: starred ? "flagged" : "notFlagged" } } }),
    setCategories: (ids: string[], categories: string[]) => patch.mutate({ ids, body: { categories } }),
    archive: (ids: string[]) => move.mutate({ ids, destinationId: "archive", label: ids.length > 1 ? `${ids.length} conversations archived` : "Conversation archived" }),
    trash: (ids: string[]) => move.mutate({ ids, destinationId: "deleteditems", label: ids.length > 1 ? `${ids.length} conversations moved to Trash` : "Conversation moved to Trash" }),
    spam: (ids: string[]) => move.mutate({ ids, destinationId: "junkemail", label: "Reported as spam" }),
    inbox: (ids: string[]) => move.mutate({ ids, destinationId: "inbox", label: "Moved to Inbox" }),
    moveTo: (ids: string[], destinationId: string, name: string) => move.mutate({ ids, destinationId, label: `Moved to ${name}` }),
    deleteForever: (ids: string[]) => remove.mutate({ ids }),
    pending: patch.isPending || move.isPending || remove.isPending,
  };
}

// ---- Categories & rules ----------------------------------------------------

export function useCategories() {
  const { instance } = useMsal();
  return useQuery({
    queryKey: keys.categories,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => graphFetch<Page<OutlookCategory>>(instance, SETTINGS_SCOPES, "/me/outlook/masterCategories").then((p) => p.value),
  });
}

export function useCategoryMutations() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: ({ displayName, color }: { displayName: string; color: string }) => graphFetch<OutlookCategory>(instance, SETTINGS_SCOPES, "/me/outlook/masterCategories", { method: "POST", body: { displayName, color } }),
    onSuccess: () => {
      toast.success("Label created");
      void qc.invalidateQueries({ queryKey: keys.categories });
    },
    onError: (e) => toast.error(`Could not create label. ${errorMessage(e)}`),
  });
  const remove = useMutation({
    mutationFn: ({ id }: { id: string }) => graphFetch<void>(instance, SETTINGS_SCOPES, `/me/outlook/masterCategories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Label removed");
      void qc.invalidateQueries({ queryKey: keys.categories });
    },
    onError: (e) => toast.error(`Could not remove label. ${errorMessage(e)}`),
  });
  return { create, remove };
}

export function useCreateRule() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<MessageRule, "id">) => graphFetch<MessageRule>(instance, SETTINGS_SCOPES, "/me/mailFolders/inbox/messageRules", { method: "POST", body: rule }),
    onSuccess: () => {
      toast.success("Filter created");
      void qc.invalidateQueries({ queryKey: ["mail"] });
    },
    onError: (e) => toast.error(`Could not create filter. ${errorMessage(e)}`),
  });
}

// ---- Drafts ----------------------------------------------------------------

export function useDraftApi() {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const invalidateDrafts = () => {
    void qc.invalidateQueries({ queryKey: ["mail", "list", "drafts"] });
    void qc.invalidateQueries({ queryKey: keys.folders });
  };
  return {
    create: (body: Partial<Message>) => graphFetch<Message>(instance, MAIL_SCOPES, "/me/messages", { method: "POST", body }).then((m) => (invalidateDrafts(), m)),
    update: (id: string, body: Partial<Message>) => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}`, { method: "PATCH", body }),
    send: (id: string) =>
      graphFetch<void>(instance, SEND_SCOPES, `/me/messages/${id}/send`, { method: "POST" }).then(() => {
        invalidateDrafts();
        void qc.invalidateQueries({ queryKey: ["mail", "list", "sentitems"] });
        void qc.invalidateQueries({ queryKey: ["mail", "thread"] });
      }),
    discard: (id: string) => graphFetch<void>(instance, MAIL_SCOPES, `/me/messages/${id}`, { method: "DELETE" }).then(invalidateDrafts),
    reply: (id: string, kind: "createReply" | "createReplyAll" | "createForward") => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}/${kind}`, { method: "POST", body: {} }),
    get: (id: string) => graphFetch<Message>(instance, MAIL_SCOPES, `/me/messages/${id}?$select=${LIST_SELECT},body,bccRecipients`),
    addSmallAttachment: (id: string, file: { name: string; contentType: string; contentBytes: string }) =>
      graphFetch<Attachment>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments`, { method: "POST", body: { "@odata.type": "#microsoft.graph.fileAttachment", ...file } }),
    createUploadSession: (id: string, item: { name: string; contentType: string; size: number }) =>
      graphFetch<{ uploadUrl: string }>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments/createUploadSession`, { method: "POST", body: { AttachmentItem: { attachmentType: "file", ...item } } }),
    removeAttachment: (id: string, attId: string) => graphFetch<void>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments/${attId}`, { method: "DELETE" }),
    listAttachments: (id: string) => graphFetch<Page<Attachment>>(instance, MAIL_SCOPES, `/me/messages/${id}/attachments?$select=id,name,contentType,size,isInline`).then((p) => p.value),
  };
}

// ---- Freshness -------------------------------------------------------------

// Polls the inbox delta every 45 s while the tab is visible and invalidates
// the caches when anything changed. The first call just primes the delta link.
export function useInboxDelta(enabled: boolean) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const link = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const url = link.current ?? "/me/mailFolders/inbox/messages/delta?$select=id,isRead,receivedDateTime";
        let page = await graphFetch<Page<Message>>(instance, MAIL_SCOPES, url);
        let changed = link.current ? page.value.length > 0 : false;
        while (page["@odata.nextLink"]) {
          page = await graphFetch<Page<Message>>(instance, MAIL_SCOPES, page["@odata.nextLink"]);
          changed = changed || (!!link.current && page.value.length > 0);
        }
        if (page["@odata.deltaLink"]) link.current = page["@odata.deltaLink"];
        if (changed) {
          void qc.invalidateQueries({ queryKey: ["mail", "list", "inbox"] });
          void qc.invalidateQueries({ queryKey: keys.folders });
        }
      } catch {
        // consent missing or offline: try again next tick
      }
    };
    const id = window.setInterval(tick, 45_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    void tick();
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, instance, qc]);
}
