"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, X, Search } from "lucide-react";
import { apiPath } from "@/lib/api-path";

interface Suggestion {
  email: string;
  name: string | null;
}

function initials(s: Suggestion): string {
  if (s.name) {
    const parts = s.name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }
  return s.email.slice(0, 2).toUpperCase();
}

function ContactBubble({ suggestion, onSelect }: { suggestion: Suggestion; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1 text-sm hover:ring-2 hover:ring-ring/40 transition-all cursor-pointer"
    >
      <span className="flex items-center justify-center size-6 rounded-full bg-brand-terracotta/15 text-brand-terracotta-deep text-[10px] font-semibold uppercase">
        {initials(suggestion)}
      </span>
      {suggestion.name ? (
        <span>
          <span className="font-medium">{suggestion.name}</span>{" "}
          <span className="text-muted-foreground">{suggestion.email}</span>
        </span>
      ) : (
        <span className="text-foreground">{suggestion.email}</span>
      )}
    </button>
  );
}

export function ContactPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editing, setEditing] = useState(!value);
  const [query, setQuery] = useState("");

  const [frequent, setFrequent] = useState<Suggestion[] | null>(null);
  const [loadingFrequent, setLoadingFrequent] = useState(false);
  const [frequentError, setFrequentError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const suggestFromInbox = () => {
    setLoadingFrequent(true);
    setFrequent(null);
    setFrequentError(null);
    fetch(apiPath("/api/gmail/contacts?frequent=1"))
      .then((res) => res.json())
      .then((data) => {
        setFrequent(data.suggestions ?? []);
        if (data.error) setFrequentError(data.error);
      })
      .catch(() => setFrequentError("Something went wrong reaching Gmail."))
      .finally(() => setLoadingFrequent(false));
  };

  useEffect(() => {
    const isTooShort = query.trim().length < 2;
    let cancelled = false;

    // Both branches' setState calls run inside a timeout callback (0ms for
    // the reset case) rather than synchronously in the effect body.
    const kickoff = setTimeout(() => {
      if (cancelled) return;
      if (isTooShort) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
    }, 0);

    const search = setTimeout(() => {
      if (cancelled || isTooShort) return;
      setSearchError(null);
      fetch(apiPath(`/api/gmail/contacts?q=${encodeURIComponent(query)}`))
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          setSearchResults(data.suggestions ?? []);
          if (data.error) setSearchError(data.error);
        })
        .catch(() => !cancelled && setSearchError("Something went wrong reaching Gmail."))
        .finally(() => !cancelled && setSearching(false));
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(kickoff);
      clearTimeout(search);
    };
  }, [query]);

  const select = (s: Suggestion) => {
    onChange(s.email);
    setSelectedName(s.name);
    setEditing(false);
  };

  const clear = () => {
    onChange("");
    setSelectedName(null);
    setQuery("");
    setEditing(true);
  };

  if (!editing && value) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2 py-1 w-fit text-sm">
        <span className="flex items-center justify-center size-6 rounded-full bg-brand-terracotta/15 text-brand-terracotta-deep text-[10px] font-semibold uppercase">
          {initials({ email: value, name: selectedName })}
        </span>
        {selectedName ? (
          <span>
            <span className="font-medium">{selectedName}</span>{" "}
            <span className="text-muted-foreground">{value}</span>
          </span>
        ) : (
          <span>{value}</span>
        )}
        <button
          type="button"
          onClick={clear}
          className="ml-1 flex items-center justify-center size-5 rounded-full hover:bg-muted transition-colors cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  const showingSearch = query.trim().length >= 2;
  const bubbles = showingSearch ? searchResults : frequent;
  const loading = showingSearch ? searching : loadingFrequent;
  const error = showingSearch ? searchError : frequentError;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) onChange(e.target.value.trim());
            }}
            placeholder="Type a name or email..."
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="outline" onClick={suggestFromInbox} disabled={loadingFrequent}>
          {loadingFrequent ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Suggest from my inbox
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {showingSearch ? "Searching your inbox..." : "Pulling your most-emailed contacts..."}
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && bubbles && bubbles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {showingSearch ? `No matches in your inbox for "${query.trim()}".` : "No contacts found."}
        </p>
      )}

      {!loading && bubbles && bubbles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bubbles.map((s) => (
            <ContactBubble key={s.email} suggestion={s} onSelect={() => select(s)} />
          ))}
        </div>
      )}
    </div>
  );
}
