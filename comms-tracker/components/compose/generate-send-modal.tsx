"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDraftEmail, useLogSend, useSuggestTopics } from "@/lib/hooks/use-ai";
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

  const [selected, setSelected] = useState<Set<number>>(new Set());
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


  function toggleSuggestion(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleGenerate() {
    const topics = Array.from(selected).map((i) => suggest.data![i].text);
    if (topics.length === 0) {
      toast.error("Pick at least one topic");
      return;
    }
    const recipient = recipients.find((r) => r.personId === recipientPersonId);
    try {
      const generated = await draft.mutateAsync({
        projectId,
        projectName,
        accountName,
        recipientName: recipient?.name ?? null,
        selectedTopics: topics,
      });
      // Seed the editable fields from the result here rather than in an
      // effect keyed on draft.data -- one render, no cascading setState.
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
          <Label className="text-muted-foreground"><Sparkles className="size-3.5" /> Topic suggestions, ranked by recency</Label>
          {suggest.isPending && <div className="mt-2 text-sm text-muted-foreground">Generating suggestions…</div>}
          {suggest.isError && (
            <div className="mt-2 text-sm text-red-600">
              {suggest.error instanceof Error ? suggest.error.message : String(suggest.error)}
            </div>
          )}
          {suggest.data && (
            <div className="mt-1.5 space-y-1.5">
              {suggest.data.map((s, i) => (
                <label key={i} className="has-[:checked]:border-primary has-[:checked]:bg-accent flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40">
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSuggestion(i)} className="accent-primary mt-0.5 size-4" />
                  <span className="flex-1 leading-snug">{s.text}</span>
                  <Badge>{s.sourceType}</Badge>
                </label>
              ))}
              {suggest.data.length === 0 && (
                <div className="text-sm text-muted-foreground">No knowledge base content yet — write a topic manually below.</div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant={editedSubject ? "outline" : "default"} onClick={handleGenerate} disabled={draft.isPending || selected.size === 0}>
            <Sparkles /> {draft.isPending ? "Drafting…" : editedSubject ? "Regenerate draft" : "Generate draft"}
          </Button>
        </div>

        {(draft.data || editedSubject) && (
          <div className="grid gap-4 border-t pt-4">
            <div className="grid gap-2">
              <Label htmlFor="gs-subject">Subject</Label>
              <Input id="gs-subject" value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gs-body">Body <span className="text-muted-foreground font-normal">(review and edit before sending)</span></Label>
              <Textarea id="gs-body" value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={9} />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">Open in</span>
                <TabsList className="h-8">
                  <TabsTrigger active={provider === "gmail"} onClick={() => setProvider("gmail")} className="px-2.5 text-xs">Gmail</TabsTrigger>
                  <TabsTrigger active={provider === "outlook"} onClick={() => setProvider("outlook")} className="px-2.5 text-xs">Outlook</TabsTrigger>
                </TabsList>
              </div>
              <Button onClick={handleSendToDraft} disabled={!recipientPersonId || !editedSubject}>
                <Send /> Open in {provider === "gmail" ? "Gmail" : "Outlook"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Opens a pre-filled compose window in a new tab. You still click Send there; this app never sends on your behalf, it only logs that you opened the draft.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
