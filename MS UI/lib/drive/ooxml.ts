// Blank Office files built in the browser, the way OneDrive's own "New"
// menu does it: a minimal but spec-valid OOXML package per app, zipped with
// fflate and PUT to Graph as the file's content. Part sets follow the Open
// XML SDK "create a document by providing a file name" samples on
// learn.microsoft.com (word / spreadsheet / presentation).
import { strToU8, unzipSync, zipSync } from "fflate";

export type OfficeKind = "word" | "excel" | "powerpoint";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

const rels = (list: { id: string; type: string; target: string }[]) =>
  `${XML}<Relationships xmlns="${PKG_REL}">${list.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"/>`).join("")}</Relationships>`;
const contentTypes = (overrides: { part: string; type: string }[]) =>
  `${XML}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides
    .map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`)
    .join("")}</Types>`;

const OFFICE_DOC = "officeDocument";

// --- Word: [Content_Types].xml, _rels/.rels, word/document.xml ---------------
function wordParts(): Record<string, string> {
  return {
    "[Content_Types].xml": contentTypes([{ part: "/word/document.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" }]),
    "_rels/.rels": rels([{ id: "rId1", type: OFFICE_DOC, target: "word/document.xml" }]),
    "word/document.xml": `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}

// --- Excel: workbook + one empty worksheet -----------------------------------
function excelParts(): Record<string, string> {
  return {
    "[Content_Types].xml": contentTypes([
      { part: "/xl/workbook.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" },
      { part: "/xl/worksheets/sheet1.xml", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" },
    ]),
    "_rels/.rels": rels([{ id: "rId1", type: OFFICE_DOC, target: "xl/workbook.xml" }]),
    "xl/workbook.xml": `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([{ id: "rId1", type: "worksheet", target: "worksheets/sheet1.xml" }]),
    "xl/worksheets/sheet1.xml": `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
  };
}

// --- PowerPoint: presentation, one slide, its layout, the master, a theme ----
const spTree = (name: string, ph: string, extraPara = "") =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${extraPara}</a:p></p:txBody></p:sp></p:spTree></p:cSld>`;

const THEME = `${XML}<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

function powerpointParts(): Record<string, string> {
  const ns = `xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"`;
  return {
    "[Content_Types].xml": contentTypes([
      { part: "/ppt/presentation.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" },
      { part: "/ppt/slides/slide1.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml" },
      { part: "/ppt/slideLayouts/slideLayout1.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml" },
      { part: "/ppt/slideMasters/slideMaster1.xml", type: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml" },
      { part: "/ppt/theme/theme1.xml", type: "application/vnd.openxmlformats-officedocument.theme+xml" },
    ]),
    "_rels/.rels": rels([{ id: "rId1", type: OFFICE_DOC, target: "ppt/presentation.xml" }]),
    "ppt/presentation.xml": `${XML}<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([
      { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
      { id: "rId2", type: "slide", target: "slides/slide1.xml" },
      { id: "rId3", type: "theme", target: "theme/theme1.xml" },
    ]),
    "ppt/slides/slide1.xml": `${XML}<p:sld ${ns}>${spTree("Title 1", ' type="title"', '<a:endParaRPr lang="en-US"/>')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels([{ id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" }]),
    "ppt/slideLayouts/slideLayout1.xml": `${XML}<p:sldLayout ${ns} type="title" preserve="1">${spTree("Title 1", ' type="ctrTitle"', "<a:endParaRPr/>")}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
    "ppt/slideMasters/slideMaster1.xml": `${XML}<p:sldMaster ${ns}>${spTree("Title Placeholder 1", ' type="title"')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
    "ppt/theme/theme1.xml": THEME,
  };
}

export function officeParts(kind: OfficeKind): Record<string, string> {
  return kind === "word" ? wordParts() : kind === "excel" ? excelParts() : powerpointParts();
}

// The zip bytes of a blank file of the given kind. [Content_Types].xml goes
// first, as Office writes it; deflate on every entry.
export function blankOfficeFile(kind: OfficeKind): Uint8Array {
  const parts = officeParts(kind);
  const entries: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(parts)) entries[name] = strToU8(xml);
  return zipSync(entries, { level: 6 });
}

// Test/verification helper: part names inside a package built above.
export function listZipParts(bytes: Uint8Array): string[] {
  return Object.keys(unzipSync(bytes));
}
