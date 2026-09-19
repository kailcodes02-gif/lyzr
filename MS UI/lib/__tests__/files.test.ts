import { describe, expect, it } from "vitest";
import { fileKind, formatBytes, extensionOf } from "../files";

describe("fileKind", () => {
  it("classifies by extension first", () => {
    expect(fileKind("Q3 plan.xlsx")).toBe("sheet");
    expect(fileKind("deck.PPTX")).toBe("slide");
    expect(fileKind("notes.docx")).toBe("doc");
    expect(fileKind("scan.pdf")).toBe("pdf");
    expect(fileKind("photo.HEIC")).toBe("image");
  });
  it("falls back to mime type, then other", () => {
    expect(fileKind("noext", "image/png")).toBe("image");
    expect(fileKind("noext", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("sheet");
    expect(fileKind("noext", null)).toBe("other");
  });
  it("folders win", () => {
    expect(fileKind("archive.zip", null, true)).toBe("folder");
  });
  it("extensionOf handles dotfiles and no dot", () => {
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf("README")).toBe("");
  });
});

describe("formatBytes", () => {
  it("formats", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(null)).toBe("");
  });
});
