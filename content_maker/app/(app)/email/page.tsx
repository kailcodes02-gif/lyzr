"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ContactPicker } from "@/components/contact-picker";
import {
  Loader2,
  Sparkles,
  Send,
  Megaphone,
  MessagesSquare,
  Flame,
  Globe,
  UserRound,
  Inbox,
  Video,
  BookOpen,
  Building2,
} from "lucide-react";
import { apiPath } from "@/lib/api-path";
import {
  MessageChecklist,
  KbChecklist,
  SourceRow,
  type GmailMessageSummary,
  type KbEntrySummary,
} from "@/components/source-checklist";

type Tier = "tofu" | "mofu" | "bofu";
type Mode = "thread" | "general";

interface Sources {
  productUpdates: GmailMessageSummary[];
  meetingTranscripts: GmailMessageSummary[];
  thread: GmailMessageSummary[];
  hubspot: { found: boolean; error?: string } | null;
  kbEntries: KbEntrySummary[];
}

interface EmailContext {
  productUpdates: string[];
  companyWins: string[];
  threadSummary: string | null;
  dealSignals: string[];
}

interface SourcesUsed {
  gmailMessageCount: number;
  hubspotActivityFound: boolean;
  hubspotError?: string;
  kbEntryCount: number;
}

interface Draft {
  id: string;
  subject: string;
  body_md: string;
}

const TIERS: { value: Tier; label: string; blurb: string; icon: typeof Megaphone }[] = [
  { value: "tofu", label: "TOFU", blurb: "Product updates & company wins", icon: Megaphone },
  { value: "mofu", label: "MOFU", blurb: "+ meeting themes, contextual", icon: MessagesSquare },
  { value: "bofu", label: "BOFU", blurb: "+ HubSpot activity, light urgency", icon: Flame },
];

