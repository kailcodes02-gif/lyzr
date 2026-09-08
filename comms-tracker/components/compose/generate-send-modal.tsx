"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Search, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDraftEmail, useLogSend, useSearchKnowledge, useSuggestTopics } from "@/lib/hooks/use-ai";
import type { KnowledgeMatch } from "@/lib/ai/search";
import { sourceLabel } from "@/components/ui/badge";
import { buildGmailComposeUrl, buildOutlookComposeUrl } from "@/lib/compose";
import type { AccountPersonRow } from "@/lib/hooks/use-data";

type RecipientOption = { personId: string; name: string; email: string };

export function GenerateSendModal({
  open,
  onClose,
  accountId,
  projectId,
  projectName,
  accountName,
  clientPocs,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  projectId: string;
  projectName: string;
  accountName: string;
  clientPocs: AccountPersonRow[];
}) {
  const suggest = useSuggestTopics();
  const draft = useDraftEmail();
  const logSend = useLogSend();
  const search = useSearchKnowledge();

  // Every pickable topic, whatever its origin: suggested by the model,
  // typed by the user, or a document found by searching the sources.
  type TopicItem = { key: string; text: string; sourceType: string; sourceRef: string | null; docId: string | null; excerpt: string | null; kind: "suggested" | "custom" | "source" };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [customTopics, setCustomTopics] = useState<TopicItem[]>([]);
  const [sourceItems, setSourceItems] = useState<TopicItem[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [recipientPersonId, setRecipientPersonId] = useState("");
  const [provider, setProvider] = useState<"gmail" | "outlook">("gmail");
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");

  const recipients: RecipientOption[] = clientPocs
    .filter((p) => p.people?.email)
    .map((p) => ({ personId: p.people!.id, name: p.people!.full_name ?? p.people!.email!, email: p.people!.email! }));

  // Fresh run every time the modal opens -- suggestions are cheap and
  // recency-driven, stale ones from a prior open aren't worth caching here.
  // Reset the form each time the modal opens -- done as the React-documented
  // "adjust state during render" pattern (no extra render pass), with only
  // the actual side effect (kicking off the suggestion request) left in the
  // effect below.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSelected(new Set());
      setQuery("");
      setCustomTopics([]);
      setSourceItems([]);
      setLastQuery("");
      setEditedSubject("");
      setEditedBody("");
      const primary = clientPocs.find((p) => p.relationship_role === "client_poc_primary");
      setRecipientPersonId(primary?.people?.id ?? recipients[0]?.personId ?? "");
    }
  }

  useEffect(() => {
    if (!open) return;
    suggest.mutate(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);


  const suggestedItems: TopicItem[] = (suggest.data ?? []).map((sg, i) => ({
    key: `s:${i}`,
    text: sg.text,
    sourceType: sg.sourceType,
    sourceRef: sg.sourceRef,
    docId: null,
    excerpt: null,
    kind: "suggested",
  }));
  const allItems = [...customTopics, ...sourceItems, ...suggestedItems];

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // "Add & search": the typed line becomes a topic in its own right (checked),
  // and the knowledge base is searched for material to build it on.
  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    const key = `c:${Date.now()}`;
    setCustomTopics((prev) => [...prev, { key, text: q, sourceType: "yours", sourceRef: null, docId: null, excerpt: null, kind: "custom" }]);
    setSelected((prev) => new Set(prev).add(key));
    setQuery("");
    setLastQuery(q);
    try {
      const matches = await search.mutateAsync(q);
      const items: TopicItem[] = matches.map((m: KnowledgeMatch) => ({
        key: `d:${m.id}`,
        text: m.title ?? m.sourceRef,
        sourceType: m.sourceType,
        sourceRef: m.sourceRef,
        docId: m.id,
        excerpt: m.excerpt,
        kind: "source",
      }));
      setSourceItems(items);
      // Pre-tick the top 3 hits so "type, search, generate" is three clicks.
      setSelected((prev) => {
        const next = new Set(prev);
        items.slice(0, 3).forEach((it) => next.add(it.key));
        return next;
      });
      if (items.length === 0) toast.message("No source material matched. The draft will use your topic wording only.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function removeCustom(key: string) {
    setCustomTopics((prev) => prev.filter((t) => t.key !== key));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  async function handleGenerate() {
    const chosen = allItems.filter((it) => selected.has(it.key));
    const topics = chosen.filter((it) => it.kind !== "source").map((it) => it.text);
    const sourceOnly = chosen.filter((it) => it.kind === "source");
    // Ticked source docs with no topic line of their own still count as
    // topics (their title), so a search-only selection can drive a draft.
    const selectedTopics = topics.length > 0 ? topics : sourceOnly.map((it) => it.text);
    if (selectedTopics.length === 0) {
      toast.error("Pick or type at least one topic");
      return;
    }
    const recipient = recipients.find((r) => r.personId === recipientPersonId);
    try {
      const generated = await draft.mutateAsync({
        projectId,
        projectName,
        accountName,
        recipientName: recipient?.name ?? null,
        selectedTopics,
        referenceIds: chosen.map((it) => it.docId).filter((x): x is string => Boolean(x)),
        referenceSourceRefs: chosen.map((it) => it.sourceRef).filter((x): x is string => Boolean(x)),
        query: lastQuery || null,
      });
      setEditedSubject(generated.subject);
      setEditedBody(generated.body);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSendToDraft() {
    const recipient = recipients.find((r) => r.personId === recipientPersonId);
    if (!recipient) {
      toast.error("Pick a recipient");
      return;
    }
    const url =
      provider === "gmail"
        ? buildGmailComposeUrl({ to: recipient.email, subject: editedSubject, body: editedBody })
        : buildOutlookComposeUrl({ to: recipient.email, subject: editedSubject, body: editedBody });
    window.open(url, "_blank");

    try {
      await logSend.mutateAsync({
        accountId,
        projectId,
        personId: recipient.personId,
        recipientEmail: recipient.email,
        subject: editedSubject,
        snippet: editedBody.slice(0, 400),
      });
      toast.success("Compose window opened — logged as sent via app");
      onClose();
    } catch (err) {
      // The compose window already opened either way -- a logging failure
      // shouldn't read as "nothing happened."
      toast.error(`Compose opened, but logging failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Generate & Send — ${projectName}`} wide>
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="gs-recipient">Recipient</Label>
          <NativeSelect id="gs-recipient" value={recipientPersonId} onChange={(e) => setRecipientPersonId(e.target.value)}>
            <option value="">Select a client contact…</option>
            {recipients.map((r) => (
              <option key={r.personId} value={r.personId}>
                {r.name} ({r.email})
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="gs-query">Your topic</Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id="gs-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="e.g. Agent Studio release, underwriting demo, Q3 roadmap…"
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={handleSearch} disabled={!query.trim() || search.isPending}>
              <Plus /> {search.isPending ? "Searching…" : "Add & search sources"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">Type what you want to tell them. It becomes a topic, and the knowledge base (lyzr.ai, Slack, Drive, OneDrive, internal email) is searched for material to build it on.</p>
        </div>

        {customTopics.length > 0 && (
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">Your topics</Label>
            {customTopics.map((it) => (
              <label key={it.key} className="has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
                <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} className="accent-primary size-4" />
                <span className="flex-1 leading-snug">{it.text}</span>
                <Button variant="ghost" size="icon-sm" onClick={(e) => { e.preventDefault(); removeCustom(it.key); }} aria-label="Remove topic"><X /></Button>
              </label>
            ))}
          </div>
        )}

        {(sourceItems.length > 0 || search.isPending) && (
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">From your sources{lastQuery ? ` for "${lastQuery}"` : ""} <span className="font-normal">(ticked items become reference material for the draft)</span></Label>
            {search.isPending && <div className="text-muted-foreground text-sm">Searching the knowledge base…</div>}
            {sourceItems.map((it) => (
              <label key={it.key} className="has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
                <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} className="accent-primary mt-0.5 size-4" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium leading-snug">{it.text}</span>
                    <Badge>{sourceLabel(it.sourceType)}</Badge>
                  </span>
                  {it.excerpt && <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs">{it.excerpt}</span>}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="grid gap-1.5">
          <Label className="text-muted-foreground"><Sparkles className="size-3.5" /> Suggested topics, ranked by recency</Label>
          {suggest.isPending && <div className="text-muted-foreground text-sm">Generating suggestions…</div>}
          {suggest.isError && <div className="text-sm text-red-600">{suggest.error instanceof Error ? suggest.error.message : String(suggest.error)}</div>}
          {suggestedItems.map((it) => (
            <label key={it.key} className="has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
              <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggle(it.key)} className="accent-primary mt-0.5 size-4" />
              <span className="flex-1 leading-snug">{it.text}</span>
              <Badge>{sourceLabel(it.sourceType)}</Badge>
            </label>
          ))}
          {suggest.data && suggest.data.length === 0 && <div className="text-muted-foreground text-sm">No knowledge base content yet. Type a topic above.</div>}
        </div>

        <div className="flex justify-end">
          <Button variant={editedSubject ? "outline" : "default"} onClick={handleGenerate} disabled={draft.isPending || selected.size === 0}>
            <Sparkles /> {draft.isPending ? "Drafting…" : editedSubject ? "Regenerate draft" : "Generate draft"}
          </Button>
        </div>

        <div className="grid gap-4 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label>Email</Label>
            <span className="text-muted-foreground text-xs">Write it yourself, or tick topics above and Generate draft to fill it in. Either way you can edit before opening.</span>
          </div>
            <div className="grid gap-2">
              <Label htmlFor="gs-subject">Subject</Label>
              <Input id="gs-subject" value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} placeholder="Subject" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gs-body">Body</Label>
              <Textarea id="gs-body" value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={9} placeholder="Write your update here, or generate a draft from the topics above." />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Open in</span>
                <TabsList className="h-8">
                  <TabsTrigger active={provider === "gmail"} onClick={() => setProvider("gmail")} className="px-2.5 text-xs">Gmail</TabsTrigger>
                  <TabsTrigger active={provider === "outlook"} onClick={() => setProvider("outlook")} className="px-2.5 text-xs">Outlook</TabsTrigger>
                </TabsList>
              </div>
              <Button onClick={handleSendToDraft} disabled={!recipientPersonId || !editedSubject.trim() || !editedBody.trim()}>
                <Send /> Open in {provider === "gmail" ? "Gmail" : "Outlook"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Opens a pre-filled compose window in a new tab. You still click Send there; this app never sends on your behalf, it only logs that you opened the draft.
            </p>
          </div>
      </div>
    </Modal>
  );
}
