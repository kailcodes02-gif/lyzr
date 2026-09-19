// File-type classification shared by OneDrive views and mail attachments.
export type FileKind = "folder" | "doc" | "sheet" | "slide" | "pdf" | "image" | "video" | "audio" | "archive" | "code" | "text" | "other";

const BY_EXT: Record<string, FileKind> = {
  doc: "doc", docx: "doc", docm: "doc", odt: "doc", rtf: "doc", pages: "doc",
  xls: "sheet", xlsx: "sheet", xlsm: "sheet", xlsb: "sheet", csv: "sheet", ods: "sheet", numbers: "sheet",
  ppt: "slide", pptx: "slide", pptm: "slide", odp: "slide", key: "slide",
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", svg: "image", bmp: "image", tif: "image", tiff: "image",
  mp4: "video", mov: "video", m4v: "video", webm: "video", avi: "video", mkv: "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  js: "code", ts: "code", tsx: "code", jsx: "code", py: "code", json: "code", html: "code", css: "code", sql: "code", sh: "code", yml: "code", yaml: "code",
  txt: "text", md: "text", log: "text",
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileKind(name: string, mimeType?: string | null, isFolder?: boolean): FileKind {
  if (isFolder) return "folder";
  const byExt = BY_EXT[extensionOf(name)];
  if (byExt) return byExt;
  const m = (mimeType ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel")) return "sheet";
  if (m.includes("presentation") || m.includes("powerpoint")) return "slide";
  if (m.includes("word") || m.includes("document")) return "doc";
  if (m.startsWith("text/")) return "text";
  return "other";
}

// Google-Drive-style "repo" views: label, kinds included, accent colour.
export const KIND_VIEWS: { key: string; label: string; kinds: FileKind[] }[] = [
  { key: "docs", label: "Docs", kinds: ["doc"] },
  { key: "sheets", label: "Sheets", kinds: ["sheet"] },
  { key: "slides", label: "Slides", kinds: ["slide"] },
  { key: "pdfs", label: "PDFs", kinds: ["pdf"] },
  { key: "images", label: "Images", kinds: ["image"] },
  { key: "videos", label: "Videos", kinds: ["video", "audio"] },
  { key: "folders", label: "Folders", kinds: ["folder"] },
];

export const KIND_LABEL: Record<FileKind, string> = {
  folder: "Folder", doc: "Word document", sheet: "Excel workbook", slide: "PowerPoint", pdf: "PDF", image: "Image", video: "Video",
  audio: "Audio", archive: "Archive", code: "Code", text: "Text", other: "File",
};

// Tailwind text colour classes per kind (Google Drive palette).
export const KIND_COLOR: Record<FileKind, string> = {
  folder: "text-[#5f6368]", doc: "text-[#4285f4]", sheet: "text-[#0f9d58]", slide: "text-[#f4b400]", pdf: "text-[#db4437]",
  image: "text-[#db4437]", video: "text-[#db4437]", audio: "text-[#db4437]", archive: "text-[#5f6368]", code: "text-[#5f6368]",
  text: "text-[#5f6368]", other: "text-[#5f6368]",
};

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
