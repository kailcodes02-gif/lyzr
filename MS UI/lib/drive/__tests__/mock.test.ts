import { describe, expect, it } from "vitest";
import { handleDrive, MOCK_ROOT_ID, mockDriveFind } from "@/lib/mock/drive";
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
    const moved = call<DriveItem>("PATCH", `/me/drive/items/${made.id}`, { parentReference: { path: "/drive/root:" } });
    expect(moved.parentReference?.id).toBe(MOCK_ROOT_ID);
    expect(call("DELETE", `/me/drive/items/${made.id}`)).toBeUndefined();
    const d = call<{ value: DriveItem[] }>("GET", "/me/drive/root/delta?token=abc");
    expect(d.value.find((i) => i.id === made.id)?.["@removed"]).toBeDefined();
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
