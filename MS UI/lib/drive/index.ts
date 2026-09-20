"use client";

// The local OneDrive index: one delta walk stored in IndexedDB, refreshed
// with the deltaLink. Every view (folders, type "repos", search, recent,
// people filter) is a query over this map, so navigation is instant.
import { useMsal } from "@azure/msal-react";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRAPH } from "@/lib/config";
import { graphFetch, GraphError, type Page, isConsentRequiredError } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { startPolling } from "./freshness";
import { applyDelta, childrenOf as childrenOfStore, pathOf as pathOfStore, resolveParent } from "./logic";
import type { Crumb, DriveItem, IndexStore } from "./types";

export const DRIVE_SCOPES = ["Files.ReadWrite"];
// $select limits the response to the named properties, so the facets the
// index logic relies on (root, deleted, remoteItem) must be listed too.
// cTag changes only when a file's content changes: thumbnails are keyed on
// it, so a rename or move never re-requests them.
export const SELECT = "id,name,size,file,folder,root,deleted,remoteItem,parentReference,createdBy,lastModifiedBy,lastModifiedDateTime,createdDateTime,webUrl,package,cTag";
export const DELTA_URL = `/me/drive/root/delta?$select=${SELECT}&$top=500`;
export const ROOT_ID_URL = "/me/drive/root?$select=id";

export type IndexStatus = { indexing: boolean; count: number; lastSync?: string; error?: unknown; loaded: boolean };

export type DriveIndex = {
  store: IndexStore;
  items: DriveItem[];
  byId: Record<string, DriveItem>;
  rootId: string;
  childrenOf: (id: string | null | undefined) => DriveItem[];
  pathOf: (id: string | null | undefined) => Crumb[];
  status: IndexStatus;
  refresh: () => Promise<void>;
  // Local, optimistic edits (rolled back by the caller on failure).
  patchLocal: (id: string, patch: Partial<DriveItem> | null) => void;
};

const EMPTY: IndexStore = { items: {} };

// v2: namespaced by mode so demo data never leaks into real mode (mock mode
// signs in with the same account), and older rootless stores are dropped.
export function indexKey(homeAccountId: string | undefined, mock: boolean): string {
  return `msui.drive.index.v2.${mock ? "mock" : "live"}.${homeAccountId ?? "anon"}`;
}

// A cached store is only reusable when its deltaLink is one this mode can
// send back to Graph and the root id is known.
export function isUsableStore(s: IndexStore | undefined, mock: boolean): s is IndexStore {
  if (!s || !Object.keys(s.items).length) return false;
  if (s.deltaLink && !s.rootId) return false;
  if (s.deltaLink) {
    if (!s.deltaLink.startsWith(GRAPH)) return false;
    if (!mock && /token=mock-/.test(s.deltaLink)) return false;
  }
  return true;
}

async function loadStore(key: string): Promise<IndexStore | undefined> {
  try {
    return await idbGet<IndexStore>(key);
  } catch {
    return undefined;
  }
}
async function saveStore(key: string, s: IndexStore) {
  try {
    await idbSet(key, s);
  } catch {
    // IndexedDB unavailable (private mode, tests): keep in memory only
  }
}


export function isConsentError(e: unknown): boolean {
  if (isConsentRequiredError(e)) return true;
  if (e instanceof GraphError) return e.status === 401 || e.status === 403;
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "InteractionRequiredAuthError" || name === "BrowserAuthError";
}

// A stored deltaLink Graph will not honour: 410 (resync required), 400
// (malformed token), 404. Auth and throttling are not token problems.
function isDeadDeltaLink(e: unknown): boolean {
  return e instanceof GraphError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 429;
}

