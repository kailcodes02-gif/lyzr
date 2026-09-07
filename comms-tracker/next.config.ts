import type { NextConfig } from "next";

// Path-mounted at lyzr.kailash-gm.com/abm-tracker (a Worker route on the
// existing site's domain) — same convention as the sibling GSI_Tracker app.
// Locally this means http://localhost:3000/abm-tracker.
const BASE_PATH = "/abm-tracker";

const nextConfig: NextConfig = {
  // Pure static export: no server anywhere — the browser talks straight to
  // Supabase (RLS is the security boundary). The Cloudflare Worker's
  // `/api/sync/*` and `/api/send/*` routes are handled outside Next entirely,
  // in worker/index.ts, before falling through to these static assets.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: BASE_PATH,
  env: {
    // For client code that must build absolute URLs (OAuth redirects, the
    // /api/sync fetch calls, which basePath does NOT auto-prefix since
    // they're plain fetch() strings, not Next Link/router navigation).
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
