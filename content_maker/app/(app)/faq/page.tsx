"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Send, Download } from "lucide-react";
import { apiPath } from "@/lib/api-path";

type FaqMode = "ask" | "document";

export default function FaqPage() {
  const [mode, setMode] = useState<FaqMode>("ask");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [answer, setAnswer] = useState<{ hasEnoughInfo: boolean; answer: string } | null>(null);
  const [doc, setDoc] = useState<{ title: string; html: string } | null>(null);

  const submit = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setAnswer(null);
    setDoc(null);
    try {
      if (mode === "ask") {
        const res = await fetch(apiPath("/api/faq/ask"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: input }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to answer");
        setAnswer(data);
      } else {
        const res = await fetch(apiPath("/api/faq/document"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: input }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to generate document");
        setDoc(data);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const downloadDoc = () => {
    if (!doc) return;
    const blob = new Blob([doc.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-2">FAQ</h1>
        <p className="text-sm text-muted-foreground">
          Ask a question and Claude answers strictly from the knowledge base — or ask for a
          document/one-pager and Claude generates it.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as FaqMode)} className="flex flex-row gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="ask" />
              Ask a question
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="document" />
              Generate a document / one-pager
            </label>
          </RadioGroup>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === "ask"
                ? "What do you want to know?"
                : "Describe the document you need, e.g. \"a one-pager on our latest product updates\""
            }
            rows={3}
          />

          <Button onClick={submit} disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="animate-spin" /> : <Send />}
            {loading ? "Working..." : mode === "ask" ? "Ask" : "Generate document"}
          </Button>
        </CardContent>
      </Card>

      {answer && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            {!answer.hasEnoughInfo && (
              <p className="text-xs text-muted-foreground">
                The knowledge base doesn&apos;t have enough information to fully answer this.
              </p>
            )}
            <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
          </CardContent>
        </Card>
      )}

      {doc && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{doc.title}</h2>
              <Button variant="outline" size="sm" onClick={downloadDoc}>
                <Download />
                Download HTML
              </Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <iframe srcDoc={doc.html} className="w-full h-96" sandbox="" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
