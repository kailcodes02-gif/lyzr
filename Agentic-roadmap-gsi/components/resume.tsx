"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * "Resume with your email" entry point. Looks up the most recent saved session
 * for a work email and opens it. Unverified by design (simple resume) — the
 * data is the user's own assessment inputs.
 */
export function ResumeLink() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    const e = email.trim();
    if (!e) return;
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/session?email=${encodeURIComponent(e)}`);
      const d = (await r.json()) as { sessionId?: string; error?: string };
      if (!r.ok || !d.sessionId) {
        setError(d.error ?? "Could not find a saved roadmap.");
        setLoading(false);
        return;
      }
      router.push(`/roadmap?s=${encodeURIComponent(d.sessionId)}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        Already have a roadmap? <span className="text-accent">Resume with your email</span>
      </button>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") resume();
            if (e.key === "Escape") setOpen(false);
          }}
          type="email"
          placeholder="you@company.com"
          className="h-10 w-56 rounded-full border border-border-strong bg-surface-2 px-4 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60"
        />
        <button
          onClick={resume}
          disabled={loading || !email.trim()}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-white transition-all hover:bg-[#3a322c] disabled:pointer-events-none disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Resume <ArrowRight className="h-4 w-4" /></>}
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-faint transition-colors hover:text-muted">
          Cancel
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-critical">{error}</p>}
    </div>
  );
}
