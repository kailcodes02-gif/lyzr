"use client";

import { useMsal } from "@azure/msal-react";
import { FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Folder, Presentation, File as FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KIND_COLOR, type FileKind } from "@/lib/files";
import { fetchThumbnail } from "@/lib/drive/api";
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
const cache = new Map<string, string | null>();

// Grid tile preview: a lazily fetched thumbnail (IntersectionObserver) for
// media and Office files, a big kind icon otherwise.
export function Thumbnail({ item }: { item: DriveItem }) {
  const { instance } = useMsal();
  const kind = kindOf(item);
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null | undefined>(cache.get(item.id));

  useEffect(() => {
    if (!THUMB_KINDS.includes(kind) || cache.has(item.id) || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void fetchThumbnail(instance, item.id).then((u) => {
        cache.set(item.id, u);
        setUrl(u);
      });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [instance, item.id, kind]);

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
