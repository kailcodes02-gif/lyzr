"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Wand2, X } from "lucide-react";
import { apiPath } from "@/lib/api-path";

interface VoiceSample {
  id: string;
  content: string;
  position: number;
}

interface GeneratedPost {
  id: string;
  topic: string;
  content: string;
}

const TONE_PRESETS = ["More casual", "More formal", "Punchier hook", "More technical", "Story-led"];

export default function LinkedInPage() {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [newSample, setNewSample] = useState("");
  const [loadingSamples, setLoadingSamples] = useState(true);
  const [addingSample, setAddingSample] = useState(false);

  const [topic, setTopic] = useState("");
  const [inspirationPost, setInspirationPost] = useState("");
  const [toneOverride, setToneOverride] = useState("");
  const [useEmailSources, setUseEmailSources] = useState(false);
  const [suggestingTopic, setSuggestingTopic] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [post, setPost] = useState<GeneratedPost | null>(null);

  const loadSamples = async () => {
    setLoadingSamples(true);
    try {
      const res = await fetch(apiPath("/api/linkedin/voice-samples"));
      const data = await res.json();
      if (res.ok) setSamples(data.samples ?? []);
    } finally {
      setLoadingSamples(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadSamples();
  }, []);

  const addSample = async () => {
    if (!newSample.trim()) return;
    setAddingSample(true);
    try {
      const res = await fetch(apiPath("/api/linkedin/voice-samples"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newSample }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save sample");
      setNewSample("");
      loadSamples();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAddingSample(false);
    }
  };

  const removeSample = async (id: string) => {
    await fetch(apiPath("/api/linkedin/voice-samples"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadSamples();
  };

  const suggestTopic = async () => {
    setSuggestingTopic(true);
    try {
      const res = await fetch(apiPath("/api/linkedin/trending"));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to suggest a topic");
      setTopic(data.topic);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSuggestingTopic(false);
    }
  };

  const generate = async () => {
    if (!topic.trim()) {
      toast.error("Enter or suggest a topic first");
      return;
    }
    setGenerating(true);
    setPost(null);
    try {
      const res = await fetch(apiPath("/api/linkedin/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          inspirationPost: inspirationPost.trim() || undefined,
          toneOverride: toneOverride.trim() || undefined,
          useEmailSources,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      setPost(data.post);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">LinkedIn posts</h1>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <Label>Your voice ({samples.length}/5+ recommended)</Label>
          <p className="text-xs text-muted-foreground">
            Upload 5-6 of your own past posts once — every generated post matches this tone.
          </p>
          {!loadingSamples && samples.length > 0 && (
            <div className="space-y-2">
              {samples.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <p className="line-clamp-2">{s.content}</p>
                  <button onClick={() => removeSample(s.id)} className="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={newSample}
              onChange={(e) => setNewSample(e.target.value)}
              placeholder="Paste one of your past LinkedIn posts..."
              rows={3}
            />
          </div>
          <Button variant="outline" onClick={addSample} disabled={addingSample || !newSample.trim()}>
            {addingSample ? <Loader2 className="animate-spin" /> : null}
            Add sample
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Topic</Label>
            <div className="flex gap-2">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's the post about?" />
              <Button variant="outline" onClick={suggestTopic} disabled={suggestingTopic}>
                {suggestingTopic ? <Loader2 className="animate-spin" /> : <Wand2 />}
                Suggest
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Inspiration post (optional)</Label>
            <Textarea
              value={inspirationPost}
              onChange={(e) => setInspirationPost(e.target.value)}
              placeholder="Paste a post you liked the structure/angle of..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Tone adjustment (optional)</Label>
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
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={useEmailSources} onChange={(e) => setUseEmailSources(e.target.checked)} />
            Draw on my recent emails (Siva&apos;s updates, meeting notes)
          </label>

          <Button onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {generating ? "Writing..." : "Generate post"}
          </Button>
        </CardContent>
      </Card>

      {post && (
        <Card>
          <CardContent className="pt-4">
            <div className="whitespace-pre-wrap text-sm">{post.content}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
