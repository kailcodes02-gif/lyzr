"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
        <div>
          <label className="text-xs font-medium text-zinc-600">Recipient</label>
          <select
            value={recipientPersonId}
            onChange={(e) => setRecipientPersonId(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select a client contact…</option>
            {recipients.map((r) => (
              <option key={r.personId} value={r.personId}>
                {r.name} ({r.email})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-600 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Topic suggestions, ranked by recency
          </label>
          {suggest.isPending && <div className="mt-2 text-sm text-zinc-400">Generating suggestions…</div>}
          {suggest.isError && (
            <div className="mt-2 text-sm text-red-600">
              {suggest.error instanceof Error ? suggest.error.message : String(suggest.error)}
            </div>
          )}
          {suggest.data && (
            <div className="mt-1.5 space-y-1.5">
              {suggest.data.map((s, i) => (
                <label
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-zinc-200 p-2 text-sm hover:bg-zinc-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleSuggestion(i)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">{s.text}</span>
                  <Badge color="zinc">{s.sourceType}</Badge>
                </label>
              ))}
              {suggest.data.length === 0 && (
                <div className="text-sm text-zinc-400">No knowledge base content yet — write a topic manually below.</div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={draft.isPending || selected.size === 0}>
            {draft.isPending ? "Drafting…" : "Generate draft"}
          </Button>
        </div>

        {(draft.data || editedSubject) && (
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <div>
              <label className="text-xs font-medium text-zinc-600">Subject</label>
              <input
                value={editedSubject}
                onChange={(e) => setEditedSubject(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600">Body — review and edit before sending</label>
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1 text-xs">
                {(["gmail", "outlook"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`px-2.5 py-1 rounded-md capitalize ${
                      provider === p ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Button variant="primary" onClick={handleSendToDraft} disabled={!recipientPersonId || !editedSubject}>
                <Send className="w-3.5 h-3.5" /> Send to draft
              </Button>
            </div>
            <p className="text-xs text-zinc-400">
              Opens a pre-filled {provider === "gmail" ? "Gmail" : "Outlook"} compose window in a new tab — you still
              have to click Send yourself there. This app never sends on your behalf.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