export function useDriveIndex(): DriveIndex {
  const { instance, accounts } = useMsal();
  const key = indexKey(accounts[0]?.homeAccountId, isMockMode());
  // storeRef is the single source of truth; every write goes through commit,
  // so optimistic patches and delta pages compose instead of overwriting.
  const storeRef = useRef<IndexStore>(EMPTY);
  const [store, setStoreState] = useState<IndexStore>(EMPTY);
  const commit = useCallback((fn: (prev: IndexStore) => IndexStore): IndexStore => {
    const next = fn(storeRef.current);
    storeRef.current = next;
    setStoreState(next);
    return next;
  }, []);
  const [status, setStatus] = useState<IndexStatus>({ indexing: false, count: 0, loaded: false });
  const running = useRef<Promise<void> | null>(null);
  const pending = useRef(false);

  const sync = useCallback((): Promise<void> => {
    if (running.current) {
      // A walk is in flight: queue exactly one more pass after it, so a
      // mutation made mid-walk is picked up by a fresh delta.
      pending.current = true;
      return running.current;
    }
    const run = (async (): Promise<void> => {
      setStatus((st) => ({ ...st, indexing: true, error: undefined }));
      let retriedFresh = false;
      for (;;) {
        const usedStoredLink = Boolean(storeRef.current.deltaLink);
        try {
          if (!usedStoredLink && !storeRef.current.rootId) {
            const root = await graphFetch<{ id: string }>(instance, DRIVE_SCOPES, ROOT_ID_URL);
            if (root?.id) commit((s) => ({ ...s, rootId: root.id }));
          }
          let url: string | undefined = storeRef.current.deltaLink ?? DELTA_URL;
          let deltaLink: string | undefined;
          while (url) {
            const page: Page<DriveItem> = await graphFetch<Page<DriveItem>>(instance, DRIVE_SCOPES, url);
            const next = commit((s) => applyDelta(s, page.value));
            setStatus((st) => ({ ...st, count: Object.keys(next.items).length }));
            url = page["@odata.nextLink"];
            if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
          }
          const lastSync = new Date().toISOString();
          const final = commit((s) => ({ ...s, deltaLink: deltaLink ?? s.deltaLink, lastSync }));
          await saveStore(key, final);
          setStatus({ indexing: false, count: Object.keys(final.items).length, lastSync, loaded: true });
          return;
        } catch (e) {
          if (usedStoredLink && !retriedFresh && isDeadDeltaLink(e)) {
            // Stale/invalid deltaLink: one full re-enumeration from scratch.
            retriedFresh = true;
            const reset = commit(() => ({ items: {} }));
            await saveStore(key, reset);
            continue;
          }
          setStatus((st) => ({ ...st, indexing: false, loaded: true, error: e }));
          return;
        }
      }
    })().finally(() => {
      running.current = null;
      if (pending.current) {
        pending.current = false;
        void sync();
      }
    });
    running.current = run;
    return run;
  }, [instance, key, commit]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadStore(key);
      if (cancelled) return;
      if (isUsableStore(cached, isMockMode())) {
        commit(() => cached);
        setStatus({ indexing: false, count: Object.keys(cached.items).length, lastSync: cached.lastSync, loaded: true });
      } else {
        commit(() => EMPTY);
      }
      void sync();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Live: poll the delta feed while the tab is visible, refresh at once when
  // the tab comes back or the window regains focus. Not while Files.ReadWrite
  // is unapproved (every poll would fail the same way), and mock mode polls
  // at the same rate as real mode.
  const consentBlocked = Boolean(status.error) && isConsentError(status.error);
  useEffect(() => {
    if (consentBlocked) return;
    return startPolling({ run: () => sync() });
  }, [sync, consentBlocked]);

  const patchLocal = useCallback(
    (id: string, patch: Partial<DriveItem> | null) => {
      commit((s) => {
        const items = { ...s.items };
        if (patch === null) delete items[id];
        else items[id] = { ...(items[id] ?? { id, name: "" }), ...patch } as DriveItem;
        return { ...s, items };
      });
    },
    [commit]
  );

  return useMemo<DriveIndex>(
    () => ({
      store,
      items: Object.values(store.items),
      byId: store.items,
      rootId: resolveParent(store, "root"),
      childrenOf: (id) => childrenOfStore(store, id),
      pathOf: (id) => pathOfStore(store, id),
      status,
      refresh: sync,
      patchLocal,
    }),
    [store, status, sync, patchLocal]
  );
}
