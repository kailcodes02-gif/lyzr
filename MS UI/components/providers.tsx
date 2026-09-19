"use client";

import { EventType, InteractionType, type AuthenticationResult, type AuthError, type EventMessage } from "@azure/msal-browser";
import { REDIRECT_MARKER } from "@/lib/graph";
import { MsalProvider } from "@azure/msal-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { getMsalInstance } from "@/lib/msal";
import { Spinner } from "./auth-guard";

type AuthErrorInfo = { code: string; message: string } | null;
const AuthErrorContext = createContext<AuthErrorInfo>(null);
export const useAuthError = () => useContext(AuthErrorContext);

// MsalProvider calls instance.initialize() and handleRedirectPromise() itself
// (checked in @azure/msal-react 5.7 MsalProvider.js), so nothing is awaited
// here. We only keep an active account set and surface the last auth error.
const noop = () => () => {};
// true only after hydration on the client; false during the static prerender.
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

export function Providers({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();
  // Never construct MSAL during `next build`'s prerender (no window there).
  const instance = isClient ? getMsalInstance() : null;
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })
  );
  const [authError, setAuthError] = useState<AuthErrorInfo>(null);

  useEffect(() => {
    if (!instance) return;
    const id = instance.addEventCallback((event: EventMessage) => {
      const t = event.eventType;
      if ((t === EventType.LOGIN_SUCCESS || t === EventType.ACQUIRE_TOKEN_SUCCESS) && event.payload) {
        const account = (event.payload as AuthenticationResult).account;
        if (account) instance.setActiveAccount(account);
        setAuthError(null);
        try {
          Object.keys(sessionStorage)
            .filter((k) => k.startsWith(REDIRECT_MARKER))
            .forEach((k) => sessionStorage.removeItem(k));
        } catch {
          // storage blocked
        }
      } else if (t === EventType.INITIALIZE_END) {
        const all = instance.getAllAccounts();
        if (!instance.getActiveAccount() && all.length > 0) instance.setActiveAccount(all[0]);
      } else if (t === EventType.ACQUIRE_TOKEN_FAILURE && event.interactionType !== InteractionType.Silent) {
        // v5 has no separate LOGIN_FAILURE: login is an acquireToken flow.
        // Silent failures (consent probes, renewals) are expected and handled
        // where they happen; only interactive failures reach the login page.
        const err = event.error as AuthError | null;
        if (err) setAuthError({ code: err.errorCode, message: err.errorMessage });
      }
    });
    return () => {
      if (id) instance.removeEventCallback(id);
    };
  }, [instance]);

  if (!instance) return <Spinner />;

  return (
    <MsalProvider instance={instance}>
      <QueryClientProvider client={queryClient}>
        <AuthErrorContext.Provider value={authError}>{children}</AuthErrorContext.Provider>
      </QueryClientProvider>
    </MsalProvider>
  );
}
