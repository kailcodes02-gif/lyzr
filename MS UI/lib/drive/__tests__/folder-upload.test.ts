import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { driveSafeName, isJunkFile, planFolderUpload, relPathOf } from "../logic";
import { filesFromDropEvent, walkDirectoryHandle, walkEntries } from "../folder-pick";
import { addFailedUploads, canRetry, enqueueUploads, retryUploads, uploadErrorText, useUploads } from "../upload";
import { ensureChildFolder } from "../api";
import { backoffMs, graphFetch, GraphError, retryAfterMs } from "@/lib/graph";
import { renderHook } from "@testing-library/react";
import { handleDrive, MOCK_ROOT_ID } from "@/lib/mock/drive";
import type { DriveItem } from "../types";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

const instance = {
  getActiveAccount: () => ({ homeAccountId: "acc" }),
  getAllAccounts: () => [{ homeAccountId: "acc" }],
  acquireTokenSilent: async () => ({ accessToken: "tok" }),
} as unknown as IPublicClientApplication;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const file = (name: string, size = 3) => new File([new Uint8Array(size)], name);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("driveSafeName", () => {
  it("swaps characters OneDrive refuses and trims what it would reject", () => {
    expect(driveSafeName('What? "draft" <v2>: a|b*c')).toBe("What_ _draft_ _v2__ a_b_c");
    expect(driveSafeName("  notes . ")).toBe("notes");
    expect(driveSafeName("report.")).toBe("report");
    expect(driveSafeName("CON")).toBe("_CON");
    expect(driveSafeName("aux.txt")).toBe("_aux.txt");
    expect(driveSafeName("my_vti_file")).toBe("my_vti-file");
    expect(driveSafeName("...")).toBe("_");
    expect(driveSafeName("Plain name.docx")).toBe("Plain name.docx");
  });
  it("folds macOS decomposed accents to the composed form", () => {
    expect(driveSafeName("Cafe\u0301")).toBe("Caf\u00e9");
  });
  it("recognises OS clutter", () => {
    for (const n of [".DS_Store", "Thumbs.db", "desktop.ini", "._photo.jpg", "~$Budget.xlsx"]) expect(isJunkFile(n)).toBe(true);
    expect(isJunkFile("budget.xlsx")).toBe(false);
    expect(isJunkFile(".env")).toBe(false);
  });
});

describe("relPathOf", () => {
  it("reads the picker, drop and loose-file forms", () => {
    const a = file("x.txt");
    Object.defineProperty(a, "webkitRelativePath", { value: "Top/sub/x.txt" });
    const b = file("y.txt");
    Object.defineProperty(b, "relativePath", { value: "/Top/y.txt" });
    const c = file("z.txt");
    Object.defineProperty(c, "path", { value: "./z.txt" });
    expect(relPathOf(a)).toBe("Top/sub/x.txt");
    expect(relPathOf(b)).toBe("Top/y.txt");
    expect(relPathOf(c)).toBe("z.txt");
    expect(relPathOf(file("plain.txt"))).toBe("plain.txt");
  });
});

describe("planFolderUpload", () => {
  it("lists every folder parents-first, keeps empty ones, skips junk and cleans names", () => {
    const plan = planFolderUpload(
      [
        { file: file("a.txt"), path: "Top/a.txt" },
        { file: file("b.txt"), path: "Top/deep/er/b.txt" },
        { file: file(".DS_Store"), path: "Top/.DS_Store" },
        { file: file("c?.txt"), path: "Top/What?/c?.txt" },
      ],
      ["Top", "Top/empty", "Top/deep"]
    );
    expect(plan.dirs).toEqual(["Top", "Top/deep", "Top/empty", "Top/What_", "Top/deep/er"]);
    expect(plan.files.map((f) => [f.dir, f.name])).toEqual([
      ["Top", "a.txt"],
      ["Top/deep/er", "b.txt"],
      ["Top/What_", "c_.txt"],
    ]);
    expect(plan.skipped).toEqual(["Top/.DS_Store"]);
  });
  it("handles several dropped top folders and a lone empty folder", () => {
    expect(planFolderUpload([], ["Empty"]).dirs).toEqual(["Empty"]);
    const plan = planFolderUpload([{ file: file("1"), path: "A/1" }, { file: file("2"), path: "B/x/2" }]);
    expect(plan.dirs).toEqual(["A", "B", "B/x"]);
  });
});

