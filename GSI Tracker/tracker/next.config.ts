import type { NextConfig } from "next";

// The app is path-mounted at lyzr.kailash-gm.com/GSI_Tracker (a Worker route
// on the static site's domain). Locally this means http://localhost:3000/GSI_Tracker.
const BASE_PATH = "/GSI_Tracker";

const nextConfig: NextConfig = {
  // Pure static export: no server anywhere — the browser talks straight to
  // Supabase (RLS is the security boundary) and the files ship on the
  // existing Cloudflare Pages site under /GSI_Tracker.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: BASE_PATH,
  env: {
    // For client code that must build absolute URLs (OAuth redirects)
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
};

export default nextConfig;
