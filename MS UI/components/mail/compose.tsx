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

export type ComposeDraft = {
  key: string;
  draftId?: string;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  body: string;
  attachments: Attachment[];
  kind?: "new" | "reply" | "forward";
};

export const toRecipients = (list?: Message["toRecipients"]): Recipient[] => (list ?? []).map((r) => ({ name: r.emailAddress.name ?? r.emailAddress.address ?? "", email: r.emailAddress.address ?? "" })).filter((r) => r.email);
const toGraph = (list: Recipient[]) => list.map((r) => ({ emailAddress: { name: r.name, address: r.email } }));

export function draftFromMessage(m: Message, kind: ComposeDraft["kind"] = "new", attachments: Attachment[] = []): ComposeDraft {
  return { key: `${m.id}-${Date.now()}`, draftId: m.id, to: toRecipients(m.toRecipients), cc: toRecipients(m.ccRecipients), bcc: toRecipients(m.bccRecipients), subject: m.subject ?? "", body: m.body?.content ?? "", attachments, kind };
}

const SMALL_LIMIT = 3 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024 - 320 * 1024;

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
  const [attachments, setAttachments] = useState<Attachment[]>(draft.attachments);
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const draftId = useRef<string | undefined>(draft.draftId);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
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
  const save = useCallback(async () => {
    if (saving.current) await saving.current;
    if (!dirty.current && draftId.current) return;
    dirty.current = false;
    setSaveState("saving");
    const payload: Partial<Message> = { subject, body: { contentType: "html", content: body }, toRecipients: toGraph(to), ccRecipients: toGraph(cc), bccRecipients: toGraph(bcc) };
    const run = (async () => {
      try {
        if (!draftId.current) {
          const m = await api.create(payload);
          draftId.current = m.id;
        } else {
          await api.update(draftId.current, payload);
        }
        setSaveState(dirty.current ? "dirty" : "saved");
      } catch {
        dirty.current = true;
        setSaveState("error");
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [api, subject, body, to, cc, bcc]);
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

  const ensureDraft = async () => {
    if (!draftId.current) {
      dirty.current = true;
      await saveRef.current();
    }
    return draftId.current!;
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const id = await ensureDraft();
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, progress: 0 }]);
      const setProgress = (p: number) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x)));
      try {
        let att: Attachment;
        if (file.size < SMALL_LIMIT) {
          att = await api.addSmallAttachment(id, { name: file.name, contentType: file.type || "application/octet-stream", contentBytes: await fileToBase64(file) });
          setProgress(1);
        } else {
          const session = await api.createUploadSession(id, { name: file.name, contentType: file.type || "application/octet-stream", size: file.size });
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
              setProgress(end / file.size);
            }
          }
          const list = await api.listAttachments(id);
          att = list.find((a) => a.name === file.name) ?? { id: `pending-${file.name}`, name: file.name, size: file.size, contentType: file.type };
        }
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
    if (!to.length && !cc.length && !bcc.length) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!subject.trim() && !window.confirm("Send this message without a subject?")) return;
    dirty.current = true;
    await saveRef.current();
    if (!draftId.current) {
      toast.error("The draft could not be saved, so it was not sent");
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
          <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => editor?.commands.focus()}>
            <EditorContent editor={editor} />
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
            <Button onClick={() => void send()} className="rounded-full px-5" disabled={uploads.length > 0}>Send</Button>
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
            <span className="ml-auto text-xs text-muted-foreground">{saveState === "saving" ? "Saving" : saveState === "saved" ? "Draft saved" : saveState === "error" ? "Not saved" : ""}</span>
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
