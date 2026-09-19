"use client";

import { InteractionStatus } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isMockMode } from "@/lib/mock";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

// Static build has no middleware: the gate is client-side. Waits for MSAL to
// finish processing any redirect before deciding, otherwise a fresh login
// would bounce straight back to /login.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { accounts, inProgress } = useMsal();
  const router = useRouter();
  const settled = inProgress === InteractionStatus.None;
  // Demo mode (?mock=1): fake data, no Microsoft account needed.
  const signedIn = accounts.length > 0 || isMockMode();

  useEffect(() => {
    if (settled && !signedIn) router.replace("/login/");
  }, [settled, signedIn, router]);

  if (!settled) return <Spinner label="Checking sign-in" />;
  if (!signedIn) return <Spinner label="Redirecting to sign-in" />;
  return <>{children}</>;
}
