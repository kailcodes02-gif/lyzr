import DOMPurify from "dompurify";

export type SanitizeOptions = {
  allowRemoteImages?: boolean;
  // contentId (without "cid:") -> object/data URL
  cidMap?: Record<string, string>;
};

export type SanitizeResult = { html: string; blockedImages: number; hasRemoteImages: boolean };

const FORBID_TAGS = ["script", "style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base", "svg", "math"];
const FORBID_ATTR = ["onerror", "onload", "onclick", "onmouseover", "formaction", "srcdoc"];

const REMOTE = /^\s*(https?:)?\/\//i;

// Sanitises email HTML for a sandboxed iframe: scripts, forms and event
// handlers are removed, inline styles are kept, remote images are turned into
// data-src until the reader opts in, cid: images are swapped for attachment URLs.
export function sanitizeEmailHtml(input: string, opts: SanitizeOptions = {}): SanitizeResult {
  const purified = DOMPurify.sanitize(input ?? "", {
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: true,
    WHOLE_DOCUMENT: false,
    ADD_ATTR: ["target"],
  });
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${purified}</body></html>`, "text/html");
  let blocked = 0;
  let hasRemote = false;
  const cidMap = opts.cidMap ?? {};
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
    if (/^cid:/i.test(src)) {
      const id = src.slice(4).replace(/^<|>$/g, "");
      const url = cidMap[id];
      if (url) {
        img.setAttribute("src", url);
        img.removeAttribute("data-src");
      } else {
        img.removeAttribute("src");
        img.setAttribute("data-src", src);
        img.setAttribute("alt", img.getAttribute("alt") || "Inline image");
      }
      return;
    }
    if (REMOTE.test(src)) {
      hasRemote = true;
      if (opts.allowRemoteImages) {
        img.setAttribute("src", src);
        img.removeAttribute("data-src");
      } else {
        blocked++;
        img.removeAttribute("src");
        img.setAttribute("data-src", src);
        img.setAttribute("alt", img.getAttribute("alt") || "Image blocked");
      }
    }
  });
  // Remote backgrounds in inline styles leak the reader's IP the same way.
  if (!opts.allowRemoteImages) {
    doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const style = el.getAttribute("style") ?? "";
      if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(style)) {
        hasRemote = true;
        blocked++;
        el.setAttribute("style", style.replace(/url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, "none"));
      }
    });
    doc.querySelectorAll("[background]").forEach((el) => {
      if (REMOTE.test(el.getAttribute("background") ?? "")) {
        hasRemote = true;
        blocked++;
        el.removeAttribute("background");
      }
    });
  }
  doc.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return { html: doc.body.innerHTML, blockedImages: blocked, hasRemoteImages: hasRemote };
}

export const FRAME_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; }
  body { font: 14px/1.5 "Google Sans", Roboto, Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #202124; word-wrap: break-word; overflow-wrap: anywhere; padding: 4px 0 8px; }
  img { max-width: 100%; height: auto; }
  img[data-src] { min-width: 24px; min-height: 24px; background: #f1f3f4; border: 1px dashed #dadce0; }
  pre { white-space: pre-wrap; }
  blockquote { margin: 0 0 0 8px; padding-left: 12px; border-left: 2px solid #dadce0; color: #5f6368; }
  a { color: #1a73e8; }
  table { max-width: 100%; }
`;

// Full document for iframe srcDoc. A meta CSP blocks anything that slipped
// through: no scripts, no remote fetches except images when allowed.
export function frameDocument(bodyHtml: string, allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? "img-src * data: blob:;" : "img-src data: blob:;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${img} style-src 'unsafe-inline'; font-src data:;"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

// Plain text body -> minimal HTML.
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap">${esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`;
}
