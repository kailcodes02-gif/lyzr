"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { frameDocument, sanitizeEmailHtml, textToHtml } from "@/lib/mail/sanitize";
import type { ItemBody } from "@/lib/mail/types";
import { Button } from "@/components/ui/button";
import { ImageOff } from "lucide-react";

// Sanitised email body in a sandboxed iframe that grows to its content.
export function EmailFrame({ body, cidMap, senderKey }: { body?: ItemBody; cidMap?: Record<string, string>; senderKey?: string }) {
  const [allowImages, setAllowImages] = useState<boolean>(() => {
    try {
      return !!senderKey && localStorage.getItem(`msui.mail.images.${senderKey}`) === "1";
    } catch {
      return false;
    }
  });
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const result = useMemo(() => {
    const html = body?.contentType === "text" ? textToHtml(body.content) : (body?.content ?? "");
    return sanitizeEmailHtml(html, { allowRemoteImages: allowImages, cidMap });
  }, [body, allowImages, cidMap]);

  const srcDoc = useMemo(() => frameDocument(result.html, allowImages), [result.html, allowImages]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let raf = 0;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      if (h > 0) setHeight(Math.min(h + 8, 20000));
    };
    const onLoad = () => {
      measure();
      raf = window.requestAnimationFrame(measure);
      window.setTimeout(measure, 300);
      window.setTimeout(measure, 1200);
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      window.cancelAnimationFrame(raf);
    };
  }, [srcDoc]);

  const allow = (remember: boolean) => {
    setAllowImages(true);
    if (remember && senderKey) {
      try {
        localStorage.setItem(`msui.mail.images.${senderKey}`, "1");
      } catch {
        // storage blocked
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {result.hasRemoteImages && !allowImages && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" />
          <span>Images in this message are hidden.</span>
          <Button variant="link" size="xs" onClick={() => allow(false)}>
            Show images
          </Button>
          {senderKey && (
            <Button variant="link" size="xs" onClick={() => allow(true)}>
              Always show from this sender
            </Button>
          )}
        </div>
      )}
      <iframe
        ref={ref}
        title="Message body"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height }}
        className="w-full border-0 bg-white"
      />
    </div>
  );
}
