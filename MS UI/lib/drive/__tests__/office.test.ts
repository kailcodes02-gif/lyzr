import { describe, expect, it } from "vitest";
import { officeAppFor, officeDesktopUrl } from "../office";

describe("officeAppFor", () => {
  it("maps Office files to their app and leaves the rest to the preview", () => {
    expect(officeAppFor({ name: "Deck.pptx" })?.name).toBe("PowerPoint");
    expect(officeAppFor({ name: "Plan.xlsx" })?.name).toBe("Excel");
    expect(officeAppFor({ name: "Notes.docx" })?.name).toBe("Word");
    expect(officeAppFor({ name: "scan.pdf" })).toBeNull();
    expect(officeAppFor({ name: "photo.png" })).toBeNull();
    expect(officeAppFor({ name: "Deck.pptx", folder: {} })).toBeNull();
  });
  it("builds the Office desktop URI", () => {
    expect(officeDesktopUrl({ name: "PowerPoint", scheme: "ms-powerpoint" }, "https://x/y.pptx")).toBe("ms-powerpoint:ofe|u|https://x/y.pptx");
  });
});
