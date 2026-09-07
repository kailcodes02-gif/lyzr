"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Upload as UploadIcon } from "lucide-react";
import { apiPath } from "@/lib/api-path";

interface KbEntry {
  id: string;
  title: string;
  source_type: string;
  scope: string;
  created_at: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function KnowledgePage() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"global" | "private">("global");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  const loadEntries = async () => {
    setLoadingEntries(true);
    try {
      const res = await fetch(apiPath("/api/kb/list"));
      const data = await res.json();
      if (res.ok) setEntries(data.entries ?? []);
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    loadEntries();
  }, []);

  const handlePaste = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/kb/paste"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast.success("Added to the knowledge base");
      setTitle("");
      setContent("");
      loadEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const base64Data = await fileToBase64(file);
      const res = await fetch(apiPath("/api/kb/upload"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          base64Data,
          mimeType: file.type,
          scope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to process file");
      toast.success(`${file.name} converted to markdown and added`);
      loadEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-2">Upload knowledge</h1>
        <p className="text-sm text-muted-foreground">
          Paste text, or upload a PDF/image — Claude converts it into markdown and adds it
          to the shared knowledge base used across email, LinkedIn, and FAQ generation.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Scope</Label>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as "global" | "private")}
              className="flex flex-row gap-6"
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="global" />
                Global (everyone)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="private" />
                Private to me
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Upload a file (PDF or image)</Label>
            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground cursor-pointer hover:border-foreground/40 transition-colors">
              {uploading ? <Loader2 className="animate-spin size-4" /> : <UploadIcon className="size-4" />}
              {uploading ? "Converting to markdown..." : "Click to choose a PDF or image"}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or paste text
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste content..."
              rows={8}
            />
          </div>
          <Button
            onClick={handlePaste}
            disabled={submitting || !title.trim() || !content.trim()}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {submitting ? "Saving..." : "Add to knowledge base"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium mb-3">In the knowledge base ({entries.length})</h2>
        {loadingEntries ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  {entry.title}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{entry.source_type}</Badge>
                  <Badge variant={entry.scope === "global" ? "default" : "secondary"}>
                    {entry.scope}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