describe("directory walking", () => {
  it("walks a File System Access handle, empty folders included", async () => {
    const f = (name: string) => ({ kind: "file" as const, name, getFile: async () => file(name) });
    const d = (name: string, kids: unknown[]) => ({ kind: "directory" as const, name, values: async function* () { yield* kids as never[]; } });
    const root = d("Top", [f("a.txt"), d("empty", []), d("sub", [f("b.txt")])]);
    const r = await walkDirectoryHandle(root as never);
    expect(r.dirs).toEqual(["Top", "Top/empty", "Top/sub"]);
    expect(r.entries.map((e) => e.path)).toEqual(["Top/a.txt", "Top/sub/b.txt"]);
  });
  it("walks dropped entries and keeps calling readEntries past the 100-entry batch", async () => {
    const fe = (name: string) => ({ isFile: true, isDirectory: false, name, fullPath: "", file: (ok: (x: File) => void) => ok(file(name)) });
    const big = Array.from({ length: 150 }, (_, i) => fe(`f${i}.txt`));
    const de = (name: string, kids: unknown[]) => ({
      isFile: false, isDirectory: true, name, fullPath: "",
      createReader: () => {
        let pos = 0;
        return { readEntries: (ok: (e: unknown[]) => void) => { const batch = kids.slice(pos, pos + 100); pos += batch.length; ok(batch); } };
      },
    });
    const r = await walkEntries([de("Drop", [...big, de("nothing", [])])] as never);
    expect(r.entries).toHaveLength(150);
    expect(r.dirs).toEqual(["Drop", "Drop/nothing"]);
  });
});

describe("graph transient retries (uploads only)", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("garbage")).toBeNull();
    expect(backoffMs(20)).toBeLessThanOrEqual(37_500);
  });
  it("retries a dropped connection and a 502 when retryTransient is set", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json({ id: "OK" }));
    vi.stubGlobal("fetch", fetch);
    const p = graphFetch(instance, ["Files.ReadWrite"], "/me/drive/items/P:/a.txt:/content", { method: "PUT", body: "x", retryTransient: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual({ id: "OK" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("leaves other requests as they were: no retry on a network error or a 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await expect(graphFetch(instance, ["Mail.ReadWrite"], "/me/messages/1")).rejects.toThrow(TypeError);
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: "x", message: "bad gateway" } }, 502));
    vi.stubGlobal("fetch", fetch);
    await expect(graphFetch(instance, ["Mail.ReadWrite"], "/me/messages/1")).rejects.toMatchObject({ status: 502 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("ensureChildFolder", () => {
  it("creates with conflictBehavior=fail and reuses the folder on 409", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") return json({ error: { code: "nameAlreadyExists", message: "exists" } }, 409);
      return json({ id: "EXISTING", name: "Docs", folder: { childCount: 2 } });
    }));
    const got = await ensureChildFolder(instance, "PARENT", "Docs");
    expect(got.id).toBe("EXISTING");
    expect(JSON.parse(String(calls[0].init!.body))["@microsoft.graph.conflictBehavior"]).toBe("fail");
    expect(calls[1].url).toContain("/me/drive/items/PARENT:/Docs");
  });
});

describe("upload queue", () => {
  it("uploads under the cleaned name, keeps failures retryable, and a retry finishes them", async () => {
    let fail = true;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("b.txt") && fail) return json({ error: { code: "accessDenied", message: "nope" } }, 403);
      return json({ id: url.includes("b.txt") ? "B" : "A", name: "x" }, 201);
    }));
    const created = await enqueueUploads(instance, [
      { file: file("a?.txt"), parentId: "P", name: "a_.txt" },
      { file: file("b.txt"), parentId: "P" },
    ]);
    expect(created.map((c) => c.id)).toEqual(["A"]);
    expect(urls[0]).toContain("/me/drive/items/P:/a_.txt:/content");
    fail = false;
    const again = await retryUploads(instance);
    expect(again.map((c) => c.id)).toEqual(["B"]);
  });
  it("lists files whose folder failed as errors that cannot be retried", () => {
    addFailedUploads([{ file: file("c.txt"), name: "c.txt", error: 'Folder "X" could not be created: bad' }]);
    // no File/parent kept: retry is not offered
    expect(canRetry({ id: "none", name: "c.txt", size: 3, sent: 0, status: "error", parentId: "" })).toBe(false);
  });
});

