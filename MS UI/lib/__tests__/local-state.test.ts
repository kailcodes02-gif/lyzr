import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = vi.hoisted(() => ({ keys: vi.fn<() => Promise<IDBValidKey[]>>(), del: vi.fn<(k: IDBValidKey) => Promise<void>>() }));
vi.mock("idb-keyval", () => ({ keys: idb.keys, del: idb.del, get: vi.fn(), set: vi.fn() }));

import { clearDriveIndexes, clearLocalUserState } from "../local-state";
import { isMockMode, setMockMode } from "../mock";

beforeEach(() => {
  localStorage.clear();
  idb.keys.mockReset();
  idb.del.mockReset();
  idb.keys.mockResolvedValue(["msui.drive.index.acc-1", "msui.drive.index.anon", "msui.drive.index", "other.key", 42]);
  idb.del.mockResolvedValue(undefined);
});

describe("setMockMode", () => {
  it("leaving demo mode clears the flag and every msui.drive.index* IndexedDB entry", async () => {
    localStorage.setItem("msui.mock", "1");
    expect(isMockMode()).toBe(true);
    await setMockMode(false);
    expect(isMockMode()).toBe(false);
    expect(idb.del.mock.calls.map((c) => c[0]).sort()).toEqual(["msui.drive.index", "msui.drive.index.acc-1", "msui.drive.index.anon"]);
  });
  it("entering demo mode sets the flag and leaves IndexedDB alone", async () => {
    await setMockMode(true);
    expect(isMockMode()).toBe(true);
    expect(idb.keys).not.toHaveBeenCalled();
    expect(idb.del).not.toHaveBeenCalled();
  });
  it("still clears the flag when IndexedDB is unavailable", async () => {
    localStorage.setItem("msui.mock", "1");
    idb.keys.mockRejectedValue(new Error("no idb"));
    await expect(setMockMode(false)).resolves.toBeUndefined();
    expect(isMockMode()).toBe(false);
  });
});

describe("clearDriveIndexes", () => {
  it("with an account id removes only that account's index", async () => {
    await clearDriveIndexes("acc-1");
    expect(idb.del.mock.calls.map((c) => c[0])).toEqual(["msui.drive.index.acc-1"]);
  });
});

describe("clearLocalUserState", () => {
  it("removes msui.* user data but keeps device preferences and unrelated keys", () => {
    localStorage.setItem("msui.recentPeople", "[]");
    localStorage.setItem("msui.mail.images.someone@x.com", "1");
    localStorage.setItem("msui.calendar.settings", "{}");
    localStorage.setItem("msui.drive.layout", "grid");
    localStorage.setItem("msui.mock", "1");
    localStorage.setItem("msal.something", "keep");
    clearLocalUserState();
    expect(Object.keys(localStorage).sort()).toEqual(["msal.something", "msui.drive.layout", "msui.mock"]);
  });
});