const TONE_PRESETS = ["More casual", "More formal", "Shorter", "More technical", "Warmer"];

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center justify-center size-5 rounded-full bg-brand-terracotta text-white text-xs font-semibold">
        {n}
      </span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export default function EmailPage() {
  const [tier, setTier] = useState<Tier>("tofu");
  const [mode, setMode] = useState<Mode>("general");
  const [contactEmail, setContactEmail] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [toneOverride, setToneOverride] = useState("");

  const [findingSources, setFindingSources] = useState(false);
  const [sources, setSources] = useState<Sources | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set());
  const [includeHubspot, setIncludeHubspot] = useState(true);

  const [assembling, setAssembling] = useState(false);
  const [context, setContext] = useState<EmailContext | null>(null);
  const [sourcesUsed, setSourcesUsed] = useState<SourcesUsed | null>(null);

  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [savingDraft, setSavingDraft] = useState(false);

  // BOFU has no "general" concept — its whole point is pulling a specific
  // contact's HubSpot deal activity, so it always targets a thread. Derived
  // rather than stored in state, so there's nothing to keep in sync.
  const effectiveMode: Mode = tier === "bofu" ? "thread" : mode;
  const needsContact = effectiveMode === "thread";

  const resetDownstream = () => {
    setSources(null);
    setSelectedIds(new Set());
    setSelectedKbIds(new Set());
    setContext(null);
    setDraft(null);
  };

  const findSources = async () => {
    if (needsContact && !contactEmail.trim()) {
      toast.error("Choose a contact first");
      return;
    }
    setFindingSources(true);
    resetDownstream();
    try {
      const res = await fetch(apiPath("/api/email/sources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          mode: effectiveMode,
          contactEmail: contactEmail.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to find sources");
      setSources(data);
      // Default to everything selected — the rep can deselect what they
      // don't want, rather than starting from nothing and having to hunt.
      setSelectedIds(
        new Set([
          ...data.productUpdates.map((m: GmailMessageSummary) => m.id),
          ...data.meetingTranscripts.map((m: GmailMessageSummary) => m.id),
          ...data.thread.map((m: GmailMessageSummary) => m.id),
        ])
      );
      setSelectedKbIds(new Set(data.kbEntries.map((e: KbEntrySummary) => e.id)));
      setIncludeHubspot(Boolean(data.hubspot?.found));
      if (data.hubspot?.error) toast.message(data.hubspot.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setFindingSources(false);
    }
  };

  const toggleMessage = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllIn = (messages: GmailMessageSummary[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const m of messages) {
        if (checked) next.add(m.id);
        else next.delete(m.id);
      }
      return next;
    });
  };

  const toggleKbEntry = (id: string) => {
    setSelectedKbIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const assembleContext = async () => {
    if (!sources) return;
    setAssembling(true);
    setContext(null);
    setDraft(null);
    try {
      const allMessages = [...sources.productUpdates, ...sources.meetingTranscripts, ...sources.thread];
      const selectedMessages = allMessages.filter((m) => selectedIds.has(m.id));

      const res = await fetch(apiPath("/api/email/context"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          selectedMessages,
          includeHubspot: includeHubspot && Boolean(sources.hubspot?.found),
          hubspotContactEmail: contactEmail.trim() || undefined,
          selectedKbEntryIds: Array.from(selectedKbIds),
          extraContext: extraContext.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assemble context");
      setContext(data.context);
      setSourcesUsed(data.sourcesUsed);
      if (data.sourcesUsed?.hubspotError) {
        toast.message(data.sourcesUsed.hubspotError);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAssembling(false);
    }
  };

  const generate = async () => {
    if (!context) return;
    setGenerating(true);
    try {
      const res = await fetch(apiPath("/api/email/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          mode: effectiveMode,
          contactEmail: contactEmail.trim() || undefined,
          context,
          toneOverride: toneOverride.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      setDraft(data.draft);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  const saveToGmail = async () => {
    if (!draft) return;
    setSavingDraft(true);
    try {
      const res = await fetch(apiPath("/api/email/draft"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save draft");
      toast.success("Saved to your Gmail drafts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingDraft(false);
    }
  };

  const selectedCount = selectedIds.size + selectedKbIds.size + (includeHubspot && sources?.hubspot?.found ? 1 : 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Generate an email</h1>

      <div className="space-y-3">
        <StepLabel n={1}>Pick a funnel stage</StepLabel>
        <div className="grid grid-cols-3 gap-3">
          {TIERS.map((t) => (
            <Card
              key={t.value}
              onClick={() => {
                setTier(t.value);
                resetDownstream();
              }}
              className={`cursor-pointer transition-all ${
                tier === t.value ? "ring-2 ring-ring" : "hover:ring-2 hover:ring-ring/40"
              }`}
            >
              <CardHeader>
                <t.icon
                  className={`size-5 mb-1 ${tier === t.value ? "text-brand-terracotta" : "text-muted-foreground"}`}
                  strokeWidth={1.75}
                />
                <CardTitle className="text-base">{t.label}</CardTitle>
                <p className="text-xs text-muted-foreground">{t.blurb}</p>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <StepLabel n={2}>Who&apos;s it for?</StepLabel>
        <Card>
          <CardContent className="space-y-4 pt-4">
            {tier === "bofu" ? (
              <p className="text-xs text-muted-foreground">
                BOFU always targets a specific contact — it pulls their HubSpot deal
                activity, so there&apos;s no general/non-thread version.
              </p>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("general");
                    resetDownstream();
                  }}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors cursor-pointer ${
                    mode === "general"
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <Globe className="size-4" />
                  General — no specific thread
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("thread");
                    resetDownstream();
                  }}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors cursor-pointer ${
                    mode === "thread"
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <UserRound className="size-4" />
                  Specific contact/thread
                </button>
              </div>
            )}

            {needsContact && (
              <ContactPicker
                value={contactEmail}
                onChange={(v) => {
                  setContactEmail(v);
                  resetDownstream();
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <StepLabel n={3}>Choose your sources</StepLabel>
        <Card>
          <CardContent className="space-y-5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Pull everything that could be relevant, then pick exactly what goes into the
                email — nothing is used unless it&apos;s checked below.
              </p>
              <Button
                onClick={findSources}
                disabled={findingSources || (needsContact && !contactEmail.trim())}
                className="shrink-0"
              >
                {findingSources ? <Loader2 className="animate-spin" /> : <Inbox />}
                {findingSources ? "Finding..." : sources ? "Refresh sources" : "Find sources"}
              </Button>
            </div>

            {sources && (
              <div className="space-y-5">
                <MessageChecklist
                  icon={Megaphone}
                  title="Product updates (Siva / humans@)"
                  messages={sources.productUpdates}
                  selected={selectedIds}
                  onToggle={toggleMessage}
                  onToggleAll={(checked) => toggleAllIn(sources.productUpdates, checked)}
                />
                <MessageChecklist
                  icon={Video}
                  title="Meeting transcripts"
                  messages={sources.meetingTranscripts}
                  selected={selectedIds}
                  onToggle={toggleMessage}
                  onToggleAll={(checked) => toggleAllIn(sources.meetingTranscripts, checked)}
                />
                <MessageChecklist
                  icon={UserRound}
                  title={`Thread with ${contactEmail}`}
                  messages={sources.thread}
                  selected={selectedIds}
                  onToggle={toggleMessage}
                  onToggleAll={(checked) => toggleAllIn(sources.thread, checked)}
                />

                {sources.hubspot && (
                  <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Building2 className="size-4 text-brand-terracotta" strokeWidth={1.75} />
                      HubSpot
                    </div>
                    {sources.hubspot.found ? (
                      <SourceRow
                        checked={includeHubspot}
                        onChange={() => setIncludeHubspot((v) => !v)}
                        title="Include this contact's deal activity"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground pl-0.5">{sources.hubspot.error}</p>
                    )}
                  </div>
                )}

                <KbChecklist
                  icon={BookOpen}
                  entries={sources.kbEntries}
                  selected={selectedKbIds}
                  onToggle={toggleKbEntry}
                  onToggleAll={(checked) =>
                    setSelectedKbIds(checked ? new Set(sources.kbEntries.map((e) => e.id)) : new Set())
                  }
                />

                {sources.productUpdates.length === 0 &&
                  sources.meetingTranscripts.length === 0 &&
                  sources.thread.length === 0 &&
                  sources.kbEntries.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nothing found — you can still generate using just the notes you add below.
                    </p>
                  )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {sources && (
        <div className="space-y-3">
          <StepLabel n={4}>Context &amp; tone</StepLabel>
          <Card>
            <CardContent className="space-y-4 pt-4">
              <Textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                placeholder="Anything specific to include... (optional)"
                rows={3}
              />

              <div className="flex flex-wrap gap-2">
                {TONE_PRESETS.map((preset) => (
                  <Badge
                    key={preset}
                    variant={toneOverride === preset ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setToneOverride(toneOverride === preset ? "" : preset)}
                  >
                    {preset}
                  </Badge>
                ))}
              </div>
              <Textarea
                value={toneOverride}
                onChange={(e) => setToneOverride(e.target.value)}
                placeholder="Or describe the tone yourself... (optional)"
                rows={2}
              />

              <Button onClick={assembleContext} disabled={assembling}>
                {assembling ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {assembling
                  ? "Gathering sources..."
                  : `Gather context (${selectedCount} source${selectedCount === 1 ? "" : "s"} selected)`}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {context && sourcesUsed && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="text-xs text-muted-foreground">
              {sourcesUsed.gmailMessageCount} Gmail message(s)
              {sourcesUsed.hubspotActivityFound && " · HubSpot activity found"} ·{" "}
              {sourcesUsed.kbEntryCount} knowledge base entries
            </div>
            {context.productUpdates.length > 0 && (
              <ContextSection title="Product updates" items={context.productUpdates} />
            )}
            {context.companyWins.length > 0 && (
              <ContextSection title="Company wins" items={context.companyWins} />
            )}
            {context.threadSummary && (
              <div>
                <div className="font-medium text-xs uppercase text-muted-foreground mb-1">
                  Thread summary
                </div>
                <p className="text-sm">{context.threadSummary}</p>
              </div>
            )}
            {context.dealSignals.length > 0 && (
              <ContextSection title="Deal signals" items={context.dealSignals} />
            )}

            <Button onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {generating ? "Writing..." : "Generate email"}
            </Button>
          </CardContent>
        </Card>
      )}

      {draft && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Subject</div>
              <div className="font-medium">{draft.subject}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Body</div>
              <div className="whitespace-pre-wrap text-sm">{draft.body_md}</div>
            </div>
            <Button onClick={saveToGmail} disabled={savingDraft} variant="outline">
              {savingDraft ? <Loader2 className="animate-spin" /> : <Send />}
              {savingDraft ? "Saving..." : "Save as Gmail draft"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContextSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-medium text-xs uppercase text-muted-foreground mb-1">{title}</div>
      <ul className="list-disc list-inside text-sm space-y-0.5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
