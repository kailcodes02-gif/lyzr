import type { NextConfig } from "next";

// Path-mounted at lyzr.kailash-gm.com/MS (Cloudflare route on the existing
// domain), same convention as the sibling comms-tracker (/abm-tracker).
// Locally: http://localhost:3000/MS. Must match the Entra redirect URIs
// (<origin>/MS/redirect/) and lib/config.ts BASE_PATH.
const BASE_PATH = "/MS";

const nextConfig: NextConfig = {
  // Pure static export: no server anywhere. The browser talks straight to
  // Microsoft Graph with the signed-in user's own token (MSAL, PKCE).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
