import { fileKind, KIND_COLOR, type FileKind } from "@/lib/files";
import type { DriveItem } from "./types";
import type { OfficeKind } from "./ooxml";

export type OfficeApp = { name: "Word" | "Excel" | "PowerPoint"; scheme: "ms-word" | "ms-excel" | "ms-powerpoint" };

// Office files open in their own app, like Drive opens a Slides file in
// Slides. Everything else (images, PDFs, video, text) previews in place.
export function officeAppFor(item: Pick<DriveItem, "name" | "file" | "folder">): OfficeApp | null {
  if (item.folder) return null;
  const kind = fileKind(item.name, item.file?.mimeType ?? null, false);
  if (kind === "doc") return { name: "Word", scheme: "ms-word" };
  if (kind === "sheet") return { name: "Excel", scheme: "ms-excel" };
  if (kind === "slide") return { name: "PowerPoint", scheme: "ms-powerpoint" };
  return null;
}

// Office URI scheme: opens the file for editing in the installed desktop app
// (falls through to nothing if the app is not installed).
export function officeDesktopUrl(app: OfficeApp, webUrl: string): string {
  return `${app.scheme}:ofe|u|${webUrl}`;
}

// The "New" menu's Office entries: what OneDrive itself offers, with its
// default names ("Document", "Book", "Presentation").
export type NewOfficeType = { kind: OfficeKind; app: OfficeApp["name"]; label: string; ext: "docx" | "xlsx" | "pptx"; mime: string; defaultName: string; fileKind: FileKind; color: string };
export const NEW_OFFICE_TYPES: NewOfficeType[] = [
  { kind: "word", app: "Word", label: "Word document", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", defaultName: "Document", fileKind: "doc", color: KIND_COLOR.doc },
  { kind: "excel", app: "Excel", label: "Excel workbook", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", defaultName: "Book", fileKind: "sheet", color: KIND_COLOR.sheet },
  { kind: "powerpoint", app: "PowerPoint", label: "PowerPoint presentation", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", defaultName: "Presentation", fileKind: "slide", color: KIND_COLOR.slide },
];
export const officeTypeFor = (kind: OfficeKind): NewOfficeType => NEW_OFFICE_TYPES.find((t) => t.kind === kind)!;

// "Document.docx", or "Document 1.docx" ... when the folder already has one
// (case-insensitive, like OneDrive).
export function defaultOfficeName(type: NewOfficeType, siblingNames: Iterable<string>): string {
  const taken = new Set(Array.from(siblingNames, (n) => n.toLowerCase()));
  const full = (base: string) => `${base}.${type.ext}`;
  if (!taken.has(full(type.defaultName).toLowerCase())) return full(type.defaultName);
  for (let n = 1; ; n++) {
    const candidate = full(`${type.defaultName} ${n}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// The name the user typed, with the extension added when missing so Graph
// stores an Office file and not an extensionless blob.
export function withOfficeExtension(name: string, type: NewOfficeType): string {
  const trimmed = name.trim().replace(/\.+$/, "");
  return trimmed.toLowerCase().endsWith(`.${type.ext}`) ? trimmed : `${trimmed}.${type.ext}`;
}
