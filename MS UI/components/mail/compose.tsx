"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Link2, List, ListOrdered, Maximize2, Minimize2, Minus, Paperclip, RemoveFormatting, Trash2, Underline, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PeoplePicker, type Recipient } from "@/components/people-picker";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDraftApi } from "@/lib/mail/hooks";
import type { Attachment, Message } from "@/lib/mail/types";
import { isMockMode } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { EmailFrame } from "./email-frame";

export type ComposeDraft = {
  key: string;
  draftId?: string;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  body: string; // the part the editor owns
  quotedHtml?: string; // server HTML kept verbatim below the editor (quoted history, signatures, cid images)
  attachments: Attachment[];
  kind?: "new" | "reply" | "forward";
};

export const toRecipients = (list?: Message["toRecipients"]): Recipient[] => (list ?? []).map((r) => ({ name: r.emailAddress.name ?? r.emailAddress.address ?? "", email: r.emailAddress.address ?? "" })).filter((r) => r.email);
const toGraph = (list: Recipient[]) => list.map((r) => ({ emailAddress: { name: r.name, address: r.email } }));

// Outlook marks the start of quoted history with one of these; everything from
// the marker on is not something the editor can represent.
const QUOTE_MARKER = /<div[^>]*\bid=["']?(appendonsend|divRplyFwdMsg)["']?|<hr[\s/>]/i;
// Nodes StarterKit drops or flattens: if the editable part has them it stays read-only too.
const UNREPRESENTABLE = /<(img|table|style)\b/i;

// Splits a draft body into the editable part and the verbatim quoted part.
export function splitDraftBody(html: string): { body: string; quotedHtml?: string } {
  const m = QUOTE_MARKER.exec(html);
  const head = m ? html.slice(0, m.index) : html;
  const tail = m ? html.slice(m.index) : "";
  if (!head.trim()) return { body: "", quotedHtml: tail || undefined };
  if (UNREPRESENTABLE.test(head)) return { body: "", quotedHtml: html };
  return { body: head, quotedHtml: tail || undefined };
}

// The body sent to Graph: what was typed, then the untouched server HTML.
export function composeBody(editorHtml: string, quotedHtml?: string): string {
  const typed = editorHtml.trim() === "<p></p>" ? "" : editorHtml;
  return quotedHtml ? `<div>${typed}</div><br>${quotedHtml}` : typed;
}

export function draftFromMessage(m: Message, kind: ComposeDraft["kind"] = "new", attachments: Attachment[] = []): ComposeDraft {
  const content = m.body?.content ?? "";
  const { body, quotedHtml } = kind === "reply" || kind === "forward" ? { body: "", quotedHtml: content || undefined } : splitDraftBody(content);
  return { key: `${m.id}-${Date.now()}`, draftId: m.id, to: toRecipients(m.toRecipients), cc: toRecipients(m.ccRecipients), bcc: toRecipients(m.bccRecipients), subject: m.subject ?? "", body, quotedHtml, attachments, kind };
}

const SMALL_LIMIT = 3 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024 - 320 * 1024;
// Graph upload sessions stop at 150 MB per file; Exchange Online's default
// message size limit (attachments included) is 35 MB. Both are tenant-tunable.
export const MAX_ATTACHMENT_BYTES = 150 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 35 * 1024 * 1024;

const fmtMb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

// Why a file cannot be attached, or null when it fits.
export function attachmentLimitError(file: { name: string; size: number }, attachedBytes: number, limits = { file: MAX_ATTACHMENT_BYTES, message: MAX_MESSAGE_BYTES }): string | null {
  if (file.size > limits.file) return `${file.name} is ${fmtMb(file.size)}; the limit per attachment is ${fmtMb(limits.file)}.`;
  if (attachedBytes + file.size > limits.message) return `Attaching ${file.name} would take the message past ${fmtMb(limits.message)}. Share large files from OneDrive instead.`;
  return null;
}

// Attachment id from the final upload PUT (Location: .../Attachments('id')).
export function attachmentIdFromLocation(location: string | null): string | undefined {
  const m = /Attachments\('([^']+)'\)/i.exec(location ?? "");
  return m ? decodeURIComponent(m[1]) : undefined;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn("flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-black/10 hover:text-foreground", active && "bg-accent text-foreground")} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ComposeDrawer({ draft, onClose, onSend, onDiscard }: { draft: ComposeDraft; onClose: (state: ComposeDraft) => void; onSend: (state: ComposeDraft) => void; onDiscard: () => void }) {
  const api = useDraftApi();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [showBcc, setShowBcc] = useState(draft.bcc.length > 0);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [showQuoted, setShowQuoted] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>(draft.attachments);
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const draftId = useRef<string | undefined>(draft.draftId);
  const dirty = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } }), Placeholder.configure({ placeholder: "Write your message" })],
    content: draft.body,
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose prose-sm max-w-none min-h-[160px] px-4 py-2 text-sm outline-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground", "data-editor": "true", "aria-label": "Message body" } },
    onUpdate: ({ editor: e }) => {
      setBody(e.getHTML());
      dirty.current = true;
      setSaveState("dirty");
    },
  });

  const snapshot = useCallback((): ComposeDraft => ({ ...draft, draftId: draftId.current, to, cc, bcc, subject, body, attachments }), [draft, to, cc, bcc, subject, body, attachments]);

  // Draft-first: create on the first pause, then PATCH on later pauses.
  // Resolves true only when the server copy matches this state.
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    if (!dirty.current && draftId.current) return true;
    dirty.current = false;
    setSaveState("saving");
    const payload: Partial<Message> = { subject, body: { contentType: "html", content: composeBody(body, draft.quotedHtml) }, toRecipients: toGraph(to), ccRecipients: toGraph(cc), bccRecipients: toGraph(bcc) };
    const run = (async (): Promise<boolean> => {
      try {
        if (!draftId.current) {
          const m = await api.create(payload);
          draftId.current = m.id;
        } else {
          await api.update(draftId.current, payload);
        }
        setSaveState(dirty.current ? "dirty" : "saved");
        return true;
      } catch {
        dirty.current = true;
        setSaveState("error");
        return false;
      }
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    return ok;
  }, [api, subject, body, to, cc, bcc, draft.quotedHtml]);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(t);
  }, [saveState, subject, body, to, cc, bcc]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    dirty.current = true;
    setSaveState("dirty");
  };

  const ensureDraft = async (): Promise<string> => {
    if (!draftId.current) {
      dirty.current = true;
      const ok = await saveRef.current();
      if (!ok || !draftId.current) throw new Error("The draft could not be created");
    }
    return draftId.current;
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let id: string;
    try {
      id = await ensureDraft();
    } catch (e) {
      toast.error(`Could not attach files. ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    let attachedBytes = attachments.reduce((n, a) => n + (a.size ?? 0), 0);
    for (const file of Array.from(files)) {
      const limit = attachmentLimitError(file, attachedBytes);
      if (limit) {
        toast.error(limit);
        continue;
      }
      setUploads((u) => [...u, { name: file.name, progress: 0 }]);
      const setProgress = (p: number) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x)));
      try {
        let att: Attachment;
        if (file.size < SMALL_LIMIT) {
          att = await api.addSmallAttachment(id, { name: file.name, contentType: file.type || "application/octet-stream", contentBytes: await fileToBase64(file) });
          setProgress(1);
        } else {
          // Same-named files are told apart by diffing the list, never by name alone.
          const before = new Set((await api.listAttachments(id).catch(() => [] as Attachment[])).map((a) => a.id));
          const session = await api.createUploadSession(id, { name: file.name, contentType: file.type || "application/octet-stream", size: file.size });
          let newId: string | undefined;
          if (isMockMode() || session.uploadUrl.includes("mock-upload")) {
            for (let p = 0.2; p <= 1; p += 0.2) {
              await new Promise((r) => setTimeout(r, 150));
              setProgress(p);
            }
          } else {
            for (let start = 0; start < file.size; start += CHUNK) {
              const end = Math.min(start + CHUNK, file.size);
              const res = await fetch(session.uploadUrl, { method: "PUT", body: file.slice(start, end), headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}`, "Content-Type": "application/octet-stream" } });
              if (!res.ok) throw new Error(`Upload failed (${res.status})`);
              if (res.status === 201) newId = attachmentIdFromLocation(res.headers.get("Location"));
              setProgress(end / file.size);
            }
          }
          const list = await api.listAttachments(id);
          const added = list.filter((a) => !before.has(a.id));
          att = (newId ? list.find((a) => a.id === newId) : undefined) ?? (added.length === 1 ? added[0] : added.find((a) => a.name === file.name && a.size === file.size)) ?? { id: `pending-${file.name}-${Date.now()}`, name: file.name, size: file.size, contentType: file.type };
        }
        attachedBytes += file.size;
        setAttachments((a) => [...a, att]);
      } catch (e) {
        toast.error(`Could not attach ${file.name}. ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
  };

  const removeAttachment = async (att: Attachment) => {
    setAttachments((a) => a.filter((x) => x.id !== att.id));
    try {
      if (draftId.current) await api.removeAttachment(draftId.current, att.id);
    } catch {
      setAttachments((a) => [...a, att]);
      toast.error("Could not remove attachment");
    }
  };

  const send = async () => {
    if (uploads.length || saveState === "saving") return;
    if (!to.length && !cc.length && !bcc.length) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!subject.trim() && !window.confirm("Send this message without a subject?")) return;
    // /send sends the server copy: never send while the last save did not land.
    dirty.current = true;
    const ok = await saveRef.current();
    if (!ok || !draftId.current) {
      toast.error("The latest changes could not be saved, so the message was not sent. Check your connection and try again.");
      return;
    }
    onSend(snapshot());
  };

  const close = async () => {
    if (dirty.current) await saveRef.current();
    onClose(snapshot());
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const title = subject || (draft.kind === "reply" ? "Reply" : draft.kind === "forward" ? "Forward" : "New message");

  return (
    <div
      role="dialog"
      aria-label="Compose message"
      onKeyDown={(e) => {
        if (e.key === "Escape") void close();
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
      }}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-2xl transition-[width,height]",
        minimized ? "bottom-0 right-6 h-10 w-72" : expanded ? "bottom-0 right-6 h-[calc(100vh-4rem)] w-[min(60rem,calc(100vw-6rem))]" : "bottom-0 right-6 h-[min(34rem,calc(100vh-3rem))] w-[min(36rem,calc(100vw-6rem))]"
      )}
    >
      <div className="flex h-10 shrink-0 cursor-pointer items-center gap-1 bg-foreground px-3 text-sm text-background" onClick={() => minimized && setMinimized(false)}>
        <span className="flex-1 truncate font-medium">{title}</span>
        <button type="button" aria-label={minimized ? "Restore" : "Minimise"} onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m); }} className="rounded p-1 hover:bg-white/15"><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label={expanded ? "Exit full screen" : "Full screen"} onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); setMinimized(false); }} className="rounded p-1 hover:bg-white/15">{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        <button type="button" aria-label="Save and close" onClick={(e) => { e.stopPropagation(); void close(); }} className="rounded p-1 hover:bg-white/15"><X className="h-4 w-4" /></button>
      </div>
      {!minimized && (
        <>
          <div className="flex flex-col px-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-muted-foreground">To</span>
              <PeoplePicker value={to} onChange={mark(setTo)} placeholder="Recipients" className="flex-1" autoFocus={draft.kind !== "reply"} />
              <div className="flex gap-1 text-xs text-muted-foreground">
                {!showCc && <button type="button" onClick={() => setShowCc(true)} className="hover:text-foreground">Cc</button>}
                {!showBcc && <button type="button" onClick={() => setShowBcc(true)} className="hover:text-foreground">Bcc</button>}
              </div>
            </div>
            {showCc && (
              <div className="flex items-center gap-2"><span className="w-8 shrink-0 text-muted-foreground">Cc</span><PeoplePicker value={cc} onChange={mark(setCc)} className="flex-1" /></div>
            )}
            {showBcc && (
              <div className="flex items-center gap-2"><span className="w-8 shrink-0 text-muted-foreground">Bcc</span><PeoplePicker value={bcc} onChange={mark(setBcc)} className="flex-1" /></div>
            )}
            <input value={subject} onChange={(e) => mark(setSubject)(e.target.value)} placeholder="Subject" aria-label="Subject" className="h-9 border-b border-border bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div onClick={() => editor?.commands.focus()}>
              <EditorContent editor={editor} />
            </div>
            {draft.quotedHtml && (
              <div className="px-4 pb-3">
                <button type="button" onClick={() => setShowQuoted((s) => !s)} aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"} aria-expanded={showQuoted} className="rounded-full bg-muted px-2 py-0.5 text-xs leading-none text-muted-foreground hover:bg-black/10">
                  ···
                </button>
                {showQuoted && (
                  <div className="mt-2 rounded-lg border border-border" aria-label="Quoted text (sent as is)">
                    <EmailFrame body={{ contentType: "html", content: draft.quotedHtml }} />
                  </div>
                )}
              </div>
            )}
          </div>
          {(attachments.length > 0 || uploads.length > 0) && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
              {attachments.filter((a) => !a.isInline).map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-48 truncate">{a.name}</span>
                  <button type="button" aria-label={`Remove ${a.name}`} onClick={() => void removeAttachment(a)} className="rounded-full hover:bg-black/10"><X className="h-3 w-3" /></button>
                </span>
              ))}
              {uploads.map((u) => (
                <span key={u.name} className="relative flex items-center gap-1 overflow-hidden rounded-full border border-border px-2 py-0.5 text-xs">
                  <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.round(u.progress * 100)}%` }} aria-hidden />
                  <span className="relative max-w-48 truncate">{u.name}</span>
                  <span className="relative text-muted-foreground">{Math.round(u.progress * 100)}%</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-2">
            <Button onClick={() => void send()} className="rounded-full px-5" disabled={uploads.length > 0 || saveState === "saving"}>Send</Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton label="Underline" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline className="h-4 w-4" /></ToolButton>
            <ToolButton label="Bulleted list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolButton>
            <ToolButton label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolButton>
            <ToolButton label="Link" active={editor?.isActive("link")} onClick={setLink}><Link2 className="h-4 w-4" /></ToolButton>
            <ToolButton label="Remove formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting className="h-4 w-4" /></ToolButton>
            <ToolButton label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /></ToolButton>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            <span className="ml-auto text-xs text-muted-foreground" role="status">
              {saveState === "saving" ? "Saving" : saveState === "saved" ? "Draft saved" : saveState === "error" ? (
                <>
                  Not saved <button type="button" onClick={() => void saveRef.current()} className="text-primary hover:underline">Retry</button>
                </>
              ) : ""}
            </span>
            <Tooltip>
              <TooltipTrigger render={<button type="button" aria-label="Discard draft" onClick={async () => { if (draftId.current) { try { await api.discard(draftId.current); } catch { /* already gone */ } } onDiscard(); }} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground" />}>
                <Trash2 className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Discard draft</TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
