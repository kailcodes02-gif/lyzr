"use client";

// The local OneDrive index: one delta walk stored in IndexedDB, refreshed
// with the deltaLink. Every view (folders, type "repos", search, recent,
// people filter) is a query over this map, so navigation is instant.
import { useMsal } from "@azure/msal-react";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { graphFetch, GraphError, type Page } from "@/lib/graph";
import { applyDelta, childrenOf as childrenOfStore, pathOf as pathOfStore, resolveParent } from "./logic";
import type { Crumb, DriveItem, IndexStore } from "./types";

export const DRIVE_SCOPES = ["Files.ReadWrite"];
const SELECT = "id,name,size,file,folder,parentReference,createdBy,lastModifiedBy,lastModifiedDateTime,createdDateTime,webUrl,package";
export const DELTA_URL = `/me/drive/root/delta?$select=${SELECT}&$top=500`;

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

async function loadStore(key: string): Promise<IndexStore> {
  try {
    return (await idbGet<IndexStore>(key)) ?? EMPTY;
  } catch {
    return EMPTY;
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
  if (e instanceof GraphError) return e.status === 401 || e.status === 403;
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "InteractionRequiredAuthError" || name === "BrowserAuthError";
}

export function useDriveIndex(): DriveIndex {
  const { instance, accounts } = useMsal();
  const key = `msui.drive.index.${accounts[0]?.homeAccountId ?? "anon"}`;
  const [store, setStore] = useState<IndexStore>(EMPTY);
  const [status, setStatus] = useState<IndexStatus>({ indexing: false, count: 0, loaded: false });
  const storeRef = useRef(store);
  storeRef.current = store;
  const running = useRef<Promise<void> | null>(null);

  const sync = useCallback(async (): Promise<void> => {
    if (running.current) return running.current;
    const run: Promise<void> = (async (): Promise<void> => {
      let s = storeRef.current;
      setStatus((st) => ({ ...st, indexing: true, error: undefined }));
      try {
        let url: string | undefined = s.deltaLink ?? DELTA_URL;
        let deltaLink: string | undefined;
        while (url) {
          const page: Page<DriveItem> = await graphFetch<Page<DriveItem>>(instance, DRIVE_SCOPES, url);
          s = applyDelta(s, page.value);
          setStore(s);
          setStatus((st) => ({ ...st, count: Object.keys(s.items).length }));
          url = page["@odata.nextLink"];
          if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
        }
        s = { ...s, deltaLink: deltaLink ?? s.deltaLink, lastSync: new Date().toISOString() };
        setStore(s);
        await saveStore(key, s);
        setStatus({ indexing: false, count: Object.keys(s.items).length, lastSync: s.lastSync, loaded: true });
      } catch (e) {
        // A stale/invalid deltaLink (410 resyncRequired) restarts from scratch.
        if (e instanceof GraphError && e.status === 410 && s.deltaLink) {
          s = { items: {} };
          setStore(s);
          running.current = null;
          return sync();
        }
        setStatus((st) => ({ ...st, indexing: false, loaded: true, error: e }));
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, [instance, key]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadStore(key);
      if (cancelled) return;
      if (Object.keys(cached.items).length) {
        setStore(cached);
        setStatus({ indexing: false, count: Object.keys(cached.items).length, lastSync: cached.lastSync, loaded: true });
      }
      void sync();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const patchLocal = useCallback((id: string, patch: Partial<DriveItem> | null) => {
    setStore((s) => {
      const items = { ...s.items };
      if (patch === null) delete items[id];
      else items[id] = { ...(items[id] ?? { id, name: "" }), ...patch } as DriveItem;
      return { ...s, items };
    });
  }, []);

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
