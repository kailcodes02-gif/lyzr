import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Standalone service-role client for sync code — deliberately NOT
// lib/supabase/server.ts's createServiceClient(), which lives in a file that
// also imports `next/headers` at module scope. That import only resolves
// inside a Next.js server/edge request context; sync code needs to run both
// there (the Worker's /api/sync/* routes) and outside it (local `tsx`
// scripts, tests), so it gets its own minimal factory.
export function createSyncDbClient(env: {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
