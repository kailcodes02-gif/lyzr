"use client";

import { useMsal } from "@azure/msal-react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadItem, useItem, usePreviewUrl } from "@/lib/drive/api";
import { kindOf } from "@/lib/drive/logic";
import type { DriveItem } from "@/lib/drive/types";
import { KindIcon } from "./item-icon";

const MAX_TEXT = 1024 * 1024;

export function PreviewModal({ item, hasPrev, hasNext, onPrev, onNext, onClose, onShare }: { item: DriveItem; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void; onShare: (i: DriveItem) => void }) {
  const { instance } = useMsal();
  const kind = kindOf(item);
  const full = useItem(item.id);
  const office = kind === "doc" || kind === "sheet" || kind === "slide";
  const preview = usePreviewUrl(item.id, office);
  const url = full.data?.["@microsoft.graph.downloadUrl"];
  const [textFor, setTextFor] = useState<{ url: string; text: string } | null>(null);
  const tooLarge = (item.size ?? 0) > MAX_TEXT;
  const isText = kind === "text" || kind === "code";
  const text = tooLarge ? "This file is larger than 1 MB. Download it to read it." : textFor && textFor.url === url ? textFor.text : null;

  useEffect(() => {
    if (!url || !isText || tooLarge) return;
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((t) => !cancelled && setTextFor({ url, text: t.slice(0, MAX_TEXT) }))
      .catch(() => !cancelled && setTextFor({ url, text: "Could not load this file." }));
    return () => {
      cancelled = true;
    };
  }, [url, isText, tooLarge]);

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

  let body: React.ReactNode;
  if (full.isPending || (office && preview.isPending)) body = <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label="Loading preview" />;
  else if (full.isError) body = <p className="text-sm text-white/80">Could not load this file: {(full.error as Error).message}</p>;
  else if (kind === "image" && url) body = <img src={url} alt={item.name} className="max-h-full max-w-full object-contain" />; // eslint-disable-line @next/next/no-img-element
  else if (kind === "video" && url) body = <video src={url} controls className="max-h-full max-w-full" />;
  else if (kind === "audio" && url) body = <audio src={url} controls />;
  else if (kind === "pdf" && url) body = <iframe src={url} title={item.name} className="h-full w-full rounded-lg bg-white" />;
  else if (office && preview.data?.getUrl) body = <iframe src={preview.data.getUrl} title={item.name} className="h-full w-full rounded-lg bg-white" />;
  else if ((kind === "text" || kind === "code") && text !== null) body = <pre className="h-full w-full overflow-auto rounded-lg bg-[#1e1e1e] p-4 text-xs text-white/90">{text}</pre>;
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
