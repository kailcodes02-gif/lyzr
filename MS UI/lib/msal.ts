"use client";

import { LogLevel, PublicClientApplication, type Configuration } from "@azure/msal-browser";
import { BASE_PATH, MS_CLIENT_ID, MS_TENANT_ID } from "./config";

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function msalConfig(): Configuration {
  return {
    auth: {
      clientId: MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${MS_TENANT_ID}`,
      // MSAL v5 redirect bridge page (app/redirect/page.tsx). Registered in
      // Entra as http://localhost:3000/MS/redirect/ and the production URL.
      redirectUri: `${origin()}${BASE_PATH}/redirect/`,
      // Entra requires the post-logout URI to be a registered redirect URI, so
      // sign-out returns to the bridge page; its BasePathNavigationClient
      // (app/redirect/page.tsx) sends that landing to /login/, where
      // MsalProvider's handleRedirectPromise clears the sign-out state.
      postLogoutRedirectUri: `${origin()}${BASE_PATH}/redirect/`,
    },
    cache: {
      // Survives tab closes. Residual risk: any XSS in this origin could read
      // the cache and use the 24 h refresh token. Mitigations: hashed-script
      // CSP (public/_headers), no third-party scripts, DOMPurify + sandboxed
      // iframe for email HTML.
      cacheLocation: "localStorage",
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false,
        loggerCallback: (level, message) => {
          if (level <= LogLevel.Warning) console.warn("[msal]", message);
        },
      },
    },
  };
}

let instance: PublicClientApplication | null = null;

// One instance per browser tab. Only call from client components.
export function getMsalInstance(): PublicClientApplication {
  if (!instance) instance = new PublicClientApplication(msalConfig());
  return instance;
}
