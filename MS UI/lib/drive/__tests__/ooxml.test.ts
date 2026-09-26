import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { defaultOfficeName, NEW_OFFICE_TYPES, officeTypeFor, withOfficeExtension } from "../office";
import { blankOfficeFile, listZipParts, officeParts, type OfficeKind } from "../ooxml";

const REQUIRED: Record<OfficeKind, string[]> = {
  word: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
  excel: ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"],
  powerpoint: [
    "[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels",
    "ppt/slides/slide1.xml", "ppt/slides/_rels/slide1.xml.rels",
    "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    "ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels", "ppt/theme/theme1.xml",
  ],
};

// Every part referenced by a .rels file must exist in the package.
function relTargets(parts: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [name, xml] of Object.entries(parts)) {
    if (!name.endsWith(".rels")) continue;
    const dir = name.replace(/_rels\/[^/]+$/, "");
    for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
      const segs = `${dir}${m[1]}`.split("/");
      const resolved: string[] = [];
      for (const s of segs) if (s === "..") resolved.pop(); else if (s) resolved.push(s);
      out.push(resolved.join("/"));
    }
  }
  return out;
}

describe("blank Office packages", () => {
  for (const kind of ["word", "excel", "powerpoint"] as OfficeKind[]) {
    it(`${kind}: zip holds the required OOXML parts and fflate re-reads it`, () => {
      const bytes = blankOfficeFile(kind);
      expect(bytes.length).toBeGreaterThan(200);
      expect(bytes[0]).toBe(0x50); // "PK"
      expect(bytes[1]).toBe(0x4b);
      const names = listZipParts(bytes);
      for (const p of REQUIRED[kind]) expect(names).toContain(p);
      const files = unzipSync(bytes);
      for (const [name, u8] of Object.entries(files)) {
        const xml = strFromU8(u8);
        expect(xml.startsWith('<?xml version="1.0"'), name).toBe(true);
        expect(new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror"), name).toBeNull();
      }
    });
    it(`${kind}: every relationship target and content-type override resolves to a real part`, () => {
      const parts = officeParts(kind);
      for (const target of relTargets(parts)) expect(parts, target).toHaveProperty([target]);
      for (const m of parts["[Content_Types].xml"].matchAll(/PartName="\/([^"]+)"/g)) expect(parts).toHaveProperty([m[1]]);
    });
  }
  it("word: the main part is a document with a body", () => {
    const doc = new DOMParser().parseFromString(officeParts("word")["word/document.xml"], "application/xml");
    expect(doc.documentElement.localName).toBe("document");
    expect(doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "body")).toHaveLength(1);
    expect(officeParts("word")["_rels/.rels"]).toContain('Target="word/document.xml"');
  });
  it("excel: workbook lists Sheet1 through the workbook rels, and the sheet has sheetData", () => {
    const p = officeParts("excel");
    expect(p["xl/workbook.xml"]).toMatch(/<sheet name="Sheet1" sheetId="1" r:id="rId1"\/>/);
    expect(p["xl/_rels/workbook.xml.rels"]).toContain('Id="rId1"');
    expect(p["xl/worksheets/sheet1.xml"]).toContain("<sheetData/>");
  });
  it("powerpoint: presentation -> master -> layout <- slide, master -> theme, sizes present", () => {
    const p = officeParts("powerpoint");
    const pres = new DOMParser().parseFromString(p["ppt/presentation.xml"], "application/xml");
    const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    expect(pres.getElementsByTagNameNS(P, "sldMasterId")).toHaveLength(1);
    expect(pres.getElementsByTagNameNS(P, "sldId")).toHaveLength(1);
    expect(pres.getElementsByTagNameNS(P, "sldSz")).toHaveLength(1);
    expect(pres.getElementsByTagNameNS(P, "notesSz")).toHaveLength(1);
    expect(p["ppt/_rels/presentation.xml.rels"]).toContain("slideMasters/slideMaster1.xml");
    expect(p["ppt/_rels/presentation.xml.rels"]).toContain("slides/slide1.xml");
    expect(p["ppt/slides/_rels/slide1.xml.rels"]).toContain("slideLayout1.xml");
    expect(p["ppt/slideLayouts/_rels/slideLayout1.xml.rels"]).toContain("slideMaster1.xml");
    expect(p["ppt/slideMasters/_rels/slideMaster1.xml.rels"]).toContain("theme1.xml");
    expect(p["ppt/slideMasters/slideMaster1.xml"]).toContain("<p:sldLayoutIdLst>");
    expect(p["ppt/slideMasters/slideMaster1.xml"]).toContain("<p:clrMap ");
    expect(p["ppt/theme/theme1.xml"]).toContain("<a:clrScheme");
    expect(p["ppt/theme/theme1.xml"]).toContain("<a:fontScheme");
    expect(p["ppt/theme/theme1.xml"]).toContain("<a:fmtScheme");
  });
});

describe("new Office file names", () => {
  it("offers OneDrive's defaults with the right extension", () => {
    expect(defaultOfficeName(officeTypeFor("word"), [])).toBe("Document.docx");
    expect(defaultOfficeName(officeTypeFor("excel"), [])).toBe("Book.xlsx");
    expect(defaultOfficeName(officeTypeFor("powerpoint"), [])).toBe("Presentation.pptx");
  });
  it("adds a numeric suffix when the folder already has the name, case-insensitively", () => {
    expect(defaultOfficeName(officeTypeFor("word"), ["document.DOCX"])).toBe("Document 1.docx");
    expect(defaultOfficeName(officeTypeFor("word"), ["Document.docx", "Document 1.docx", "Other.docx"])).toBe("Document 2.docx");
    expect(defaultOfficeName(officeTypeFor("excel"), ["Book.xlsx", "Book 2.xlsx"])).toBe("Book 1.xlsx");
  });
  it("appends the extension only when the typed name lacks it", () => {
    expect(withOfficeExtension("Plan", officeTypeFor("word"))).toBe("Plan.docx");
    expect(withOfficeExtension("Plan.DOCX", officeTypeFor("word"))).toBe("Plan.DOCX");
    expect(withOfficeExtension("  Q4 deck. ", officeTypeFor("powerpoint"))).toBe("Q4 deck.pptx");
  });
  it("the menu lists Word, Excel and PowerPoint with their type colours", () => {
    expect(NEW_OFFICE_TYPES.map((t) => t.app)).toEqual(["Word", "Excel", "PowerPoint"]);
    expect(NEW_OFFICE_TYPES.every((t) => t.color.startsWith("text-"))).toBe(true);
  });
});
