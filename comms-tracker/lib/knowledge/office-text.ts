import { unzipSync, strFromU8 } from "fflate";

// Plain-text extraction for the file types OneDrive/SharePoint hold that
// Google Drive's export endpoint handled for us on the Google side. Office
// Open XML files are zip containers of XML; the text lives in a few known
// members, so a tag-strip is enough for summarization/search -- this is not
// a faithful document renderer. PDFs and images are out of scope (same as
// Drive v1), logged as skipped by the caller.
const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function stripXml(xml: string): string {
  let text = xml
    .replace(/<\/(w:p|a:p|p)>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "");
  for (const [e, c] of Object.entries(XML_ENTITIES)) text = text.split(e).join(c);
  return text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function docxText(files: Record<string, Uint8Array>): string {
  const parts: string[] = [];
  for (const name of Object.keys(files).sort()) {
    if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) parts.push(stripXml(strFromU8(files[name])));
  }
  return parts.join("\n\n");
}

function pptxText(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides.map((n, i) => `--- slide ${i + 1} ---\n${stripXml(strFromU8(files[n]))}`).join("\n\n");
}

function xlsxText(files: Record<string, Uint8Array>): string {
  // Shared strings hold most human-written cell text; numeric cells are
  // skipped, which is fine for a knowledge summary.
  const shared = files["xl/sharedStrings.xml"];
  if (!shared) return "";
  return Array.from(strFromU8(shared).matchAll(/<t[^>]*>([^<]*)<\/t>/g))
    .map((m) => m[1])
    .join("\n");
}

export const OFFICE_TEXT_EXTENSIONS = ["docx", "pptx", "xlsx", "txt", "md", "csv", "json", "html", "htm"];

export function extractOfficeText(fileName: string, bytes: Uint8Array, maxLen = 8000): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  let text: string | null = null;
  try {
    if (ext === "docx") text = docxText(unzip(bytes));
    else if (ext === "pptx") text = pptxText(unzip(bytes));
    else if (ext === "xlsx") text = xlsxText(unzip(bytes));
    else if (["txt", "md", "csv", "json"].includes(ext)) text = strFromU8(bytes);
    else if (["html", "htm"].includes(ext)) text = stripXml(strFromU8(bytes));
  } catch {
    return null;
  }
  if (!text) return null;
  text = text.trim();
  if (!text) return null;
  return text.length > maxLen ? Array.from(text).slice(0, maxLen).join("").trimEnd() + "…" : text;
}
