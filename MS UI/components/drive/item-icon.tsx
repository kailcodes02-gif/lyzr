"use client";

import { useMsal } from "@azure/msal-react";
import { FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Folder, Presentation, File as FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KIND_COLOR, type FileKind } from "@/lib/files";
import { fetchThumbnail } from "@/lib/drive/api";
import { THUMBNAIL_TTL_MS } from "@/lib/drive/freshness";
import { kindOf } from "@/lib/drive/logic";
import type { DriveItem } from "@/lib/drive/types";
import { cn } from "@/lib/utils";

const ICON: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  folder: Folder, doc: FileText, sheet: FileSpreadsheet, slide: Presentation, pdf: FileType, image: FileImage, video: FileVideo,
  audio: FileAudio, archive: FileArchive, code: FileCode, text: FileText, other: FileIcon,
};

export function KindIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const I = ICON[kind];
  return <I className={cn("shrink-0", KIND_COLOR[kind], kind === "folder" && "fill-current", className)} />;
}

const THUMB_KINDS: FileKind[] = ["image", "video", "pdf", "doc", "sheet", "slide"];
type Cached = { url: string | null; cTag?: string; at: number };
const cache = new Map<string, Cached>();

export function rememberThumbnail(id: string, url: string | null, cTag: string | undefined, at = Date.now()) {
  cache.set(id, { url, cTag, at });
}

// A cached thumbnail is reused after a rename or move (same id, same
// content) and re-requested only when the content changed (new cTag) or
// the pre-authenticated url is about to expire.
export function cachedThumbnail(id: string, cTag: string | undefined, now = Date.now()): string | null | undefined {
  const c = cache.get(id);
  if (!c) return undefined;
  if (c.cTag !== cTag || now - c.at > THUMBNAIL_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return c.url;
}

// Grid tile preview: a lazily fetched thumbnail (IntersectionObserver) for
// media and Office files, a big kind icon otherwise.
export function Thumbnail({ item }: { item: DriveItem }) {
  const { instance } = useMsal();
  const kind = kindOf(item);
  const ref = useRef<HTMLDivElement>(null);
  // Keyed on id + content tag: a rename or move keeps the key (and the
  // cached url); a new content version resets it during render.
  const key = `${item.id}|${item.cTag ?? ""}`;
  const [state, setState] = useState<{ key: string; url: string | null | undefined }>(() => ({ key, url: cachedThumbnail(item.id, item.cTag) }));
  if (state.key !== key) setState({ key, url: cachedThumbnail(item.id, item.cTag) });
  const url = state.key === key ? state.url : cachedThumbnail(item.id, item.cTag);

  useEffect(() => {
    if (!THUMB_KINDS.includes(kind) || url !== undefined || !ref.current) return;
    const el = ref.current;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void fetchThumbnail(instance, item.id).then((u) => {
        rememberThumbnail(item.id, u, item.cTag);
        if (!cancelled) setState({ key, url: u });
      });
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [instance, item.id, item.cTag, kind, key, url]);

  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center overflow-hidden bg-muted/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <KindIcon kind={kind} className="h-12 w-12" />
      )}
    </div>
  );
}