describe("mock drive behaves like OneDrive for folder uploads", () => {
  const call = <T,>(method: string, path: string, body?: unknown) => handleDrive(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;
  it("refuses invalid names, 409s on conflictBehavior=fail, finds children by path, and opens path-based upload sessions", () => {
    expect(() => call("POST", `/me/drive/items/${MOCK_ROOT_ID}/children`, { name: "What?", folder: {} })).toThrow(/invalid/);
    expect(() => call("PUT", `/me/drive/items/${MOCK_ROOT_ID}:/a%3Ab.txt:/content`, new Blob(["x"]))).toThrow(/invalid/);
    const made = call<DriveItem>("POST", `/me/drive/items/${MOCK_ROOT_ID}/children`, { name: "Upload test", folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
    expect(() => call("POST", `/me/drive/items/${MOCK_ROOT_ID}/children`, { name: "upload TEST", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })).toThrow(/exists/);
    expect(call<DriveItem>("GET", `/me/drive/items/${MOCK_ROOT_ID}:/Upload%20test`).id).toBe(made.id);
    const s = call<{ uploadUrl: string }>("POST", `/me/drive/items/${made.id}:/big.bin:/createUploadSession`, { item: { name: "big.bin" } });
    expect(s.uploadUrl).toContain(`${made.id}:/big.bin:/content`);
  });
});

describe("review fixes", () => {
  it("skips unreadable files and folders instead of abandoning the walk", async () => {
    const ok = (name: string) => ({ kind: "file" as const, name, getFile: async () => file(name) });
    const locked = { kind: "file" as const, name: "locked.pst", getFile: async () => { throw new DOMException("busy", "NotReadableError"); } };
    const badDir = { kind: "directory" as const, name: "gone", values: async function* () { throw new DOMException("gone", "NotFoundError"); } };
    const root = { kind: "directory" as const, name: "Top", values: async function* () { yield* [ok("a.txt"), locked, badDir, ok("b.txt")] as never[]; } };
    const r = await walkDirectoryHandle(root as never);
    expect(r.entries.map((e) => e.path)).toEqual(["Top/a.txt", "Top/b.txt"]);
    expect(r.failed.map((f) => f.path)).toEqual(["Top/locked.pst", "Top/gone"]);
    const dropped = await walkEntries([{ isFile: true, isDirectory: false, name: "x", fullPath: "", file: (_ok: unknown, err: (e: unknown) => void) => err(new Error("denied")) }] as never);
    expect(dropped.failed).toEqual([{ path: "x", error: "denied" }]);
  });

  it("still reads pasted files (screenshots) from the clipboard", async () => {
    const shot = file("image.png");
    const got = await filesFromDropEvent({ type: "paste", clipboardData: { files: [shot] } });
    expect(got).toEqual([shot]);
  });

  it("a small upload retried after a lost response does not leave a duplicate", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("conflictBehavior=rename")) throw new TypeError("Failed to fetch"); // saved, but the answer was lost
      if (url.includes("conflictBehavior=fail")) return json({ error: { code: "nameAlreadyExists", message: "exists" } }, 409);
      return json({ id: "SAVED", name: "r.txt", size: 3, file: {} });
    }));
    const p = enqueueUploads(instance, [{ file: file("r.txt"), parentId: "P" }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).map((c) => c.id)).toEqual(["SAVED"]);
    expect(urls.filter((u) => u.includes("conflictBehavior=rename"))).toHaveLength(1);
  });

  it("files blocked by a failed folder become retryable: Retry makes the folder, then uploads", async () => {
    let parentMade = 0;
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "F1", name: "f.txt" }, 201)));
    addFailedUploads([{ file: file("f.txt"), name: "f.txt", error: "Folder could not be created", resolveParent: async () => { parentMade++; return "NEWDIR"; } }]);
    const { result } = renderHook(() => useUploads());
    const t = result.current.find((x) => x.name === "f.txt" && x.status === "error")!;
    expect(canRetry(t)).toBe(true);
    const items = await retryUploads(instance, [t.id]);
    expect(items.map((i) => i.id)).toEqual(["F1"]);
    expect(parentMade).toBe(1);
  });

  it("explains full and busy OneDrive from Graph's status and code", () => {
    expect(uploadErrorText(new GraphError(507, "insufficientStorage", "Insufficient Space Available", "/x"))).toBe("OneDrive is full");
    expect(uploadErrorText(new GraphError(403, "quotaLimitReached", "x", "/x"))).toBe("OneDrive is full");
    expect(uploadErrorText(new GraphError(429, "activityLimitReached", "x", "/x"))).toMatch(/busy/);
    expect(uploadErrorText(new TypeError("Failed to fetch"))).toMatch(/Network error/);
  });
});
