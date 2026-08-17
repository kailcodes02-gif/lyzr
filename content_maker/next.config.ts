import type { NextConfig } from "next";

// Path-mounted at lyzr.kailash-gm.com/content_maker (a Worker route on the
// existing static site's domain, same pattern GSI Tracker used). Locally
// this means http://localhost:3000/content_maker.
const BASE_PATH = "/content_maker";

const nextConfig: NextConfig = {
  // Dynamic server (Cloudflare Workers via OpenNext), NOT a static export —
  // this app needs server-side secrets (Claude/HubSpot keys, Google token
  // refresh) and API routes, unlike GSI Tracker's static-export setup.
  images: { unoptimized: true },
  basePath: BASE_PATH,
  env: {
    // For client code that must build absolute URLs (OAuth redirect).
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
