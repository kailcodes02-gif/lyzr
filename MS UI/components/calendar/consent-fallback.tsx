"use client";

import { ConsentStatus } from "@/components/consent-status";
import { Button } from "@/components/ui/button";
import { setMockMode } from "@/lib/mock";

export function ConsentFallback({ error }: { error?: unknown }) {
  const msg = error instanceof Error ? error.message : "";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <div>
        <h1 className="text-xl font-normal">Calendar needs one more permission</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Microsoft sign-in works, but the tenant has not yet approved calendar access for this app. Until an admin grants it, this page cannot read or write events.
        </p>
        {msg && <p className="mt-2 rounded-lg bg-muted p-2 font-mono text-xs text-muted-foreground">{msg}</p>}
      </div>
      <ConsentStatus only={["calendar", "calendarShared", "people", "contacts"]} />
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex-1 text-sm">
          <div className="font-medium">Try the demo</div>
          <div className="text-xs text-muted-foreground">Same UI with sample GSI events, no permissions needed.</div>
        </div>
        <Button
          onClick={() => {
            setMockMode(true);
            window.location.reload();
          }}
        >
          Open demo
        </Button>
      </div>
    </div>
  );
}
