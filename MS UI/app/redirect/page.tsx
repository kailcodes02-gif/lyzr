"use client";

import { NavigationClient, type NavigationOptions } from "@azure/msal-browser";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { useEffect, useRef } from "react";
import { BASE_PATH } from "@/lib/config";

// MSAL v5 redirect bridge. Registered in Entra as <origin>/MS/redirect/.
// Renders outside MsalProvider (root layout has none) and is served without
// Cross-Origin-Opener-Policy headers (see public/_headers).
// Popup / hidden-iframe flows: relays the response to the main frame.
// Full-page redirect: navigates back to the page that started sign-in.
//
// When MSAL has no stored origin URL (always after sign-out, and after a
// sign-in whose sessionStorage was lost) it falls back to `${origin}/`,
// which is outside the /MS mount. Keep every navigation inside the app.
class BasePathNavigationClient extends NavigationClient {
  override navigateInternal(url: string, options: NavigationOptions): Promise<boolean> {
    const inApp = url.startsWith(`${window.location.origin}${BASE_PATH}/`);
    return super.navigateInternal(inApp ? url : `${window.location.origin}${BASE_PATH}/login/`, options);
  }
}

export default function RedirectBridge() {
  const ran = useRef(false);
  useEffect(() => {
    // React StrictMode (dev only) runs effects twice; the bridge clears the
    // URL on the first pass, so the second would see "no payload".
    if (ran.current) return;
    ran.current = true;
    broadcastResponseToMainFrame(new BasePathNavigationClient()).catch((error: unknown) => {
      console.warn("[redirect bridge]", error);
      // No auth payload here (manual visit): leave the bridge, but only at
      // top level. Never navigate MSAL's hidden iframe or popup.
      const topLevel = window.parent === window && !window.opener;
      if (topLevel) window.location.replace(`${BASE_PATH}/login/`);
    });
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      <p>Completing sign-in…</p>
    </main>
  );
}
