import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDrive, LATE_FILE_DELAY_MS, LATE_FILE_NAME, MOCK_ROOT_ID, mockDriveFind, mockDriveResetLateFile } from "@/lib/mock/drive";
import type { DriveItem } from "../types";

const call = <T,>(method: string, path: string, body?: unknown) => handleDrive(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;

describe("mock drive handler", () => {
  it("serves a delta walk with the root item and a deltaLink", () => {
    const d = call<{ value: DriveItem[]; "@odata.deltaLink": string }>("GET", "/me/drive/root/delta?$top=500");
    expect(d.value[0].root).toBeDefined();
    expect(d.value.length).toBeGreaterThan(60);
    expect(d["@odata.deltaLink"]).toContain("token=");
    expect(d.value.some((i) => i.name === "GSI Program")).toBe(true);
  });
  it("creates, renames, moves and deletes, and reports removals on the next delta", () => {
    const gsi = mockDriveFind("GSI Program")!;
    const made = call<DriveItem>("POST", `/me/drive/items/${gsi.id}/children`, { name: "Partner kits", folder: {} });
    expect(made.folder).toBeDefined();
    expect(made.parentReference?.id).toBe(gsi.id);
    const renamed = call<DriveItem>("PATCH", `/me/drive/items/${made.id}`, { name: "Partner kits 2026" });
    expect(renamed.name).toBe("Partner kits 2026");
    const moved = call<DriveItem>("PATCH", `/me/drive/items/${made.id}`, { parentReference: { id: MOCK_ROOT_ID } });
    expect(moved.parentReference?.id).toBe(MOCK_ROOT_ID);
    expect(call("DELETE", `/me/drive/items/${made.id}`)).toBeUndefined();
    const d = call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc");
    const tomb = d.value.find((i) => i.id === made.id)!;
    expect(tomb.deleted).toBeDefined();
    expect(tomb.name).toBeUndefined(); // OneDrive for Business sends no name on tombstones
  });
  it("stars, shares and uploads", () => {
    const deck = mockDriveFind("Lyzr x Accenture partnership deck.pptx")!;
    call("POST", `/me/drive/items/${deck.id}/follow`);
    expect(call<{ value: DriveItem[] }>("GET", "/me/drive/following").value.some((i) => i.id === deck.id)).toBe(true);
    call("POST", `/me/drive/items/${deck.id}/unfollow`);
    expect(call<{ value: DriveItem[] }>("GET", "/me/drive/following").value.some((i) => i.id === deck.id)).toBe(false);
    const link = call<{ link: { webUrl: string } }>("POST", `/me/drive/items/${deck.id}/createLink`, { type: "view", scope: "organization" });
    expect(link.link.webUrl).toContain("http");
    expect(() => call("POST", `/me/drive/items/${deck.id}/createLink`, { type: "view", scope: "anonymous" })).toThrow(/Anonymous/);
    const up = call<DriveItem>("PUT", `/me/drive/items/${MOCK_ROOT_ID}:/Notes.txt:/content`, new Blob(["hello"]));
    expect(up.name).toBe("Notes.txt");
    expect(up.size).toBe(5);
    expect(call<DriveItem>("GET", `/me/drive/items/${up.id}`)["@microsoft.graph.downloadUrl"]).toContain("data:");
  });
});

describe("mock drive: new Office files", () => {
  it("PUT of .docx / .xlsx / .pptx content creates the file in that folder with the Office mimeType and a webUrl", () => {
    const gsi = mockDriveFind("GSI Program")!;
    const docx = call<DriveItem>("PUT", `/me/drive/items/${gsi.id}:/Document.docx:/content?@microsoft.graph.conflictBehavior=rename`, new Blob(["PK"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect(docx.parentReference?.id).toBe(gsi.id);
    expect(docx.file?.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(docx.webUrl).toMatch(/^https:/);
    const xlsx = call<DriveItem>("PUT", `/me/drive/items/${MOCK_ROOT_ID}:/Book.xlsx:/content`, new Blob(["PK"]));
    expect(xlsx.file?.mimeType).toContain("spreadsheetml");
    const pptx = call<DriveItem>("PUT", `/me/drive/root:/Presentation.pptx:/content`, new Blob(["PK"]));
    expect(pptx.file?.mimeType).toContain("presentationml");
    expect(pptx.parentReference?.id).toBe(MOCK_ROOT_ID);
    // Same name again is renamed, as conflictBehavior=rename does.
    const again = call<DriveItem>("PUT", `/me/drive/items/${gsi.id}:/Document.docx:/content?@microsoft.graph.conflictBehavior=rename`, new Blob(["PK"]));
    expect(again.name).toBe("Document 1.docx");
  });
});

describe("mock drive delta honours $select like Graph", () => {
  it("strips unselected properties (root facet included) and keeps the selection in the deltaLink", () => {
    const d = call<{ value: DriveItem[]; "@odata.deltaLink": string }>("GET", "/me/drive/root/delta?$select=id,name,folder&$top=500");
    expect(d.value[0].root).toBeUndefined();
    expect(d.value[0].name).toBe("root");
    expect(d.value.every((i) => i.parentReference === undefined && i.file === undefined)).toBe(true);
    expect(d["@odata.deltaLink"]).toContain("$select=id%2Cname%2Cfolder");
  });
  it("copies into the destination folder by id and defaults to the source folder", () => {
    const deck = mockDriveFind("Lyzr x Accenture partnership deck.pptx")!;
    call("POST", `/me/drive/items/${deck.id}/copy?@microsoft.graph.conflictBehavior=rename`, { parentReference: { driveId: "b!mockdrive", id: MOCK_ROOT_ID } });
    const atRoot = call<{ value: DriveItem[] }>("GET", "/me/drive/root/children").value;
    expect(atRoot.some((i) => i.name === deck.name)).toBe(true);
  });
});

describe("mock drive live refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockDriveResetLateFile();
  });
  it("reports a file added in OneDrive only on a delta walked 20 s after the first one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
    mockDriveResetLateFile();
    const first = call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?$top=500");
    expect(first.value.some((i) => i.name === LATE_FILE_NAME)).toBe(false);
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z").getTime() + LATE_FILE_DELAY_MS - 1);
    expect(call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc").value.some((i) => i.name === LATE_FILE_NAME)).toBe(false);
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z").getTime() + LATE_FILE_DELAY_MS);
    const late = call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc").value.find((i) => i.name === LATE_FILE_NAME);
    expect(late).toBeDefined();
    expect(late?.parentReference?.id).toBe(mockDriveFind("GSI Program")!.id);
    expect(late?.createdBy?.user?.displayName).toBe("Siva Surendira");
    // Added once, and still mutable like any other item.
    expect(call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc").value.filter((i) => i.name === LATE_FILE_NAME)).toHaveLength(1);
    expect(call("DELETE", `/me/drive/items/${late!.id}`)).toBeUndefined();
    expect(call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc").value.find((i) => i.id === late!.id)?.deleted).toBeDefined();
  });
});
