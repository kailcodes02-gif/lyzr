"use client";

import { useMsal } from "@azure/msal-react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadItem, fetchContent, useItem, usePreviewUrl } from "@/lib/drive/api";
import { kindOf } from "@/lib/drive/logic";
import type { DriveItem } from "@/lib/drive/types";
import { KindIcon } from "./item-icon";

const MAX_TEXT = 1024 * 1024;

type Loaded = { url: string; text?: string; objectUrl?: string; error?: string };

// PDFs and text are fetched from the pre-authenticated downloadUrl into a
// Blob and shown through an object URL: OneDrive for Business serves the
// downloadUrl with an attachment disposition, so an <iframe> pointed at it
// downloads the file instead of rendering it.
function useContent(url: string | undefined, mode: "pdf" | "text" | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!url || !mode) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    fetchContent(url)
      .then(async (blob) => {
        if (cancelled) return;
        if (mode === "text") setLoaded({ url, text: (await blob.text()).slice(0, MAX_TEXT) });
        else {
          objectUrl = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
          setLoaded({ url, objectUrl });
        }
      })
      .catch(() => !cancelled && setLoaded({ url, error: "Could not load this file." }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, mode]);
  return loaded && loaded.url === url ? loaded : null;
}

export function PreviewModal({ item, hasPrev, hasNext, onPrev, onNext, onClose, onShare }: { item: DriveItem; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void; onShare: (i: DriveItem) => void }) {
  const { instance } = useMsal();
  const kind = kindOf(item);
  const full = useItem(item.id);
  const office = kind === "doc" || kind === "sheet" || kind === "slide";
  const url = full.data?.["@microsoft.graph.downloadUrl"];
  const tooLarge = (item.size ?? 0) > MAX_TEXT;
  const isText = kind === "text" || kind === "code";
  const mode = tooLarge ? null : kind === "pdf" ? "pdf" : isText ? "text" : null;
  const content = useContent(url, mode);
  // Office files embed through the preview action; a PDF whose bytes could
  // not be fetched falls back to the same embeddable getUrl.
  const preview = usePreviewUrl(item.id, office || (kind === "pdf" && Boolean(content?.error)));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const fallback = (
    <div className="flex flex-col items-center gap-4 text-white/80">
      <KindIcon kind={kind} className="h-20 w-20" />
      <p className="text-sm">No preview available for this file.</p>
      {item.webUrl && (
        <Button variant="outline" className="rounded-full" render={<a href={item.webUrl} target="_blank" rel="noopener noreferrer" />}>Open in OneDrive</Button>
      )}
    </div>
  );
  const spinner = <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label="Loading preview" />;

  let body: React.ReactNode;
  if (full.isPending || (office && preview.isPending)) body = spinner;
  else if (full.isError) body = <p className="text-sm text-white/80">Could not load this file: {(full.error as Error).message}</p>;
  else if (kind === "image" && url) body = <img src={url} alt={item.name} className="max-h-full max-w-full object-contain" />; // eslint-disable-line @next/next/no-img-element
  else if (kind === "video" && url) body = <video src={url} controls className="max-h-full max-w-full" />;
  else if (kind === "audio" && url) body = <audio src={url} controls />;
  else if (mode === "pdf" && url && !content) body = spinner;
  else if (mode === "pdf" && content?.objectUrl) body = <iframe src={content.objectUrl} title={item.name} className="h-full w-full rounded-lg bg-white" />;
  else if (mode === "pdf" && content?.error && preview.data?.getUrl) body = <iframe src={preview.data.getUrl} title={item.name} className="h-full w-full rounded-lg bg-white" />;
  else if (mode === "pdf" && content?.error && preview.isPending) body = spinner;
  else if (office && preview.data?.getUrl) body = <iframe src={preview.data.getUrl} title={item.name} className="h-full w-full rounded-lg bg-white" />;
  else if (isText && tooLarge) body = <pre className="h-full w-full overflow-auto rounded-lg bg-[#1e1e1e] p-4 text-xs text-white/90">This file is larger than 1 MB. Download it to read it.</pre>;
  else if (mode === "text" && url && !content) body = spinner;
  else if (mode === "text" && content) body = <pre className="h-full w-full overflow-auto rounded-lg bg-[#1e1e1e] p-4 text-xs text-white/90">{content.error ?? content.text}</pre>;
  else body = fallback;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" role="dialog" aria-modal="true" aria-label={`Preview of ${item.name}`}>
      <header className="flex items-center gap-2 px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Close preview" onClick={onClose} className="text-white hover:bg-white/10 hover:text-white"><X /></Button>
        <KindIcon kind={kind} className="h-5 w-5" />
        <h2 className="min-w-0 flex-1 truncate text-sm">{item.name}</h2>
        <Button variant="ghost" size="icon" aria-label="Download" onClick={() => downloadItem(instance, item.id, item.name)} className="text-white hover:bg-white/10 hover:text-white"><Download /></Button>
        <Button variant="ghost" size="icon" aria-label="Share" onClick={() => onShare(item)} className="text-white hover:bg-white/10 hover:text-white"><Share2 /></Button>
        {item.webUrl && (
          <Button variant="ghost" size="icon" aria-label="Open in OneDrive" className="text-white hover:bg-white/10 hover:text-white" render={<a href={item.webUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink /></Button>
        )}
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4 md:px-16">
        {hasPrev && (
          <button type="button" aria-label="Previous" onClick={onPrev} className="absolute left-3 rounded-full bg-white/10 p-2 hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>
        )}
        <div className="flex h-full w-full max-w-6xl items-center justify-center">{body}</div>
        {hasNext && (
          <button type="button" aria-label="Next" onClick={onNext} className="absolute right-3 rounded-full bg-white/10 p-2 hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>
    </div>
  );
}
