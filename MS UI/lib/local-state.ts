"use client";

// Per-user state this app keeps in the browser outside MSAL's own cache:
// localStorage keys (image allowlist, recent people, calendar settings) and
// the OneDrive index in IndexedDB. Cleared on sign-out and when leaving demo
// mode, so nothing from one account or from the demo leaks into the next.
import { del, keys } from "idb-keyval";

export const LOCAL_PREFIX = "msui.";
export const DRIVE_INDEX_PREFIX = "msui.drive.index";
// Device preferences, not user data: survive sign-out.
const KEEP = new Set(["msui.mock", "msui.drive.layout"]);

// Removes the drive index for one account (`msui.drive.index.<id>`) or, with
// no id, every drive index (demo mode writes under the real account's key).
export async function clearDriveIndexes(homeAccountId?: string): Promise<void> {
  try {
    const all = await keys<IDBValidKey>();
    const prefix = homeAccountId ? `${DRIVE_INDEX_PREFIX}.${homeAccountId}` : DRIVE_INDEX_PREFIX;
    await Promise.all(all.filter((k): k is string => typeof k === "string" && k.startsWith(prefix)).map((k) => del(k)));
  } catch {
    // IndexedDB unavailable (private mode, tests): nothing was stored
  }
}

// Removes every msui.* localStorage key except device preferences.
export function clearLocalUserState(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LOCAL_PREFIX) && !KEEP.has(k))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage blocked
  }
}
