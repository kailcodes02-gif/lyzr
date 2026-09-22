// Print view for a conversation or one message: a self-contained document
// (no scripts, a meta CSP, a print stylesheet) built from already-sanitised
// body HTML, loaded into a hidden same-origin iframe and printed from there.
// The on-screen reader keeps its sandboxed frame; this document is only
// ever handed to window.print().
import { sanitizeEmailHtml, textToHtml } from "./sanitize";
import type { Attachment, ItemBody, Message, Recipient } from "./types";

export type PrintMessage = {
  from: string;
  to: string;
  cc?: string;
  date: string;
  bodyHtml: string; // sanitised
  attachments: { name: string; size?: number }[];
};

export type PrintDocument = { subject: string; messages: PrintMessage[]; account?: string };

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const PRINT_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 13px/1.5 Roboto, Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #202124; padding: 24px; word-wrap: break-word; overflow-wrap: anywhere; }
  header.doc { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #dadce0; padding-bottom: 8px; margin-bottom: 16px; }
  header.doc h1 { font-size: 20px; font-weight: 400; margin: 0; }
  header.doc .account { font-size: 12px; color: #5f6368; }
  article { page-break-inside: avoid; border-bottom: 1px solid #dadce0; padding: 12px 0 16px; }
  article:last-child { border-bottom: 0; }
  article h2 { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
  .meta { font-size: 12px; color: #5f6368; margin: 0 0 12px; }
  .meta div { margin: 1px 0; }
  .meta b { color: #202124; font-weight: 600; display: inline-block; min-width: 38px; }
  .body img { max-width: 100%; height: auto; }
  .body pre { white-space: pre-wrap; }
  .body blockquote { margin: 0 0 0 8px; padding-left: 12px; border-left: 2px solid #dadce0; color: #5f6368; }
  .body a { color: #1a73e8; text-decoration: none; }
  .body table { max-width: 100%; }
  .attachments { margin-top: 12px; font-size: 12px; color: #5f6368; }
  .attachments ul { margin: 4px 0 0; padding-left: 18px; }
  @page { margin: 16mm; }
  @media print { body { padding: 0; } a[href]::after { content: none; } }
`;

export function fmtAttachmentSize(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// The full print document. Header fields are escaped; bodyHtml must already
// be sanitised (sanitizeEmailHtml). The CSP allows inline styles and images
// (remote included, since the reader asked to print the message) and nothing else.
export function buildPrintDocument(doc: PrintDocument): string {
  const subject = escapeHtml(doc.subject || "(no subject)");
  const articles = doc.messages
    .map((m, i) => {
      const meta = [`<div><b>From</b> ${escapeHtml(m.from)}</div>`, `<div><b>To</b> ${escapeHtml(m.to || "me")}</div>`, m.cc ? `<div><b>Cc</b> ${escapeHtml(m.cc)}</div>` : "", `<div><b>Date</b> ${escapeHtml(m.date)}</div>`].filter(Boolean).join("");
      const atts = m.attachments.length
        ? `<div class="attachments">${m.attachments.length} ${m.attachments.length === 1 ? "attachment" : "attachments"}<ul>${m.attachments.map((a) => `<li>${escapeHtml(a.name)}${a.size ? ` (${fmtAttachmentSize(a.size)})` : ""}</li>`).join("")}</ul></div>`
        : "";
      return `<article data-message="${i + 1}"><h2>${escapeHtml(m.from)}</h2><div class="meta">${meta}</div><div class="body">${m.bodyHtml}</div>${atts}</article>`;
    })
    .join("");
  const account = doc.account ? `<span class="account">${escapeHtml(doc.account)}</span>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; font-src data:;"><title>${subject}</title><style>${PRINT_CSS}</style></head><body><header class="doc"><h1>${subject}</h1>${account}</header>${articles}</body></html>`;
}

const label = (list?: Recipient[]) => (list ?? []).map((r) => (r.emailAddress.name && r.emailAddress.address ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress.name || r.emailAddress.address || "")).filter(Boolean).join(", ");

// A Graph message (with body) as a print entry. cid: images are swapped for
// the given data/blob URLs; remote images are allowed in print.
export function printMessageOf(m: Message, attachments: Attachment[] = [], cidMap: Record<string, string> = {}, formatDate: (iso?: string) => string = (iso) => iso ?? ""): PrintMessage {
  const body: ItemBody | undefined = m.body;
  const raw = body?.contentType === "text" ? textToHtml(body.content) : (body?.content ?? "");
  const from = m.from?.emailAddress ?? m.sender?.emailAddress;
  return {
    from: from?.name && from.address ? `${from.name} <${from.address}>` : from?.name || from?.address || "Unknown sender",
    to: label(m.toRecipients),
    cc: m.ccRecipients?.length ? label(m.ccRecipients) : undefined,
    date: formatDate(m.receivedDateTime ?? m.sentDateTime),
    bodyHtml: sanitizeEmailHtml(raw, { allowRemoteImages: true, cidMap }).html,
    attachments: attachments.filter((a) => !a.isInline).map((a) => ({ name: a.name, size: a.size })),
  };
}

export const PRINT_FRAME_TESTID = "print-frame";

// Loads the document into a hidden iframe and prints it. The frame stays in
// the DOM until the print dialog closes (afterprint) or 60 s pass, whichever
// first; a second print replaces the previous frame.
export function printDocument(html: string, doc: Document = document): HTMLIFrameElement {
  doc.querySelectorAll(`iframe[data-testid="${PRINT_FRAME_TESTID}"]`).forEach((el) => el.remove());
  const frame = doc.createElement("iframe");
  frame.setAttribute("data-testid", PRINT_FRAME_TESTID);
  frame.setAttribute("title", "Print preview");
  frame.setAttribute("aria-hidden", "true");
  // Same origin so print() can be called on the frame; modals for the dialog; no scripts.
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.visibility = "hidden";
  const cleanup = () => frame.remove();
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.addEventListener("afterprint", cleanup);
    // No win.focus(): keyboard focus must stay in the app (Ctrl/Cmd+P again).
    try {
      win.print();
    } catch {
      // print blocked (headless, sandbox): the frame is still there for inspection
    }
    win.setTimeout?.(cleanup, 60_000);
  });
  frame.srcdoc = html;
  doc.body.appendChild(frame);
  return frame;
}
