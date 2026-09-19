"use client";

import { InteractionStatus } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthError } from "@/components/providers";
import { LOGIN_SCOPES } from "@/lib/config";
import { isMockMode, setMockMode, syncMockFromUrl } from "@/lib/mock";

export default function LoginPage() {
  const { instance, accounts, inProgress } = useMsal();
  const router = useRouter();
  const authError = useAuthError();
  const busy = inProgress !== InteractionStatus.None;

  useEffect(() => {
    syncMockFromUrl();
    if ((!busy && accounts.length > 0) || isMockMode()) router.replace("/outlook/");
  }, [busy, accounts.length, router]);

  const demo = () => {
    setMockMode(true);
    router.replace("/outlook/");
  };

  const signIn = () => {
    void instance.loginRedirect({ scopes: LOGIN_SCOPES, prompt: "select_account" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-medium">Lyzr MS UI</h1>
        <p className="mt-1 text-sm text-muted-foreground">Outlook, OneDrive and Calendar, laid out like Gmail and Google Drive.</p>
        <button
          onClick={signIn}
          disabled={busy}
          className="mt-6 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Sign in with Microsoft"}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">Use your Lyzr Microsoft 365 account (kailash.gm@lyzr.com).</p>
        <button onClick={demo} className="mt-4 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Try the demo with sample data
        </button>
        {authError && (
          <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
            <b>{authError.code}</b>: {authError.message}
          </p>
        )}
      </div>
    </main>
  );
}
