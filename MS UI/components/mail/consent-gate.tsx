"use client";

import { ConsentStatus } from "@/components/consent-status";
import { Button } from "@/components/ui/button";
import { CONSENT_KEYS, errorMessage, isConsentError } from "@/lib/mail/hooks";
import { isMockMode, setMockMode } from "@/lib/mock";
import { AlertTriangle } from "lucide-react";

// Renders the consent panel for 401/403 style failures, a plain error otherwise.
export function MailErrorState({ error, onRetry, title = "Could not load mail" }: { error: unknown; onRetry?: () => void; title?: string }) {
  if (isConsentError(error)) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-medium">Outlook needs permission</h2>
          <p className="text-sm text-muted-foreground">
            Sign-in works, but the tenant has not approved the mail permissions for this app yet. Until then the mailbox cannot be read.
          </p>
        </div>
        <ConsentStatus only={CONSENT_KEYS} />
        {!isMockMode() && (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="mb-2">Want to see the layout anyway? The demo mailbox is a Lyzr marketer&apos;s inbox with GSI partner threads and weekly reports.</p>
            <Button
              size="sm"
              onClick={() => {
                setMockMode(true);
                window.location.reload();
              }}
            >
              Try the demo
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
