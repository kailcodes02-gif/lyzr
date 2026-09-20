import { fileKind } from "@/lib/files";
import type { DriveItem } from "./types";

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
