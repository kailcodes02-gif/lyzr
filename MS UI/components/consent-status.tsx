"use client";

import { useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, LogIn, ShieldAlert } from "lucide-react";
import { FEATURE_SCOPES } from "@/lib/config";
import { probeScopes, type ConsentState } from "@/lib/graph";

type Row = { key: string; label: string; scopes: string[]; state: ConsentState; detail: string };

const ICON: Record<ConsentState, React.ReactNode> = {
  granted: <CheckCircle2 className="h-4 w-4 text-success" />,
  "needs-admin": <ShieldAlert className="h-4 w-4 text-destructive" />,
  reauth: <LogIn className="h-4 w-4 text-primary" />,
  unknown: <CircleHelp className="h-4 w-4 text-muted-foreground" />,
};
const TEXT: Record<ConsentState, string> = {
  granted: "Approved",
  "needs-admin": "Needs admin approval",
  reauth: "Sign in again",
  unknown: "Could not check",
};

// Probes each feature's scopes silently (no navigation), one at a time so
// the token endpoint is not hammered. A scope the tenant has not approved
// yet comes back as invalid_grant / consent_required.
export function ConsentStatus({ only }: { only?: string[] }) {
  const { instance, accounts } = useMsal();
  const features = only ? FEATURE_SCOPES.filter((f) => only.includes(f.key)) : FEATURE_SCOPES;
  const q = useQuery({
    queryKey: ["consent", accounts[0]?.homeAccountId, features.map((f) => f.key).join(",")],
    enabled: accounts.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const rows: Row[] = [];
      for (const f of features) {
        const r = await probeScopes(instance, f.scopes);
        rows.push({ ...f, ...r });
      }
      return rows;
    },
  });

  const blocked = q.data?.some((r) => r.state === "needs-admin");
  const reauth = q.data?.find((r) => r.state === "reauth");
  const signInAgain = () => {
    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
    void instance.acquireTokenRedirect({ scopes: reauth?.scopes ?? ["User.Read"], account: account ?? undefined, redirectStartPage: window.location.href });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-medium">Microsoft permissions</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Sign-in works. The pages below light up once each permission is approved for this app.
      </p>
      {q.isPending && <p className="text-xs text-muted-foreground">Checking…</p>}
      {q.isError && <p className="text-xs text-destructive">Check failed: {String(q.error)}</p>}
      <ul className="divide-y divide-border">
        {q.data?.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2 text-sm">
            {ICON[r.state]}
            <span className="flex-1">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.scopes.join(", ")}</span>
            <span className="w-40 text-right text-xs">{TEXT[r.state]}</span>
          </li>
        ))}
      </ul>
      {reauth && (
        <p className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted p-3 text-xs">
          <span>Microsoft wants you to sign in again for {reauth.label.toLowerCase()} ({reauth.detail}).</span>
          <button onClick={signInAgain} className="shrink-0 rounded-full bg-primary px-3 py-1 text-primary-foreground">Sign in again</button>
        </p>
      )}
      {blocked && (
        <p className="mt-3 rounded-xl bg-accent/60 p-3 text-xs">
          A Lyzr Microsoft 365 admin has to click <b>Grant admin consent</b> once. The ready-to-send request is in
          <code className="mx-1">MS UI/ADMIN-REQUEST.md</code>in the repo.
        </p>
      )}
    </section>
  );
}
